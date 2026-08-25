-- Public-safe Mini-Game spectator context and complete per-round score accounting.
-- Gameplay specifications, seeds, submissions, and expected answers remain private.

alter function private.build_match_snapshot(uuid, uuid)
  rename to build_completion_match_snapshot;

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
    select private.build_completion_match_snapshot(p_room_id, p_user_id) value
  ),
  enriched_summaries as (
    select coalesce(jsonb_agg(
      summary || jsonb_build_object(
        'scoreChanges', coalesce((
          select jsonb_agg(jsonb_build_object(
            'playerId', player.id,
            'pointsChanged', coalesce((
              select sum(ledger.delta)::integer
              from public.score_ledger ledger
              join public.rounds ledger_round on ledger_round.id = ledger.round_id
              where ledger.player_id = player.id
                and ledger.room_id = p_room_id
                and ledger_round.round_number = (summary->>'roundNumber')::smallint
            ), 0)
          ) order by player.join_order)
          from public.players player
          where player.room_id = p_room_id and player.match_participant
        ), '[]'::jsonb),
        'miniGames', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', challenge.id,
            'challengerPlayerId', challenge.challenger_player_id,
            'opponentPlayerId', challenge.opponent_player_id,
            'stakeType', challenge.stake_type,
            'stakePerPlayer', challenge.stake_per_player,
            'pot', challenge.pot,
            'gameType', challenge.game_type,
            'attempt', challenge.current_attempt,
            'status', challenge.status,
            'winnerPlayerId', challenge.winner_player_id,
            'resolutionMethod', challenge.resolution_method,
            'challengerScoreChange', case
              when challenge.status = 'resolved' and challenge.winner_player_id = challenge.challenger_player_id
                then challenge.pot - challenge.stake_per_player
              when challenge.status = 'resolved' then -challenge.stake_per_player
              else 0
            end,
            'opponentScoreChange', case
              when challenge.status = 'resolved' and challenge.winner_player_id = challenge.opponent_player_id
                then challenge.pot - challenge.stake_per_player
              when challenge.status = 'resolved' then -challenge.stake_per_player
              else 0
            end
          ) order by challenge.queue_position)
          from public.mini_game_challenges challenge
          where challenge.room_id = p_room_id
            and challenge.round_number = (summary->>'roundNumber')::smallint
        ), '[]'::jsonb)
      ) order by (summary->>'roundNumber')::integer
    ), '[]'::jsonb) value
    from base,
      lateral jsonb_array_elements(base.value->'roundSummaries') summary
  ),
  public_challenge as (
    select jsonb_build_object(
      'id', challenge.id,
      'challengerPlayerId', challenge.challenger_player_id,
      'opponentPlayerId', challenge.opponent_player_id,
      'stakeType', challenge.stake_type,
      'stakePerPlayer', challenge.stake_per_player,
      'pot', challenge.pot,
      'gameType', challenge.game_type,
      'attempt', challenge.current_attempt,
      'status', challenge.status
    ) value
    from public.mini_game_challenges challenge
    join public.rooms room on room.id = challenge.room_id
    where challenge.room_id = p_room_id
      and challenge.round_number = room.current_round
      and challenge.status in ('active', 'tiebreaker_active')
    order by challenge.queue_position
    limit 1
  )
  select jsonb_set(
    jsonb_set(
      base.value,
      '{roundSummaries}',
      enriched_summaries.value,
      true
    ),
    '{miniGameState,publicChallenge}',
    coalesce(public_challenge.value, 'null'::jsonb),
    true
  )
  from base
  cross join enriched_summaries
  left join public_challenge on true;
$$;

comment on function private.build_match_snapshot(uuid, uuid) is
  'Returns an actor-safe match snapshot with public Mini-Game spectator metadata and ledger-backed round score changes; private game specifications remain participant-only.';
