-- Milestone 3: server-authoritative point-card game.
-- Action-card effects and Mini-Game Challenges are intentionally excluded.

create type public.game_phase as enum (
  'dealing',
  'point_decisions',
  'round_summary',
  'completed'
);
create type public.round_status as enum ('active', 'completed');
create type public.card_resolution_status as enum ('unresolved', 'resolved');
create type public.card_resolution_type as enum (
  'lock_in',
  'challenge_win',
  'challenge_loss',
  'challenge_tie',
  'auto_lock_in',
  'timeout'
);
create type public.point_decision_type as enum (
  'lock_in',
  'challenge',
  'auto_lock_in',
  'timeout'
);
create type public.game_event_type as enum (
  'round_started',
  'turn_started',
  'player_locked_in',
  'challenge_started',
  'challenge_resolved',
  'timeout_occurred',
  'round_completed',
  'scores_updated',
  'match_completed'
);

alter table public.rooms
  add column current_round smallint not null default 0,
  add column current_phase public.game_phase,
  add column current_turn_player_id uuid,
  add column phase_deadline timestamptz,
  add column match_version bigint not null default 0,
  add column tiebreaker_required boolean not null default false,
  add constraint rooms_current_round_bounds
    check (current_round between 0 and total_rounds),
  add constraint rooms_current_turn_belongs_to_room
    foreign key (id, current_turn_player_id)
    references public.players(room_id, id)
    deferrable initially deferred;

alter table public.players
  add column score bigint not null default 0 check (score >= 0),
  add column match_participant boolean not null default false,
  add column action_draw_allowance smallint not null default 0
    check (action_draw_allowance between 0 and 3),
  add column action_draws_used smallint not null default 0
    check (action_draws_used between 0 and action_draw_allowance),
  add column mini_game_token_used boolean not null default false,
  add column lock_ins_count integer not null default 0 check (lock_ins_count >= 0),
  add column challenges_won integer not null default 0 check (challenges_won >= 0),
  add column challenges_lost integer not null default 0 check (challenges_lost >= 0),
  add column challenges_tied integer not null default 0 check (challenges_tied >= 0),
  add column timeouts_count integer not null default 0 check (timeouts_count >= 0);

create index players_match_roster_idx
  on public.players (room_id, join_order)
  where match_participant;
create index players_room_score_idx
  on public.players (room_id, score desc)
  where match_participant;

create table public.rounds (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_number smallint not null check (round_number > 0),
  phase public.game_phase not null default 'dealing',
  status public.round_status not null default 'active',
  decision_order uuid[] not null default '{}',
  current_turn_index smallint,
  current_turn_player_id uuid,
  phase_deadline timestamptz,
  turn_deadline timestamptz,
  started_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  constraint rounds_room_number_unique unique (room_id, round_number),
  constraint rounds_room_id_id_unique unique (room_id, id),
  constraint rounds_turn_belongs_to_room
    foreign key (room_id, current_turn_player_id)
    references public.players(room_id, id),
  constraint rounds_completion_shape check (
    (status = 'active' and completed_at is null)
    or (status = 'completed' and completed_at is not null)
  ),
  constraint rounds_turn_index_bounds check (
    current_turn_index is null
    or current_turn_index between 0 and 9
  )
);
create index rounds_room_status_idx on public.rounds (room_id, status, round_number desc);

create table public.round_cards_private (
  id uuid primary key default extensions.gen_random_uuid(),
  round_id uuid not null,
  room_id uuid not null,
  round_number smallint not null,
  player_id uuid not null,
  original_value integer not null
    check (original_value in (0, 100, 250, 500, 750, 1000)),
  current_value integer not null check (current_value >= 0),
  resolution_status public.card_resolution_status not null default 'unresolved',
  resolution_type public.card_resolution_type,
  points_awarded integer not null default 0 check (points_awarded >= 0),
  resolved_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint round_cards_round_fk
    foreign key (room_id, round_id)
    references public.rounds(room_id, id) on delete cascade,
  constraint round_cards_player_fk
    foreign key (room_id, player_id)
    references public.players(room_id, id),
  constraint round_cards_player_unique unique (round_id, player_id),
  constraint round_cards_resolution_shape check (
    (resolution_status = 'unresolved' and resolution_type is null and resolved_at is null)
    or (resolution_status = 'resolved' and resolution_type is not null and resolved_at is not null)
  )
);
create index round_cards_room_round_idx
  on public.round_cards_private (room_id, round_number, resolution_status);

create table public.point_decisions (
  id uuid primary key default extensions.gen_random_uuid(),
  round_id uuid not null,
  room_id uuid not null,
  round_number smallint not null,
  acting_player_id uuid not null,
  target_player_id uuid,
  decision_type public.point_decision_type not null,
  idempotency_key uuid not null,
  result_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default statement_timestamp(),
  resolved_at timestamptz not null default statement_timestamp(),
  constraint point_decisions_round_fk
    foreign key (room_id, round_id)
    references public.rounds(room_id, id) on delete cascade,
  constraint point_decisions_actor_fk
    foreign key (room_id, acting_player_id)
    references public.players(room_id, id),
  constraint point_decisions_target_fk
    foreign key (room_id, target_player_id)
    references public.players(room_id, id),
  constraint point_decisions_actor_once unique (round_id, acting_player_id),
  constraint point_decisions_idempotency unique (room_id, idempotency_key),
  constraint point_decisions_target_shape check (
    (decision_type = 'challenge' and target_player_id is not null and target_player_id <> acting_player_id)
    or (decision_type <> 'challenge' and target_player_id is null)
  )
);
create index point_decisions_room_round_idx
  on public.point_decisions (room_id, round_number, created_at);

create table public.score_ledger (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  player_id uuid not null references public.players(id),
  decision_id uuid not null references public.point_decisions(id) on delete cascade,
  delta integer not null check (delta >= 0),
  balance_after bigint not null check (balance_after >= 0),
  source_key text not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint score_ledger_source_unique unique (room_id, player_id, source_key),
  constraint score_ledger_decision_player_unique unique (decision_id, player_id)
);
create index score_ledger_room_player_idx
  on public.score_ledger (room_id, player_id, id);

create table public.game_events (
  sequence bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_number smallint,
  event_type public.game_event_type not null,
  actor_player_id uuid references public.players(id),
  public_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default statement_timestamp(),
  constraint game_events_payload_object check (jsonb_typeof(public_payload) = 'object')
);
create index game_events_room_sequence_idx
  on public.game_events (room_id, sequence desc);

create table private.point_card_deck (
  value integer primary key check (value in (0, 100, 250, 500, 750, 1000)),
  weight smallint not null check (weight > 0)
);
insert into private.point_card_deck (value, weight)
values (0, 4), (100, 4), (250, 4), (500, 4), (750, 4), (1000, 4);

create table private.core_operation_receipts (
  room_id uuid not null references public.rooms(id) on delete cascade,
  operation text not null check (operation in ('advance_round')),
  idempotency_key uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (room_id, operation, idempotency_key)
);

create or replace function private.is_match_participant(
  p_room_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.players p
    where p.room_id = p_room_id
      and p.auth_user_id = p_user_id
      and p.match_participant
      and p.left_at is null
  );
$$;

create or replace function private.is_card_owner(p_player_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.players p
    where p.id = p_player_id
      and p.auth_user_id = p_user_id
      and p.match_participant
      and p.left_at is null
  );
$$;

create or replace function private.draw_point_card()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_roll integer;
  v_value integer;
begin
  select sum(weight)::integer into v_total from private.point_card_deck;
  v_roll := (get_byte(extensions.gen_random_bytes(2), 0) * 256
    + get_byte(extensions.gen_random_bytes(2), 1)) % v_total + 1;
  select value into v_value
  from (
    select value, sum(weight) over (order by value) as ceiling
    from private.point_card_deck
  ) deck
  where ceiling >= v_roll
  order by ceiling
  limit 1;
  return v_value;
end;
$$;

create or replace function private.shuffle_match_players(
  p_room_id uuid,
  p_previous uuid[] default null
)
returns uuid[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order uuid[];
begin
  select array_agg(id order by random_key) into v_order
  from (
    select p.id, extensions.gen_random_bytes(16) as random_key
    from public.players p
    where p.room_id = p_room_id
      and p.match_participant
      and p.left_at is null
  ) shuffled;

  if cardinality(v_order) > 1 and v_order = p_previous then
    v_order := v_order[2:cardinality(v_order)] || v_order[1];
  end if;
  return coalesce(v_order, '{}'::uuid[]);
end;
$$;

create or replace function private.record_game_event(
  p_room_id uuid,
  p_round_number smallint,
  p_event_type public.game_event_type,
  p_actor_player_id uuid,
  p_public_payload jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_sequence bigint;
begin
  insert into public.game_events (
    room_id, round_number, event_type, actor_player_id, public_payload
  ) values (
    p_room_id, p_round_number, p_event_type, p_actor_player_id,
    coalesce(p_public_payload, '{}'::jsonb)
  ) returning sequence into v_sequence;
  return v_sequence;
end;
$$;

create or replace function private.build_match_snapshot(p_room_id uuid, p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with room_state as (
    select r.*
    from public.rooms r
    where r.id = p_room_id
      and private.is_match_participant(r.id, p_user_id)
  ),
  ranked_players as (
    select
      p.*,
      rank() over (order by p.score desc)::integer as current_rank
    from public.players p
    join room_state r on r.id = p.room_id
    where p.match_participant and p.left_at is null
  ),
  active_round as (
    select rd.*
    from public.rounds rd
    join room_state r on r.id = rd.room_id and r.current_round = rd.round_number
  )
  select jsonb_build_object(
    'room', jsonb_build_object(
      'id', r.id,
      'roomCode', r.room_code,
      'status', r.status,
      'totalRounds', r.total_rounds,
      'turnTimerSeconds', r.turn_timer_seconds,
      'currentRound', r.current_round,
      'phase', r.current_phase,
      'currentTurnPlayerId', r.current_turn_player_id,
      'phaseDeadline', r.phase_deadline,
      'matchVersion', r.match_version,
      'startedAt', r.started_at,
      'completedAt', r.completed_at,
      'tiebreakerRequired', r.tiebreaker_required
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'displayName', p.display_name,
        'score', p.score,
        'rank', p.current_rank,
        'connected', p.connected,
        'isHost', p.is_host,
        'isSelf', p.auth_user_id = p_user_id,
        'resolved', coalesce(c.resolution_status = 'resolved', false),
        'resolutionType', c.resolution_type
      ) order by p.current_rank, p.join_order)
      from ranked_players p
      left join active_round ar on true
      left join public.round_cards_private c
        on c.round_id = ar.id and c.player_id = p.id
    ), '[]'::jsonb),
    'round', (
      select jsonb_build_object(
        'id', rd.id,
        'number', rd.round_number,
        'phase', rd.phase,
        'status', rd.status,
        'decisionOrder', rd.decision_order,
        'currentTurnIndex', rd.current_turn_index,
        'currentTurnPlayerId', rd.current_turn_player_id,
        'phaseDeadline', rd.phase_deadline,
        'turnDeadline', rd.turn_deadline,
        'startedAt', rd.started_at,
        'completedAt', rd.completed_at
      ) from active_round rd
    ),
    'privatePlayer', (
      select jsonb_build_object(
        'playerId', p.id,
        'card', case when c.id is null then null else jsonb_build_object(
          'originalValue', c.original_value,
          'currentValue', c.current_value,
          'resolutionStatus', c.resolution_status,
          'resolutionType', c.resolution_type,
          'pointsAwarded', c.points_awarded,
          'resolvedAt', c.resolved_at
        ) end,
        'actionDrawAllowance', p.action_draw_allowance,
        'actionDrawsUsed', p.action_draws_used,
        'miniGameTokenUsed', p.mini_game_token_used
      )
      from ranked_players p
      left join active_round ar on true
      left join public.round_cards_private c
        on c.round_id = ar.id and c.player_id = p.id
      where p.auth_user_id = p_user_id
    ),
    'eligibleChallengeTargetIds', coalesce((
      select jsonb_agg(c.player_id order by p.join_order)
      from active_round ar
      join public.round_cards_private c on c.round_id = ar.id
      join ranked_players p on p.id = c.player_id
      where c.resolution_status = 'unresolved'
        and p.auth_user_id <> p_user_id
    ), '[]'::jsonb),
    'roundSummaries', coalesce((
      select jsonb_agg(summary order by round_number)
      from (
        select
          rd.round_number,
          jsonb_build_object(
            'roundNumber', rd.round_number,
            'completedAt', rd.completed_at,
            'cards', (
              select jsonb_agg(jsonb_build_object(
                'playerId', c.player_id,
                'originalValue', c.original_value,
                'currentValue', c.current_value,
                'resolutionType', c.resolution_type,
                'pointsAwarded', c.points_awarded
              ) order by p.join_order)
              from public.round_cards_private c
              join public.players p on p.id = c.player_id
              where c.round_id = rd.id
            ),
            'decisions', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'actingPlayerId', d.acting_player_id,
                'targetPlayerId', d.target_player_id,
                'decisionType', d.decision_type,
                'result', d.result_metadata,
                'resolvedAt', d.resolved_at
              ) order by d.created_at), '[]'::jsonb)
              from public.point_decisions d
              where d.round_id = rd.id
            )
          ) as summary
        from public.rounds rd
        where rd.room_id = r.id and rd.status = 'completed'
      ) completed_rounds
    ), '[]'::jsonb),
    'recentEvents', coalesce((
      select jsonb_agg(event order by sequence)
      from (
        select
          e.sequence,
          jsonb_build_object(
            'sequence', e.sequence,
            'roundNumber', e.round_number,
            'type', e.event_type,
            'actorPlayerId', e.actor_player_id,
            'payload', e.public_payload,
            'createdAt', e.created_at
          ) as event
        from public.game_events e
        where e.room_id = r.id
        order by e.sequence desc
        limit 20
      ) latest
    ), '[]'::jsonb),
    'serverTime', statement_timestamp()
  )
  from room_state r;
$$;

create or replace function private.begin_core_round(
  p_room_id uuid,
  p_round_number smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_round_id uuid := extensions.gen_random_uuid();
  v_previous_order uuid[];
  v_order uuid[];
  v_deadline timestamptz;
  v_player record;
  v_card integer;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if v_room.id is null or v_room.status not in ('starting', 'in_progress') then
    raise exception using errcode = 'P0001', message = 'WRONG_PHASE';
  end if;
  if p_round_number < 1 or p_round_number > v_room.total_rounds then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  if exists (
    select 1 from public.rounds
    where room_id = p_room_id and round_number = p_round_number
  ) then
    raise exception using errcode = 'P0001', message = 'ROUND_ALREADY_EXISTS';
  end if;

  select decision_order into v_previous_order
  from public.rounds
  where room_id = p_room_id
  order by round_number desc
  limit 1;
  v_order := private.shuffle_match_players(p_room_id, v_previous_order);
  if cardinality(v_order) < 2 then
    raise exception using errcode = 'P0001', message = 'MINIMUM_PLAYERS';
  end if;

  insert into public.rounds (
    id, room_id, round_number, phase, status, decision_order
  ) values (
    v_round_id, p_room_id, p_round_number, 'dealing', 'active', v_order
  );

  for v_player in
    select p.id
    from public.players p
    where p.room_id = p_room_id and p.match_participant and p.left_at is null
    order by p.join_order
  loop
    v_card := private.draw_point_card();
    insert into public.round_cards_private (
      round_id, room_id, round_number, player_id, original_value, current_value
    ) values (
      v_round_id, p_room_id, p_round_number, v_player.id, v_card, v_card
    );
  end loop;

  v_deadline := statement_timestamp() + make_interval(secs => v_room.turn_timer_seconds);
  update public.rounds
  set phase = 'point_decisions', current_turn_index = 0,
      current_turn_player_id = v_order[1], turn_deadline = v_deadline,
      phase_deadline = v_deadline
  where id = v_round_id;
  update public.rooms
  set status = 'in_progress', current_round = p_round_number,
      current_phase = 'point_decisions', current_turn_player_id = v_order[1],
      phase_deadline = v_deadline, match_version = match_version + 1
  where id = p_room_id;

  perform private.record_game_event(
    p_room_id, p_round_number, 'round_started', null,
    jsonb_build_object('roundNumber', p_round_number)
  );
  perform private.record_game_event(
    p_room_id, p_round_number, 'turn_started', v_order[1],
    jsonb_build_object('turnIndex', 0, 'deadline', v_deadline)
  );
end;
$$;

create or replace function private.apply_score_award(
  p_room_id uuid,
  p_round_id uuid,
  p_player_id uuid,
  p_decision_id uuid,
  p_delta integer,
  p_source_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_balance bigint;
begin
  if p_delta < 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_SCORE';
  end if;
  update public.players
  set score = score + p_delta
  where id = p_player_id and room_id = p_room_id and match_participant
  returning score into v_balance;
  if v_balance is null then
    raise exception using errcode = 'P0001', message = 'INVALID_TARGET';
  end if;
  insert into public.score_ledger (
    room_id, round_id, player_id, decision_id, delta, balance_after, source_key
  ) values (
    p_room_id, p_round_id, p_player_id, p_decision_id,
    p_delta, v_balance, p_source_key
  );
end;
$$;

create or replace function private.finish_round_or_advance_turn(
  p_room_id uuid,
  p_round_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_round public.rounds%rowtype;
  v_unresolved_count integer;
  v_next_player_id uuid;
  v_next_position integer;
  v_final_card public.round_cards_private%rowtype;
  v_decision_id uuid;
  v_deadline timestamptz;
  v_top_count integer;
  v_winner_id uuid;
begin
  loop
    select * into v_room from public.rooms where id = p_room_id for update;
    select * into v_round from public.rounds where id = p_round_id for update;
    select count(*) into v_unresolved_count
    from public.round_cards_private
    where round_id = p_round_id and resolution_status = 'unresolved';

    if v_unresolved_count = 1 then
      select * into v_final_card
      from public.round_cards_private
      where round_id = p_round_id and resolution_status = 'unresolved'
      for update;
      v_decision_id := extensions.gen_random_uuid();
      insert into public.point_decisions (
        id, round_id, room_id, round_number, acting_player_id,
        decision_type, idempotency_key,
        result_metadata
      ) values (
        v_decision_id, p_round_id, p_room_id, v_round.round_number,
        v_final_card.player_id, 'auto_lock_in', extensions.gen_random_uuid(),
        jsonb_build_object('pointsAwarded', v_final_card.current_value)
      );
      update public.round_cards_private
      set resolution_status = 'resolved', resolution_type = 'auto_lock_in',
          points_awarded = current_value, resolved_at = statement_timestamp()
      where id = v_final_card.id;
      perform private.apply_score_award(
        p_room_id, p_round_id, v_final_card.player_id, v_decision_id,
        v_final_card.current_value, 'auto:' || p_round_id::text || ':' || v_final_card.player_id::text
      );
      update public.players set lock_ins_count = lock_ins_count + 1
      where id = v_final_card.player_id;
      perform private.record_game_event(
        p_room_id, v_round.round_number, 'player_locked_in', v_final_card.player_id,
        jsonb_build_object('automatic', true)
      );
      continue;
    end if;

    if v_unresolved_count = 0 then
      update public.rounds
      set status = 'completed', phase = 'round_summary',
          current_turn_index = null, current_turn_player_id = null,
          turn_deadline = null, completed_at = statement_timestamp(),
          phase_deadline = case
            when round_number < v_room.total_rounds
              then statement_timestamp() + interval '8 seconds'
            else null
          end
      where id = p_round_id;
      perform private.record_game_event(
        p_room_id, v_round.round_number, 'round_completed', null,
        jsonb_build_object('roundNumber', v_round.round_number)
      );
      perform private.record_game_event(
        p_room_id, v_round.round_number, 'scores_updated', null,
        jsonb_build_object('roundNumber', v_round.round_number)
      );

      if v_round.round_number >= v_room.total_rounds then
        select count(*) into v_top_count
        from public.players p
        where p.room_id = p_room_id and p.match_participant
          and p.score = (
            select max(score) from public.players
            where room_id = p_room_id and match_participant
          );
        if v_top_count = 1 then
          select id into v_winner_id
          from public.players
          where room_id = p_room_id and match_participant
          order by score desc, join_order
          limit 1;
        end if;
        update public.rooms
        set status = 'completed', current_phase = 'completed',
            current_turn_player_id = null, phase_deadline = null,
            completed_at = statement_timestamp(),
            tiebreaker_required = v_top_count > 1,
            match_version = match_version + 1
        where id = p_room_id;
        perform private.record_game_event(
          p_room_id, v_round.round_number, 'match_completed', null,
          jsonb_build_object(
            'winnerPlayerId', v_winner_id,
            'tiebreakerRequired', v_top_count > 1
          )
        );
      else
        update public.rooms
        set current_phase = 'round_summary', current_turn_player_id = null,
            phase_deadline = statement_timestamp() + interval '8 seconds',
            match_version = match_version + 1
        where id = p_room_id;
      end if;
      return;
    end if;

    select c.player_id, position.ordinality::integer - 1
    into v_next_player_id, v_next_position
    from unnest(v_round.decision_order) with ordinality as position(player_id, ordinality)
    join public.round_cards_private c
      on c.round_id = p_round_id and c.player_id = position.player_id
    where c.resolution_status = 'unresolved'
    order by position.ordinality
    limit 1;
    v_deadline := statement_timestamp() + make_interval(secs => v_room.turn_timer_seconds);
    update public.rounds
    set current_turn_index = v_next_position,
        current_turn_player_id = v_next_player_id,
        turn_deadline = v_deadline, phase_deadline = v_deadline
    where id = p_round_id;
    update public.rooms
    set current_turn_player_id = v_next_player_id,
        phase_deadline = v_deadline,
        match_version = match_version + 1
    where id = p_room_id;
    perform private.record_game_event(
      p_room_id, v_round.round_number, 'turn_started', v_next_player_id,
      jsonb_build_object('turnIndex', v_next_position, 'deadline', v_deadline)
    );
    return;
  end loop;
end;
$$;

create or replace function public.start_room(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_anonymous_user();
  v_room public.rooms%rowtype;
  v_connected_count integer;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if v_room.id is null then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;
  if not exists (
    select 1 from public.players
    where room_id = p_room_id and auth_user_id = v_user_id
      and is_host and left_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'HOST_ONLY';
  end if;
  if v_room.status = 'in_progress' then
    return private.build_match_snapshot(p_room_id, v_user_id);
  end if;
  if v_room.status <> 'lobby' then
    raise exception using errcode = 'P0001', message = 'ROOM_STARTED';
  end if;

  perform private.maintain_room(p_room_id);
  select count(*) into v_connected_count
  from public.players
  where room_id = p_room_id and left_at is null and connected;
  if v_connected_count < 2 then
    raise exception using errcode = 'P0001', message = 'MINIMUM_PLAYERS';
  end if;
  if exists (
    select 1 from public.players
    where room_id = p_room_id and left_at is null and connected and not ready
  ) then
    raise exception using errcode = 'P0001', message = 'PLAYERS_NOT_READY';
  end if;

  update public.players
  set match_participant = connected and left_at is null,
      score = 0,
      action_draw_allowance = case when v_room.total_rounds = 10 then 3 else 2 end,
      action_draws_used = 0,
      mini_game_token_used = false,
      lock_ins_count = 0,
      challenges_won = 0,
      challenges_lost = 0,
      challenges_tied = 0,
      timeouts_count = 0
  where room_id = p_room_id;
  update public.rooms
  set status = 'starting', started_at = statement_timestamp(),
      current_phase = 'dealing', current_round = 0,
      current_turn_player_id = null, phase_deadline = null,
      completed_at = null, tiebreaker_required = false
  where id = p_room_id;
  perform private.begin_core_round(p_room_id, 1::smallint);
  return private.build_match_snapshot(p_room_id, v_user_id);
end;
$$;

create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_anonymous_user();
  v_was_host boolean;
  v_status public.room_status;
begin
  select status into v_status from public.rooms where id = p_room_id for update;
  if v_status is null then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;
  if v_status <> 'lobby' then
    raise exception using errcode = 'P0001', message = 'ROOM_STARTED';
  end if;
  select is_host into v_was_host
  from public.players
  where room_id = p_room_id and auth_user_id = v_user_id and left_at is null
  for update;
  if v_was_host is null then
    raise exception using errcode = 'P0001', message = 'NOT_ROOM_MEMBER';
  end if;
  update public.players
  set left_at = statement_timestamp(), connected = false, ready = false,
      disconnected_at = statement_timestamp()
  where room_id = p_room_id and auth_user_id = v_user_id and left_at is null;
  if v_was_host then
    perform private.transfer_host_if_needed(p_room_id);
  end if;
end;
$$;

create or replace function public.get_match_snapshot(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_anonymous_user();
  v_result jsonb;
begin
  if not private.is_match_participant(p_room_id, v_user_id) then
    raise exception using errcode = 'P0001', message = 'NOT_MATCH_PARTICIPANT';
  end if;
  update public.players
  set connected = true, disconnected_at = null,
      last_seen_at = statement_timestamp()
  where room_id = p_room_id and auth_user_id = v_user_id
    and match_participant and left_at is null;
  v_result := private.build_match_snapshot(p_room_id, v_user_id);
  if v_result is null then
    raise exception using errcode = 'P0001', message = 'MATCH_NOT_FOUND';
  end if;
  return v_result;
end;
$$;

create or replace function public.lock_in_point_card(
  p_room_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_anonymous_user();
  v_player public.players%rowtype;
  v_room public.rooms%rowtype;
  v_round public.rounds%rowtype;
  v_card public.round_cards_private%rowtype;
  v_decision_id uuid := extensions.gen_random_uuid();
begin
  if p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  select * into v_player from public.players
  where room_id = p_room_id and auth_user_id = v_user_id
    and match_participant and left_at is null;
  if v_player.id is null then
    raise exception using errcode = 'P0001', message = 'NOT_MATCH_PARTICIPANT';
  end if;
  if exists (
    select 1 from public.point_decisions
    where room_id = p_room_id and idempotency_key = p_idempotency_key
      and acting_player_id = v_player.id and decision_type = 'lock_in'
  ) then
    return private.build_match_snapshot(p_room_id, v_user_id);
  end if;
  if exists (
    select 1 from public.point_decisions
    where room_id = p_room_id and idempotency_key = p_idempotency_key
  ) then
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
  end if;
  if v_room.status <> 'in_progress' or v_room.current_phase <> 'point_decisions' then
    raise exception using errcode = 'P0001', message = 'WRONG_PHASE';
  end if;
  if v_room.current_turn_player_id <> v_player.id then
    raise exception using errcode = 'P0001', message = 'WRONG_TURN';
  end if;
  if v_room.phase_deadline <= statement_timestamp() then
    raise exception using errcode = 'P0001', message = 'TURN_EXPIRED';
  end if;
  select * into v_round from public.rounds
  where room_id = p_room_id and round_number = v_room.current_round for update;
  select * into v_card from public.round_cards_private
  where round_id = v_round.id and player_id = v_player.id for update;
  if v_card.resolution_status <> 'unresolved' then
    raise exception using errcode = 'P0001', message = 'ALREADY_RESOLVED';
  end if;

  insert into public.point_decisions (
    id, round_id, room_id, round_number, acting_player_id,
    decision_type, idempotency_key, result_metadata
  ) values (
    v_decision_id, v_round.id, p_room_id, v_round.round_number,
    v_player.id, 'lock_in', p_idempotency_key,
    jsonb_build_object('pointsAwarded', v_card.current_value)
  );
  update public.round_cards_private
  set resolution_status = 'resolved', resolution_type = 'lock_in',
      points_awarded = current_value, resolved_at = statement_timestamp()
  where id = v_card.id;
  perform private.apply_score_award(
    p_room_id, v_round.id, v_player.id, v_decision_id,
    v_card.current_value, 'lock:' || v_decision_id::text
  );
  update public.players set lock_ins_count = lock_ins_count + 1
  where id = v_player.id;
  perform private.record_game_event(
    p_room_id, v_round.round_number, 'player_locked_in', v_player.id,
    jsonb_build_object('automatic', false)
  );
  perform private.finish_round_or_advance_turn(p_room_id, v_round.id);
  return private.build_match_snapshot(p_room_id, v_user_id);
end;
$$;

create or replace function public.challenge_point_card(
  p_room_id uuid,
  p_target_player_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_anonymous_user();
  v_actor public.players%rowtype;
  v_target public.players%rowtype;
  v_room public.rooms%rowtype;
  v_round public.rounds%rowtype;
  v_actor_card public.round_cards_private%rowtype;
  v_target_card public.round_cards_private%rowtype;
  v_actor_award integer;
  v_target_award integer;
  v_actor_resolution public.card_resolution_type;
  v_target_resolution public.card_resolution_type;
  v_winner_id uuid;
  v_decision_id uuid := extensions.gen_random_uuid();
begin
  if p_target_player_id is null or p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  select * into v_actor from public.players
  where room_id = p_room_id and auth_user_id = v_user_id
    and match_participant and left_at is null;
  if v_actor.id is null then
    raise exception using errcode = 'P0001', message = 'NOT_MATCH_PARTICIPANT';
  end if;
  if exists (
    select 1 from public.point_decisions
    where room_id = p_room_id and idempotency_key = p_idempotency_key
      and acting_player_id = v_actor.id and decision_type = 'challenge'
      and target_player_id = p_target_player_id
  ) then
    return private.build_match_snapshot(p_room_id, v_user_id);
  end if;
  if exists (
    select 1 from public.point_decisions
    where room_id = p_room_id and idempotency_key = p_idempotency_key
  ) then
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
  end if;
  if v_room.status <> 'in_progress' or v_room.current_phase <> 'point_decisions' then
    raise exception using errcode = 'P0001', message = 'WRONG_PHASE';
  end if;
  if v_room.current_turn_player_id <> v_actor.id then
    raise exception using errcode = 'P0001', message = 'WRONG_TURN';
  end if;
  if v_room.phase_deadline <= statement_timestamp() then
    raise exception using errcode = 'P0001', message = 'TURN_EXPIRED';
  end if;
  if p_target_player_id = v_actor.id then
    raise exception using errcode = 'P0001', message = 'SELF_CHALLENGE';
  end if;
  select * into v_target from public.players
  where id = p_target_player_id and room_id = p_room_id
    and match_participant and left_at is null;
  if v_target.id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_TARGET';
  end if;
  select * into v_round from public.rounds
  where room_id = p_room_id and round_number = v_room.current_round for update;
  select * into v_actor_card from public.round_cards_private
  where round_id = v_round.id and player_id = v_actor.id for update;
  select * into v_target_card from public.round_cards_private
  where round_id = v_round.id and player_id = v_target.id for update;
  if v_actor_card.resolution_status <> 'unresolved' then
    raise exception using errcode = 'P0001', message = 'ALREADY_RESOLVED';
  end if;
  if v_target_card.resolution_status <> 'unresolved' then
    raise exception using errcode = 'P0001', message = 'TARGET_RESOLVED';
  end if;

  if v_actor_card.current_value > v_target_card.current_value then
    v_actor_award := v_actor_card.current_value + v_target_card.current_value;
    v_target_award := 0;
    v_actor_resolution := 'challenge_win';
    v_target_resolution := 'challenge_loss';
    v_winner_id := v_actor.id;
  elsif v_actor_card.current_value < v_target_card.current_value then
    v_actor_award := 0;
    v_target_award := v_actor_card.current_value + v_target_card.current_value;
    v_actor_resolution := 'challenge_loss';
    v_target_resolution := 'challenge_win';
    v_winner_id := v_target.id;
  else
    v_actor_award := v_actor_card.current_value;
    v_target_award := v_target_card.current_value;
    v_actor_resolution := 'challenge_tie';
    v_target_resolution := 'challenge_tie';
    v_winner_id := null;
  end if;

  perform private.record_game_event(
    p_room_id, v_round.round_number, 'challenge_started', v_actor.id,
    jsonb_build_object('targetPlayerId', v_target.id)
  );
  insert into public.point_decisions (
    id, round_id, room_id, round_number, acting_player_id,
    target_player_id, decision_type, idempotency_key, result_metadata
  ) values (
    v_decision_id, v_round.id, p_room_id, v_round.round_number,
    v_actor.id, v_target.id, 'challenge', p_idempotency_key,
    jsonb_build_object(
      'actorCardValue', v_actor_card.current_value,
      'targetCardValue', v_target_card.current_value,
      'actorPointsAwarded', v_actor_award,
      'targetPointsAwarded', v_target_award,
      'winnerPlayerId', v_winner_id
    )
  );
  update public.round_cards_private
  set resolution_status = 'resolved', resolution_type = v_actor_resolution,
      points_awarded = v_actor_award, resolved_at = statement_timestamp()
  where id = v_actor_card.id;
  update public.round_cards_private
  set resolution_status = 'resolved', resolution_type = v_target_resolution,
      points_awarded = v_target_award, resolved_at = statement_timestamp()
  where id = v_target_card.id;
  perform private.apply_score_award(
    p_room_id, v_round.id, v_actor.id, v_decision_id,
    v_actor_award, 'challenge:actor:' || v_decision_id::text
  );
  perform private.apply_score_award(
    p_room_id, v_round.id, v_target.id, v_decision_id,
    v_target_award, 'challenge:target:' || v_decision_id::text
  );
  update public.players
  set challenges_won = challenges_won + case when id = v_winner_id then 1 else 0 end,
      challenges_lost = challenges_lost + case
        when v_winner_id is not null and id <> v_winner_id then 1 else 0 end,
      challenges_tied = challenges_tied + case when v_winner_id is null then 1 else 0 end
  where id in (v_actor.id, v_target.id);
  perform private.record_game_event(
    p_room_id, v_round.round_number, 'challenge_resolved', v_actor.id,
    jsonb_build_object(
      'targetPlayerId', v_target.id,
      'actorCardValue', v_actor_card.current_value,
      'targetCardValue', v_target_card.current_value,
      'actorPointsAwarded', v_actor_award,
      'targetPointsAwarded', v_target_award,
      'winnerPlayerId', v_winner_id
    )
  );
  perform private.finish_round_or_advance_turn(p_room_id, v_round.id);
  return private.build_match_snapshot(p_room_id, v_user_id);
end;
$$;

create or replace function public.process_expired_turn(
  p_room_id uuid,
  p_expected_turn_player_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_anonymous_user();
  v_room public.rooms%rowtype;
  v_round public.rounds%rowtype;
  v_card public.round_cards_private%rowtype;
  v_decision_id uuid := extensions.gen_random_uuid();
begin
  if p_expected_turn_player_id is null or p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not private.is_match_participant(p_room_id, v_user_id) then
    raise exception using errcode = 'P0001', message = 'NOT_MATCH_PARTICIPANT';
  end if;
  if exists (
    select 1 from public.point_decisions
    where room_id = p_room_id and idempotency_key = p_idempotency_key
      and decision_type = 'timeout'
  ) then
    return private.build_match_snapshot(p_room_id, v_user_id);
  end if;
  if v_room.status <> 'in_progress' or v_room.current_phase <> 'point_decisions' then
    return private.build_match_snapshot(p_room_id, v_user_id);
  end if;
  if v_room.current_turn_player_id <> p_expected_turn_player_id then
    if exists (
      select 1 from public.point_decisions
      where room_id = p_room_id and round_number = v_room.current_round
        and acting_player_id = p_expected_turn_player_id
        and decision_type = 'timeout'
    ) then
      return private.build_match_snapshot(p_room_id, v_user_id);
    end if;
    raise exception using errcode = 'P0001', message = 'STALE_TURN';
  end if;
  if v_room.phase_deadline > statement_timestamp() then
    raise exception using errcode = 'P0001', message = 'DEADLINE_NOT_EXPIRED';
  end if;
  select * into v_round from public.rounds
  where room_id = p_room_id and round_number = v_room.current_round for update;
  select * into v_card from public.round_cards_private
  where round_id = v_round.id and player_id = p_expected_turn_player_id for update;
  if v_card.resolution_status <> 'unresolved' then
    return private.build_match_snapshot(p_room_id, v_user_id);
  end if;

  insert into public.point_decisions (
    id, round_id, room_id, round_number, acting_player_id,
    decision_type, idempotency_key, result_metadata
  ) values (
    v_decision_id, v_round.id, p_room_id, v_round.round_number,
    v_card.player_id, 'timeout', p_idempotency_key,
    jsonb_build_object('pointsAwarded', v_card.current_value)
  );
  update public.round_cards_private
  set resolution_status = 'resolved', resolution_type = 'timeout',
      points_awarded = current_value, resolved_at = statement_timestamp()
  where id = v_card.id;
  perform private.apply_score_award(
    p_room_id, v_round.id, v_card.player_id, v_decision_id,
    v_card.current_value, 'timeout:' || v_decision_id::text
  );
  update public.players
  set lock_ins_count = lock_ins_count + 1,
      timeouts_count = timeouts_count + 1
  where id = v_card.player_id;
  perform private.record_game_event(
    p_room_id, v_round.round_number, 'timeout_occurred', v_card.player_id,
    jsonb_build_object('automaticLockIn', true)
  );
  perform private.record_game_event(
    p_room_id, v_round.round_number, 'player_locked_in', v_card.player_id,
    jsonb_build_object('automatic', true, 'reason', 'timeout')
  );
  perform private.finish_round_or_advance_turn(p_room_id, v_round.id);
  return private.build_match_snapshot(p_room_id, v_user_id);
end;
$$;

create or replace function public.advance_round_summary(
  p_room_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_anonymous_user();
  v_room public.rooms%rowtype;
begin
  if p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not private.is_match_participant(p_room_id, v_user_id) then
    raise exception using errcode = 'P0001', message = 'NOT_MATCH_PARTICIPANT';
  end if;
  if exists (
    select 1 from private.core_operation_receipts
    where room_id = p_room_id and operation = 'advance_round'
      and idempotency_key = p_idempotency_key
  ) then
    return private.build_match_snapshot(p_room_id, v_user_id);
  end if;
  if v_room.status = 'completed' then
    return private.build_match_snapshot(p_room_id, v_user_id);
  end if;
  if v_room.current_phase <> 'round_summary' then
    raise exception using errcode = 'P0001', message = 'WRONG_PHASE';
  end if;
  if v_room.phase_deadline > statement_timestamp() then
    raise exception using errcode = 'P0001', message = 'DEADLINE_NOT_EXPIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_room_id::text || ':' || p_idempotency_key::text, 0)
  );
  perform private.begin_core_round(p_room_id, (v_room.current_round + 1)::smallint);
  insert into private.core_operation_receipts (room_id, operation, idempotency_key)
  values (p_room_id, 'advance_round', p_idempotency_key);
  return private.build_match_snapshot(p_room_id, v_user_id);
end;
$$;

create or replace function private.broadcast_game_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_room_id uuid;
begin
  if tg_table_name = 'rooms' then
    v_room_id := coalesce(new.id, old.id);
  else
    v_room_id := coalesce(new.room_id, old.room_id);
  end if;
  if v_room_id is not null then
    perform realtime.send(
      jsonb_build_object('changed', true),
      'game_changed',
      'room:' || v_room_id::text || ':game',
      true
    );
  end if;
  return null;
end;
$$;

create trigger rooms_broadcast_game_change
after update on public.rooms
for each row execute function private.broadcast_game_change();
create trigger players_broadcast_game_change
after update on public.players
for each row execute function private.broadcast_game_change();
create trigger rounds_broadcast_game_change
after insert or update on public.rounds
for each row execute function private.broadcast_game_change();
create trigger point_decisions_broadcast_game_change
after insert on public.point_decisions
for each row execute function private.broadcast_game_change();
create trigger game_events_broadcast_game_change
after insert on public.game_events
for each row execute function private.broadcast_game_change();

alter table public.rounds enable row level security;
alter table public.round_cards_private enable row level security;
alter table public.point_decisions enable row level security;
alter table public.score_ledger enable row level security;
alter table public.game_events enable row level security;
alter table public.rounds force row level security;
alter table public.round_cards_private force row level security;
alter table public.point_decisions force row level security;
alter table public.score_ledger force row level security;
alter table public.game_events force row level security;

create policy rounds_participant_select on public.rounds
for select to authenticated
using (private.is_match_participant(room_id));
create policy round_cards_owner_or_completed_select on public.round_cards_private
for select to authenticated
using (
  private.is_match_participant(room_id)
  and (
    private.is_card_owner(player_id)
    or exists (
      select 1 from public.rounds rd
      where rd.id = round_id and rd.status = 'completed'
    )
  )
);
create policy point_decisions_participant_select on public.point_decisions
for select to authenticated
using (private.is_match_participant(room_id));
create policy game_events_participant_select on public.game_events
for select to authenticated
using (private.is_match_participant(room_id));

revoke all on table public.rounds, public.round_cards_private,
  public.point_decisions, public.score_ledger, public.game_events
  from public, anon, authenticated;
grant select on public.rounds to authenticated;
grant select (
  id, round_id, room_id, round_number, player_id, original_value,
  current_value, resolution_status, resolution_type, points_awarded,
  resolved_at, created_at
) on public.round_cards_private to authenticated;
grant select on public.point_decisions, public.game_events to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_room_member(uuid, uuid) to authenticated;
grant execute on function private.is_match_participant(uuid, uuid) to authenticated;
grant execute on function private.is_card_owner(uuid, uuid) to authenticated;

revoke all on function public.get_match_snapshot(uuid) from public, anon;
revoke all on function public.lock_in_point_card(uuid, uuid) from public, anon;
revoke all on function public.challenge_point_card(uuid, uuid, uuid) from public, anon;
revoke all on function public.process_expired_turn(uuid, uuid, uuid) from public, anon;
revoke all on function public.advance_round_summary(uuid, uuid) from public, anon;
grant execute on function public.get_match_snapshot(uuid) to authenticated;
grant execute on function public.lock_in_point_card(uuid, uuid) to authenticated;
grant execute on function public.challenge_point_card(uuid, uuid, uuid) to authenticated;
grant execute on function public.process_expired_turn(uuid, uuid, uuid) to authenticated;
grant execute on function public.advance_round_summary(uuid, uuid) to authenticated;

grant select (
  score, match_participant, action_draw_allowance, action_draws_used,
  mini_game_token_used, lock_ins_count, challenges_won, challenges_lost,
  challenges_tied, timeouts_count
) on public.players to authenticated;
grant select (
  current_round, current_phase, current_turn_player_id, phase_deadline,
  match_version, tiebreaker_required
) on public.rooms to authenticated;

create policy scoreup_game_broadcast_read
on realtime.messages for select to authenticated
using (
  realtime.topic() ~ '^room:[0-9a-f-]{36}:game$'
  and private.is_match_participant(split_part(realtime.topic(), ':', 2)::uuid)
);

comment on table public.round_cards_private is
  'Hidden point cards. Direct writes are denied; unresolved values are owner-only by RLS.';
comment on function public.start_room is
  'Atomically freezes the roster, initializes the match, deals round one, and returns an actor-safe snapshot.';
comment on function public.process_expired_turn is
  'Activity-triggered authoritative timeout processing; safe for concurrent participant calls.';
