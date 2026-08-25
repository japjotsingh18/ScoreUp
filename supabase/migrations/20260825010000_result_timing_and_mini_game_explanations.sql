-- Give players enough time to understand round outcomes and expose only
-- post-settlement Mini-Game performance metrics needed to explain the winner.

create or replace function private.finalize_mini_game_phase(p_room_id uuid, p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_round public.rounds%rowtype;
  v_deadline timestamptz;
  v_has_challenge boolean;
begin
  select * into strict v_room from public.rooms where id = p_room_id for update;
  select * into strict v_round from public.rounds where id = p_round_id for update;

  if exists(
    select 1
    from public.mini_game_challenges
    where round_id = p_round_id
      and status in ('queued', 'active', 'tiebreaker_active')
  ) then
    return;
  end if;

  if v_room.current_phase <> 'mini_game_resolution' then
    return;
  end if;

  v_has_challenge :=
    exists(select 1 from public.mini_game_challenges where round_id = p_round_id)
    or exists(
      select 1
      from public.round_cards_private
      where round_id = p_round_id
        and resolution_type in ('challenge_win', 'challenge_loss', 'challenge_tie')
    );

  v_deadline := case
    when v_round.round_number >= v_room.total_rounds then null
    when v_has_challenge then statement_timestamp() + interval '15 seconds'
    else statement_timestamp() + interval '10 seconds'
  end;

  update public.rounds
  set status = 'completed',
      phase = 'round_summary',
      current_turn_index = null,
      current_turn_player_id = null,
      turn_deadline = null,
      completed_at = statement_timestamp(),
      phase_deadline = v_deadline
  where id = p_round_id;

  perform private.record_game_event(
    p_room_id,
    v_round.round_number,
    'mini_game_phase_completed',
    null,
    '{}'
  );
  perform private.record_game_event(
    p_room_id,
    v_round.round_number,
    'round_completed',
    null,
    jsonb_build_object('roundNumber', v_round.round_number)
  );
  perform private.record_game_event(
    p_room_id,
    v_round.round_number,
    'scores_updated',
    null,
    jsonb_build_object('roundNumber', v_round.round_number)
  );

  if v_round.round_number >= v_room.total_rounds then
    update public.rooms
    set current_phase = 'finalizing',
        current_turn_player_id = null,
        phase_deadline = null,
        tiebreaker_required = false,
        match_version = match_version + 1
    where id = p_room_id;
    perform private.finalize_match(p_room_id);
  else
    update public.rooms
    set current_phase = 'round_summary',
        current_turn_player_id = null,
        phase_deadline = v_deadline,
        match_version = match_version + 1
    where id = p_room_id;
  end if;
end;
$$;

alter function private.build_match_snapshot(uuid, uuid)
  rename to build_round_clarity_match_snapshot;

create or replace function private.build_match_snapshot(
  p_room_id uuid,
  p_user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select private.build_round_clarity_match_snapshot(p_room_id, p_user_id) value
  ),
  enriched_summaries as (
    select coalesce(jsonb_agg(
      summary || jsonb_build_object(
        'miniGames', coalesce((
          select jsonb_agg(
            mini_game || jsonb_build_object(
              'results', coalesce((
                select jsonb_agg(jsonb_build_object(
                  'playerId', submission.player_id,
                  'validationStatus', submission.validation_status,
                  'elapsedMs', submission.client_elapsed_ms,
                  'primaryScore', (submission.normalized_result->>'primary')::integer,
                  'secondaryScore', (submission.normalized_result->>'secondary')::integer
                ) order by player.join_order)
                from public.mini_game_submissions submission
                join public.players player on player.id = submission.player_id
                where submission.challenge_id = (mini_game->>'id')::uuid
                  and submission.attempt = (mini_game->>'attempt')::smallint
                  and (mini_game->>'status') = 'resolved'
              ), '[]'::jsonb)
            ) order by mini_game_index
          )
          from jsonb_array_elements(summary->'miniGames')
            with ordinality as games(mini_game, mini_game_index)
        ), '[]'::jsonb)
      ) order by (summary->>'roundNumber')::integer
    ), '[]'::jsonb) value
    from base,
      lateral jsonb_array_elements(base.value->'roundSummaries') summary
  )
  select jsonb_set(
    base.value,
    '{roundSummaries}',
    enriched_summaries.value,
    true
  )
  from base
  cross join enriched_summaries;
$$;

comment on function private.build_match_snapshot(uuid, uuid) is
  'Returns actor-safe match state with post-settlement Mini-Game performance metrics; hidden specifications, expected answers, seeds, and active opponent submissions remain private.';

revoke all on function private.build_round_clarity_match_snapshot(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.build_match_snapshot(uuid, uuid)
  from public, anon, authenticated;
