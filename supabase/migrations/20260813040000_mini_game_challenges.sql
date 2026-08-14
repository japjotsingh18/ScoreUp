-- Milestone 5: queued, escrow-backed Mini-Game Challenges.

alter type public.game_phase add value if not exists 'mini_game_resolution' before 'round_summary';
alter type public.game_event_type add value if not exists 'mini_game_requested';
alter type public.game_event_type add value if not exists 'mini_game_started';
alter type public.game_event_type add value if not exists 'mini_game_submission_received';
alter type public.game_event_type add value if not exists 'mini_game_tiebreaker_started';
alter type public.game_event_type add value if not exists 'mini_game_resolved';
alter type public.game_event_type add value if not exists 'mini_game_queue_advanced';
alter type public.game_event_type add value if not exists 'mini_game_phase_completed';

create type public.mini_game_stake_type as enum ('half', 'all');
create type public.mini_game_type as enum ('stop_bar', 'memory_sequence', 'different_symbol');
create type public.mini_game_challenge_status as enum (
  'queued', 'active', 'tiebreaker_active', 'resolved', 'cancelled', 'refunded'
);
create type public.mini_game_validation_status as enum ('accepted', 'rejected');
create type public.mini_game_resolution_method as enum (
  'game_result', 'opponent_timeout', 'opponent_invalid',
  'tiebreaker_result', 'random_fallback', 'server_refund'
);

create table public.mini_game_challenges (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  round_number smallint not null,
  queue_position bigint generated always as identity,
  challenger_player_id uuid not null,
  opponent_player_id uuid not null,
  stake_type public.mini_game_stake_type not null,
  stake_per_player integer check (stake_per_player is null or stake_per_player > 0),
  pot integer check (pot is null or pot = stake_per_player * 2),
  game_type public.mini_game_type,
  current_attempt smallint not null default 1 check (current_attempt in (1, 2)),
  status public.mini_game_challenge_status not null default 'queued',
  starts_at timestamptz,
  submission_deadline timestamptz,
  winner_player_id uuid,
  resolution_method public.mini_game_resolution_method,
  idempotency_key uuid not null,
  requested_at timestamptz not null default statement_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  constraint mini_game_challenges_round_fk foreign key (room_id, round_id)
    references public.rounds(room_id, id) on delete cascade,
  constraint mini_game_challenges_challenger_fk foreign key (room_id, challenger_player_id)
    references public.players(room_id, id),
  constraint mini_game_challenges_opponent_fk foreign key (room_id, opponent_player_id)
    references public.players(room_id, id),
  constraint mini_game_challenges_winner_fk foreign key (room_id, winner_player_id)
    references public.players(room_id, id),
  constraint mini_game_challenges_distinct_players check (challenger_player_id <> opponent_player_id),
  constraint mini_game_challenges_queue_unique unique (room_id, queue_position),
  constraint mini_game_challenges_idempotency_unique unique (room_id, idempotency_key),
  constraint mini_game_challenges_state_shape check (
    (status = 'queued' and stake_per_player is null and pot is null and game_type is null and starts_at is null and submission_deadline is null)
    or (status in ('active', 'tiebreaker_active') and stake_per_player is not null and pot is not null and game_type is not null and starts_at is not null and submission_deadline is not null)
    or (status in ('resolved', 'refunded') and stake_per_player is not null and pot is not null and completed_at is not null)
    or (status = 'cancelled' and cancelled_at is not null)
  )
);
create unique index mini_game_one_active_per_room
  on public.mini_game_challenges (room_id)
  where status in ('active', 'tiebreaker_active');
create index mini_game_challenges_fifo_idx
  on public.mini_game_challenges (room_id, round_id, status, queue_position);

create table private.mini_game_participant_locks (
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  player_id uuid not null references public.players(id),
  challenge_id uuid not null references public.mini_game_challenges(id) on delete cascade,
  created_at timestamptz not null default statement_timestamp(),
  primary key (round_id, player_id),
  unique (challenge_id, player_id)
);

create table private.mini_game_specs (
  challenge_id uuid not null references public.mini_game_challenges(id) on delete cascade,
  attempt smallint not null check (attempt in (1, 2)),
  game_type public.mini_game_type not null,
  seed bytea not null check (octet_length(seed) = 32),
  participant_spec jsonb not null,
  expected_result jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (challenge_id, attempt)
);

create table public.mini_game_submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  challenge_id uuid not null references public.mini_game_challenges(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  attempt smallint not null check (attempt in (1, 2)),
  player_id uuid not null references public.players(id),
  result_payload jsonb not null,
  client_elapsed_ms integer,
  normalized_result jsonb not null default '{}'::jsonb,
  validation_status public.mini_game_validation_status not null,
  validation_reason text,
  idempotency_key uuid not null,
  received_at timestamptz not null default statement_timestamp(),
  constraint mini_game_submissions_player_fk foreign key (room_id, player_id)
    references public.players(room_id, id),
  constraint mini_game_submissions_one_per_attempt unique (challenge_id, attempt, player_id),
  constraint mini_game_submissions_idempotency_unique unique (room_id, idempotency_key)
);
create index mini_game_submissions_challenge_idx
  on public.mini_game_submissions (challenge_id, attempt, validation_status);

alter table public.score_ledger drop constraint score_ledger_source_shape;
alter table public.score_ledger
  add column mini_game_challenge_id uuid references public.mini_game_challenges(id) on delete cascade,
  add constraint score_ledger_source_shape check (
    ((decision_id is not null)::integer + (action_draw_id is not null)::integer +
      (mini_game_challenge_id is not null)::integer) = 1
  );
create unique index score_ledger_mini_game_player_reason_key
  on public.score_ledger (mini_game_challenge_id, player_id, reason_code)
  where mini_game_challenge_id is not null;

create or replace function private.is_mini_game_participant(
  p_challenge_id uuid,
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
    from public.mini_game_challenges c
    join public.players p on p.id in (c.challenger_player_id, c.opponent_player_id)
    where c.id = p_challenge_id and p.auth_user_id = p_user_id
      and p.match_participant and p.left_at is null
  );
$$;

create or replace function private.is_mini_game_submission_owner(
  p_player_id uuid,
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
    where p.id = p_player_id
      and p.auth_user_id = p_user_id
      and p.match_participant
      and p.left_at is null
  );
$$;

create or replace function private.mini_game_random_index(
  p_count integer,
  p_setting text default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_override text;
begin
  if p_count <= 0 then return null; end if;
  if session_user = 'postgres' and p_setting is not null then
    v_override := pg_catalog.current_setting(p_setting, true);
    if v_override ~ '^[0-9]+$' then return v_override::integer % p_count; end if;
  end if;
  return private.secure_random_index(p_count, null);
end;
$$;

create or replace function private.select_mini_game_type()
returns public.mini_game_type
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_override text; v_index integer;
begin
  if session_user = 'postgres' then
    v_override := pg_catalog.current_setting('scoreup.test_mini_game_type', true);
    if v_override in ('stop_bar', 'memory_sequence', 'different_symbol') then
      return v_override::public.mini_game_type;
    end if;
  end if;
  v_index := private.mini_game_random_index(3, null);
  return (array['stop_bar', 'memory_sequence', 'different_symbol']::public.mini_game_type[])[v_index + 1];
end;
$$;

create or replace function private.generate_mini_game_spec(
  p_game_type public.mini_game_type,
  p_seed bytea
)
returns table(participant_spec jsonb, expected_result jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target numeric;
  v_speed numeric;
  v_direction integer;
  v_symbols text[] := array['star', 'circle', 'triangle', 'diamond'];
  v_sequence jsonb := '[]'::jsonb;
  v_grid jsonb := '[]'::jsonb;
  v_target_cell integer;
begin
  if octet_length(p_seed) <> 32 then
    raise exception using errcode = 'P0001', message = 'INVALID_SEED';
  end if;
  case p_game_type
    when 'stop_bar' then
      v_target := (10 + get_byte(p_seed, 0) % 81)::numeric / 100;
      v_speed := (35 + get_byte(p_seed, 1) % 31)::numeric / 100;
      v_direction := case when get_byte(p_seed, 2) % 2 = 0 then 1 else -1 end;
      participant_spec := jsonb_build_object(
        'type', 'stop_bar', 'targetPosition', v_target,
        'markerSpeed', v_speed, 'initialDirection', v_direction,
        'maximumDurationMs', 10000
      );
      expected_result := jsonb_build_object('targetPosition', v_target);
    when 'memory_sequence' then
      for v_i in 0..5 loop
        v_sequence := v_sequence || jsonb_build_array(v_symbols[(get_byte(p_seed, v_i) % 4) + 1]);
      end loop;
      participant_spec := jsonb_build_object(
        'type', 'memory_sequence', 'symbols', v_symbols,
        'sequence', v_sequence, 'displayIntervalMs', 650,
        'maximumDurationMs', 30000
      );
      expected_result := jsonb_build_object('sequence', v_sequence);
    when 'different_symbol' then
      v_target_cell := get_byte(p_seed, 0) % 25;
      for v_i in 0..24 loop
        v_grid := v_grid || jsonb_build_array(case when v_i = v_target_cell then 'diamond' else 'circle' end);
      end loop;
      participant_spec := jsonb_build_object(
        'type', 'different_symbol', 'gridSize', 5, 'cells', v_grid,
        'incorrectTapPenaltyMs', 500, 'maximumDurationMs', 30000
      );
      expected_result := jsonb_build_object('targetCell', v_target_cell);
  end case;
  return next;
end;
$$;

create or replace function private.apply_mini_game_score_delta(
  p_challenge_id uuid,
  p_player_id uuid,
  p_requested_delta integer,
  p_reason_code text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_challenge public.mini_game_challenges%rowtype; v_before bigint; v_after bigint; v_actual integer;
begin
  select * into strict v_challenge from public.mini_game_challenges where id = p_challenge_id;
  select score into v_before from public.players
  where id = p_player_id and room_id = v_challenge.room_id and match_participant for update;
  if v_before is null then raise exception using errcode = 'P0001', message = 'INVALID_TARGET'; end if;
  v_after := greatest(0, v_before + p_requested_delta);
  v_actual := (v_after - v_before)::integer;
  if v_actual <> p_requested_delta then
    raise exception using errcode = 'P0001', message = 'INSUFFICIENT_SCORE';
  end if;
  update public.players set score = v_after where id = p_player_id;
  insert into public.score_ledger (
    room_id, round_id, player_id, decision_id, action_draw_id,
    mini_game_challenge_id, delta, balance_after, source_key, reason_code
  ) values (
    v_challenge.room_id, v_challenge.round_id, p_player_id, null, null,
    p_challenge_id, v_actual, v_after,
    'mini:' || p_challenge_id::text || ':' || p_player_id::text || ':' || p_reason_code,
    p_reason_code
  );
  return v_actual;
end;
$$;

create or replace function private.finalize_mini_game_phase(p_room_id uuid, p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_round public.rounds%rowtype;
  v_top_count integer;
  v_winner_id uuid;
  v_deadline timestamptz;
begin
  select * into strict v_room from public.rooms where id = p_room_id for update;
  select * into strict v_round from public.rounds where id = p_round_id for update;
  if exists (select 1 from public.mini_game_challenges where round_id = p_round_id and status in ('queued', 'active', 'tiebreaker_active')) then return; end if;
  if v_room.current_phase <> 'mini_game_resolution' then return; end if;
  v_deadline := case when v_round.round_number < v_room.total_rounds then statement_timestamp() + interval '8 seconds' else null end;
  update public.rounds set status = 'completed', phase = 'round_summary',
    current_turn_index = null, current_turn_player_id = null, turn_deadline = null,
    completed_at = statement_timestamp(), phase_deadline = v_deadline
  where id = p_round_id;
  perform private.record_game_event(p_room_id, v_round.round_number, 'mini_game_phase_completed', null, '{}');
  perform private.record_game_event(p_room_id, v_round.round_number, 'round_completed', null, jsonb_build_object('roundNumber', v_round.round_number));
  perform private.record_game_event(p_room_id, v_round.round_number, 'scores_updated', null, jsonb_build_object('roundNumber', v_round.round_number));
  if v_round.round_number >= v_room.total_rounds then
    select count(*) into v_top_count from public.players p
    where p.room_id = p_room_id and p.match_participant
      and p.score = (select max(score) from public.players where room_id = p_room_id and match_participant);
    if v_top_count = 1 then
      select id into v_winner_id from public.players
      where room_id = p_room_id and match_participant order by score desc, join_order limit 1;
    end if;
    update public.rooms set status = 'completed', current_phase = 'completed',
      current_turn_player_id = null, phase_deadline = null, completed_at = statement_timestamp(),
      tiebreaker_required = v_top_count > 1, match_version = match_version + 1
    where id = p_room_id;
    perform private.record_game_event(p_room_id, v_round.round_number, 'match_completed', null,
      jsonb_build_object('winnerPlayerId', v_winner_id, 'tiebreakerRequired', v_top_count > 1));
  else
    update public.rooms set current_phase = 'round_summary', current_turn_player_id = null,
      phase_deadline = v_deadline, match_version = match_version + 1 where id = p_room_id;
  end if;
end;
$$;

create or replace function private.start_next_mini_game(p_room_id uuid, p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge public.mini_game_challenges%rowtype;
  v_challenger public.players%rowtype;
  v_opponent public.players%rowtype;
  v_stake integer;
  v_game public.mini_game_type;
  v_seed bytea;
  v_spec record;
  v_starts_at timestamptz;
  v_deadline timestamptz;
begin
  perform 1 from public.rooms where id = p_room_id for update;
  if exists (select 1 from public.mini_game_challenges where room_id = p_room_id and status in ('active', 'tiebreaker_active')) then return; end if;
  loop
    select * into v_challenge from public.mini_game_challenges
    where room_id = p_room_id and round_id = p_round_id and status = 'queued'
    order by queue_position limit 1 for update skip locked;
    if v_challenge.id is null then
      perform private.finalize_mini_game_phase(p_room_id, p_round_id);
      return;
    end if;
    select * into v_challenger from public.players where id = v_challenge.challenger_player_id for update;
    select * into v_opponent from public.players where id = v_challenge.opponent_player_id for update;
    if v_challenger.left_at is not null or v_opponent.left_at is not null
      or not v_challenger.match_participant or not v_opponent.match_participant
      or v_challenger.mini_game_token_used or v_challenger.score <= 0 or v_opponent.score <= 0 then
      update public.mini_game_challenges set status = 'cancelled', cancelled_at = statement_timestamp(),
        cancellation_reason = 'INVALID_AT_QUEUE_START' where id = v_challenge.id;
      delete from private.mini_game_participant_locks where challenge_id = v_challenge.id;
      continue;
    end if;
    v_stake := least(v_challenger.score, v_opponent.score)::integer;
    if v_challenge.stake_type = 'half' then v_stake := floor((v_stake / 2)::numeric / 50)::integer * 50; end if;
    if v_stake <= 0 then
      update public.mini_game_challenges set status = 'cancelled', cancelled_at = statement_timestamp(),
        cancellation_reason = 'ZERO_STAKE' where id = v_challenge.id;
      delete from private.mini_game_participant_locks where challenge_id = v_challenge.id;
      continue;
    end if;
    v_game := private.select_mini_game_type();
    v_seed := extensions.gen_random_bytes(32);
    select * into strict v_spec from private.generate_mini_game_spec(v_game, v_seed);
    v_starts_at := statement_timestamp() + interval '3 seconds';
    v_deadline := v_starts_at + interval '35 seconds';
    update public.mini_game_challenges set stake_per_player = v_stake, pot = v_stake * 2,
      game_type = v_game, status = 'active', starts_at = v_starts_at,
      submission_deadline = v_deadline, started_at = statement_timestamp()
    where id = v_challenge.id;
    insert into private.mini_game_specs(challenge_id, attempt, game_type, seed, participant_spec, expected_result)
    values(v_challenge.id, 1, v_game, v_seed, v_spec.participant_spec, v_spec.expected_result);
    perform private.apply_mini_game_score_delta(v_challenge.id, v_challenger.id, -v_stake, 'escrow_lock_challenger');
    perform private.apply_mini_game_score_delta(v_challenge.id, v_opponent.id, -v_stake, 'escrow_lock_opponent');
    update public.players set mini_game_token_used = true where id = v_challenger.id;
    update public.rounds set phase = 'mini_game_resolution', phase_deadline = v_deadline where id = p_round_id;
    update public.rooms set current_phase = 'mini_game_resolution', phase_deadline = v_deadline,
      current_turn_player_id = null, match_version = match_version + 1 where id = p_room_id;
    perform private.record_game_event(p_room_id, v_challenge.round_number, 'mini_game_started', v_challenger.id,
      jsonb_build_object('challengeId', v_challenge.id, 'opponentPlayerId', v_opponent.id,
        'stakePerPlayer', v_stake, 'pot', v_stake * 2, 'gameType', v_game));
    return;
  end loop;
end;
$$;

create or replace function private.settle_mini_game(
  p_challenge_id uuid,
  p_winner_id uuid,
  p_method public.mini_game_resolution_method
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_challenge public.mini_game_challenges%rowtype; v_loser uuid;
begin
  select * into strict v_challenge from public.mini_game_challenges where id = p_challenge_id for update;
  if v_challenge.status = 'resolved' then return; end if;
  if v_challenge.status not in ('active', 'tiebreaker_active') then
    raise exception using errcode = 'P0001', message = 'CHALLENGE_NOT_ACTIVE';
  end if;
  if p_winner_id not in (v_challenge.challenger_player_id, v_challenge.opponent_player_id) then
    raise exception using errcode = 'P0001', message = 'INVALID_WINNER';
  end if;
  v_loser := case when p_winner_id = v_challenge.challenger_player_id then v_challenge.opponent_player_id else v_challenge.challenger_player_id end;
  perform private.apply_mini_game_score_delta(v_challenge.id, p_winner_id, v_challenge.pot, 'pot_award');
  update public.players set challenges_won = challenges_won + 1 where id = p_winner_id;
  update public.players set challenges_lost = challenges_lost + 1 where id = v_loser;
  update public.mini_game_challenges set status = 'resolved', winner_player_id = p_winner_id,
    resolution_method = p_method, completed_at = statement_timestamp() where id = v_challenge.id;
  delete from private.mini_game_participant_locks where challenge_id = v_challenge.id;
  update public.rooms set match_version = match_version + 1 where id = v_challenge.room_id;
  perform private.record_game_event(v_challenge.room_id, v_challenge.round_number, 'mini_game_resolved', p_winner_id,
    jsonb_build_object('challengeId', v_challenge.id, 'winnerPlayerId', p_winner_id,
      'pot', v_challenge.pot, 'resolutionMethod', p_method));
  perform private.start_next_mini_game(v_challenge.room_id, v_challenge.round_id);
end;
$$;

create or replace function private.start_mini_game_tiebreaker(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_challenge public.mini_game_challenges%rowtype; v_seed bytea; v_spec record; v_start timestamptz; v_deadline timestamptz;
begin
  select * into strict v_challenge from public.mini_game_challenges where id = p_challenge_id for update;
  if v_challenge.current_attempt <> 1 or v_challenge.status <> 'active' then return; end if;
  v_seed := extensions.gen_random_bytes(32);
  select * into strict v_spec from private.generate_mini_game_spec('stop_bar', v_seed);
  v_start := statement_timestamp() + interval '3 seconds';
  v_deadline := v_start + interval '18 seconds';
  insert into private.mini_game_specs(challenge_id, attempt, game_type, seed, participant_spec, expected_result)
  values(v_challenge.id, 2, 'stop_bar', v_seed, v_spec.participant_spec, v_spec.expected_result);
  update public.mini_game_challenges set status = 'tiebreaker_active', current_attempt = 2,
    game_type = 'stop_bar', starts_at = v_start, submission_deadline = v_deadline where id = v_challenge.id;
  update public.rounds set phase_deadline = v_deadline where id = v_challenge.round_id;
  update public.rooms set phase_deadline = v_deadline, match_version = match_version + 1 where id = v_challenge.room_id;
  update public.players set challenges_tied = challenges_tied + 1
    where id in (v_challenge.challenger_player_id, v_challenge.opponent_player_id);
  perform private.record_game_event(v_challenge.room_id, v_challenge.round_number, 'mini_game_tiebreaker_started', null,
    jsonb_build_object('challengeId', v_challenge.id));
end;
$$;

create or replace function private.resolve_mini_game_if_ready(p_challenge_id uuid, p_force boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge public.mini_game_challenges%rowtype;
  v_first record;
  v_second record;
  v_total integer;
  v_valid integer;
  v_winner uuid;
  v_tied boolean := false;
  v_method public.mini_game_resolution_method;
begin
  select * into strict v_challenge from public.mini_game_challenges where id = p_challenge_id for update;
  if v_challenge.status not in ('active', 'tiebreaker_active') then return; end if;
  select count(*), count(*) filter (where validation_status = 'accepted') into v_total, v_valid
  from public.mini_game_submissions where challenge_id = v_challenge.id and attempt = v_challenge.current_attempt;
  if not p_force and v_total < 2 then return; end if;
  if p_force and v_challenge.submission_deadline > statement_timestamp() then
    raise exception using errcode = 'P0001', message = 'DEADLINE_NOT_EXPIRED';
  end if;
  if v_valid = 1 then
    select player_id into v_winner from public.mini_game_submissions
    where challenge_id = v_challenge.id and attempt = v_challenge.current_attempt and validation_status = 'accepted';
    v_method := (case when v_total = 2 then 'opponent_invalid' else 'opponent_timeout' end)::public.mini_game_resolution_method;
  elsif v_valid = 0 then
    v_winner := (array[v_challenge.challenger_player_id, v_challenge.opponent_player_id])[
      private.mini_game_random_index(2, 'scoreup.test_mini_random_winner') + 1];
    v_method := 'random_fallback';
  else
    select player_id, normalized_result into v_first from public.mini_game_submissions
    where challenge_id = v_challenge.id and attempt = v_challenge.current_attempt and validation_status = 'accepted'
    order by player_id limit 1;
    select player_id, normalized_result into v_second from public.mini_game_submissions
    where challenge_id = v_challenge.id and attempt = v_challenge.current_attempt and validation_status = 'accepted'
    order by player_id offset 1 limit 1;
    if v_challenge.game_type = 'memory_sequence' then
      if (v_first.normalized_result->>'primary')::integer > (v_second.normalized_result->>'primary')::integer then v_winner := v_first.player_id;
      elsif (v_first.normalized_result->>'primary')::integer < (v_second.normalized_result->>'primary')::integer then v_winner := v_second.player_id;
      elsif (v_first.normalized_result->>'secondary')::integer < (v_second.normalized_result->>'secondary')::integer then v_winner := v_first.player_id;
      elsif (v_first.normalized_result->>'secondary')::integer > (v_second.normalized_result->>'secondary')::integer then v_winner := v_second.player_id;
      else v_tied := true; end if;
    else
      if (v_first.normalized_result->>'primary')::integer < (v_second.normalized_result->>'primary')::integer then v_winner := v_first.player_id;
      elsif (v_first.normalized_result->>'primary')::integer > (v_second.normalized_result->>'primary')::integer then v_winner := v_second.player_id;
      elsif (v_first.normalized_result->>'secondary')::integer < (v_second.normalized_result->>'secondary')::integer then v_winner := v_first.player_id;
      elsif (v_first.normalized_result->>'secondary')::integer > (v_second.normalized_result->>'secondary')::integer then v_winner := v_second.player_id;
      else v_tied := true; end if;
    end if;
    if v_tied and v_challenge.current_attempt = 1 then
      perform private.start_mini_game_tiebreaker(v_challenge.id);
      return;
    elsif v_tied then
      v_winner := (array[v_challenge.challenger_player_id, v_challenge.opponent_player_id])[
        private.mini_game_random_index(2, 'scoreup.test_mini_random_winner') + 1];
      v_method := 'random_fallback';
    else
      v_method := (case when v_challenge.current_attempt = 1 then 'game_result' else 'tiebreaker_result' end)::public.mini_game_resolution_method;
    end if;
  end if;
  perform private.settle_mini_game(v_challenge.id, v_winner, v_method);
end;
$$;

create or replace function private.refund_mini_game_escrow(p_challenge_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_challenge public.mini_game_challenges%rowtype;
begin
  select * into strict v_challenge from public.mini_game_challenges where id = p_challenge_id for update;
  if v_challenge.status not in ('active', 'tiebreaker_active') then return; end if;
  perform private.apply_mini_game_score_delta(v_challenge.id, v_challenge.challenger_player_id, v_challenge.stake_per_player, 'escrow_refund_challenger');
  perform private.apply_mini_game_score_delta(v_challenge.id, v_challenge.opponent_player_id, v_challenge.stake_per_player, 'escrow_refund_opponent');
  update public.mini_game_challenges set status = 'refunded', resolution_method = 'server_refund',
    cancellation_reason = p_reason, completed_at = statement_timestamp() where id = v_challenge.id;
  delete from private.mini_game_participant_locks where challenge_id = v_challenge.id;
  perform private.start_next_mini_game(v_challenge.room_id, v_challenge.round_id);
end;
$$;

create or replace function private.validate_mini_game_submission(
  p_challenge_id uuid,
  p_attempt smallint,
  p_payload jsonb
)
returns table(validation_status public.mini_game_validation_status, validation_reason text, normalized_result jsonb, elapsed_ms integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spec private.mini_game_specs%rowtype;
  v_elapsed integer;
  v_position numeric;
  v_target numeric;
  v_sequence jsonb;
  v_expected jsonb;
  v_claimed integer;
  v_actual integer := 0;
  v_cell integer;
  v_incorrect integer;
begin
  select * into strict v_spec from private.mini_game_specs where challenge_id = p_challenge_id and attempt = p_attempt;
  validation_status := 'rejected'; validation_reason := null; normalized_result := '{}'::jsonb; elapsed_ms := null;
  begin v_elapsed := (p_payload->>'elapsedMs')::integer; exception when others then validation_reason := 'MALFORMED_PAYLOAD'; return next; return; end;
  elapsed_ms := v_elapsed;
  if v_elapsed is null or v_elapsed < 100 or v_elapsed > coalesce((v_spec.participant_spec->>'maximumDurationMs')::integer, 30000) then
    validation_reason := 'INFEASIBLE_TIMING'; return next; return;
  end if;
  case v_spec.game_type
    when 'stop_bar' then
      begin v_position := (p_payload->>'position')::numeric; exception when others then validation_reason := 'MALFORMED_PAYLOAD'; return next; return; end;
      if v_position < 0 or v_position > 1 then validation_reason := 'INVALID_POSITION'; return next; return; end if;
      v_target := (v_spec.expected_result->>'targetPosition')::numeric;
      normalized_result := jsonb_build_object('primary', round(abs(v_position - v_target) * 1000000)::integer, 'secondary', v_elapsed);
    when 'memory_sequence' then
      v_sequence := p_payload->'sequence'; v_expected := v_spec.expected_result->'sequence';
      begin v_claimed := (p_payload->>'correctConsecutive')::integer; exception when others then validation_reason := 'MALFORMED_PAYLOAD'; return next; return; end;
      if jsonb_typeof(v_sequence) <> 'array' or jsonb_array_length(v_sequence) > jsonb_array_length(v_expected) then validation_reason := 'INVALID_SEQUENCE'; return next; return; end if;
      for v_i in 0..jsonb_array_length(v_sequence) - 1 loop
        if not ((v_sequence->>v_i) in ('star', 'circle', 'triangle', 'diamond')) then validation_reason := 'INVALID_SYMBOL'; return next; return; end if;
        if v_sequence->>v_i = v_expected->>v_i and v_actual = v_i then v_actual := v_actual + 1; end if;
      end loop;
      if v_claimed <> v_actual then validation_reason := 'INVALID_ACCURACY'; return next; return; end if;
      normalized_result := jsonb_build_object('primary', v_actual, 'secondary', v_elapsed);
    when 'different_symbol' then
      begin v_cell := (p_payload->>'selectedCell')::integer; v_incorrect := (p_payload->>'incorrectTaps')::integer;
      exception when others then validation_reason := 'MALFORMED_PAYLOAD'; return next; return; end;
      if v_cell < 0 or v_cell >= 25 or v_incorrect < 0 or v_incorrect > 20 then validation_reason := 'INVALID_SELECTION'; return next; return; end if;
      normalized_result := jsonb_build_object(
        'primary', case when v_cell = (v_spec.expected_result->>'targetCell')::integer then v_elapsed + v_incorrect * 500 else 100000000 + v_elapsed end,
        'secondary', v_elapsed
      );
  end case;
  validation_status := 'accepted'; validation_reason := null;
  return next;
end;
$$;

create or replace function private.finish_round_or_advance_turn(p_room_id uuid, p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype; v_round public.rounds%rowtype; v_unresolved_count integer;
  v_next_player_id uuid; v_next_position integer; v_final_card public.round_cards_private%rowtype;
  v_decision_id uuid; v_deadline timestamptz;
begin
  loop
    select * into v_room from public.rooms where id = p_room_id for update;
    select * into v_round from public.rounds where id = p_round_id for update;
    select count(*) into v_unresolved_count from public.round_cards_private
      where round_id = p_round_id and resolution_status = 'unresolved';
    if v_unresolved_count = 1 then
      select * into v_final_card from public.round_cards_private where round_id = p_round_id and resolution_status = 'unresolved' for update;
      v_decision_id := extensions.gen_random_uuid();
      insert into public.point_decisions(id, round_id, room_id, round_number, acting_player_id, decision_type, idempotency_key, result_metadata)
      values(v_decision_id, p_round_id, p_room_id, v_round.round_number, v_final_card.player_id, 'auto_lock_in', extensions.gen_random_uuid(), jsonb_build_object('pointsAwarded', v_final_card.current_value));
      update public.round_cards_private set resolution_status = 'resolved', resolution_type = 'auto_lock_in', points_awarded = current_value, resolved_at = statement_timestamp() where id = v_final_card.id;
      perform private.apply_score_award(p_room_id, p_round_id, v_final_card.player_id, v_decision_id, v_final_card.current_value, 'auto:' || p_round_id::text || ':' || v_final_card.player_id::text);
      update public.players set lock_ins_count = lock_ins_count + 1 where id = v_final_card.player_id;
      perform private.record_game_event(p_room_id, v_round.round_number, 'player_locked_in', v_final_card.player_id, jsonb_build_object('automatic', true));
      continue;
    end if;
    if v_unresolved_count = 0 then
      update public.rounds set phase = 'mini_game_resolution', current_turn_index = null,
        current_turn_player_id = null, turn_deadline = null, phase_deadline = null where id = p_round_id;
      update public.rooms set current_phase = 'mini_game_resolution', current_turn_player_id = null,
        phase_deadline = null, match_version = match_version + 1 where id = p_room_id;
      perform private.start_next_mini_game(p_room_id, p_round_id);
      return;
    end if;
    select c.player_id, position.ordinality::integer - 1 into v_next_player_id, v_next_position
    from unnest(v_round.decision_order) with ordinality as position(player_id, ordinality)
    join public.round_cards_private c on c.round_id = p_round_id and c.player_id = position.player_id
    where c.resolution_status = 'unresolved' order by position.ordinality limit 1;
    v_deadline := statement_timestamp() + make_interval(secs => v_room.turn_timer_seconds);
    update public.rounds set current_turn_index = v_next_position, current_turn_player_id = v_next_player_id,
      turn_deadline = v_deadline, phase_deadline = v_deadline where id = p_round_id;
    update public.rooms set current_turn_player_id = v_next_player_id, phase_deadline = v_deadline,
      match_version = match_version + 1 where id = p_room_id;
    perform private.record_game_event(p_room_id, v_round.round_number, 'turn_started', v_next_player_id,
      jsonb_build_object('turnIndex', v_next_position, 'deadline', v_deadline));
    return;
  end loop;
end;
$$;

alter function private.build_match_snapshot(uuid, uuid) rename to build_action_match_snapshot;

create or replace function private.build_match_snapshot(p_room_id uuid, p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (select private.build_action_match_snapshot(p_room_id, p_user_id) value),
  actor as (
    select * from public.players where room_id = p_room_id and auth_user_id = p_user_id
      and match_participant and left_at is null
  ),
  room_state as (select * from public.rooms where id = p_room_id),
  current_round as (
    select rd.* from public.rounds rd join room_state r on r.current_round = rd.round_number
    where rd.room_id = p_room_id
  ),
  own_challenge as (
    select c.* from public.mini_game_challenges c join current_round rd on rd.id = c.round_id
    join actor a on a.id in (c.challenger_player_id, c.opponent_player_id)
    where c.status in ('queued', 'active', 'tiebreaker_active')
    order by c.queue_position limit 1
  ),
  latest_own as (
    select c.* from public.mini_game_challenges c join current_round rd on rd.id = c.round_id
    join actor a on a.id in (c.challenger_player_id, c.opponent_player_id)
    order by c.queue_position desc limit 1
  ),
  visible_challenge as (select * from own_challenge union all select * from latest_own where not exists(select 1 from own_challenge) limit 1)
  select base.value || jsonb_build_object(
    'miniGameState', jsonb_build_object(
      'tokenAvailable', not a.mini_game_token_used,
      'eligibleOpponentIds', coalesce((
        select jsonb_agg(p.id order by p.join_order) from public.players p
        where r.current_phase = 'point_decisions' and a.score > 0
          and p.room_id = p_room_id and p.match_participant and p.left_at is null
          and p.id <> a.id and p.score > 0
          and not exists(select 1 from private.mini_game_participant_locks l where l.round_id = rd.id and l.player_id in (a.id, p.id))
      ), '[]'::jsonb),
      'roomQueueCount', (select count(*) from public.mini_game_challenges c where c.round_id = rd.id and c.status = 'queued'),
      'roomHasActiveChallenge', exists(select 1 from public.mini_game_challenges c where c.round_id = rd.id and c.status in ('active', 'tiebreaker_active')),
      'challenge', case when vc.id is null then null else jsonb_build_object(
        'id', vc.id, 'status', vc.status, 'queuePosition', vc.queue_position,
        'challengerPlayerId', vc.challenger_player_id, 'opponentPlayerId', vc.opponent_player_id,
        'isChallenger', vc.challenger_player_id = a.id, 'stakeType', vc.stake_type,
        'stakePerPlayer', vc.stake_per_player, 'pot', vc.pot, 'gameType', vc.game_type,
        'attempt', vc.current_attempt, 'startsAt', vc.starts_at,
        'submissionDeadline', vc.submission_deadline,
        'specification', case when vc.status in ('active', 'tiebreaker_active') then (
          select s.participant_spec from private.mini_game_specs s where s.challenge_id = vc.id and s.attempt = vc.current_attempt
        ) else null end,
        'ownSubmitted', exists(select 1 from public.mini_game_submissions s where s.challenge_id = vc.id and s.attempt = vc.current_attempt and s.player_id = a.id),
        'opponentSubmitted', exists(select 1 from public.mini_game_submissions s where s.challenge_id = vc.id and s.attempt = vc.current_attempt and s.player_id <> a.id and s.validation_status = 'accepted'),
        'winnerPlayerId', vc.winner_player_id, 'resolutionMethod', vc.resolution_method,
        'completedAt', vc.completed_at, 'cancellationReason', vc.cancellation_reason
      ) end
    )
  )
  from base join actor a on true join room_state r on true left join current_round rd on true left join visible_challenge vc on true;
$$;

create or replace function public.request_mini_game_challenge(
  p_room_id uuid,
  p_opponent_player_id uuid,
  p_stake_type public.mini_game_stake_type,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := private.require_anonymous_user(); v_room public.rooms%rowtype; v_round public.rounds%rowtype; v_actor public.players%rowtype; v_opponent public.players%rowtype; v_id uuid;
begin
  if p_opponent_player_id is null or p_stake_type is null or p_idempotency_key is null then raise exception using errcode = 'P0001', message = 'INVALID_INPUT'; end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  select * into v_actor from public.players where room_id = p_room_id and auth_user_id = v_user and match_participant and left_at is null for update;
  if v_actor.id is null then raise exception using errcode = 'P0001', message = 'NOT_MATCH_PARTICIPANT'; end if;
  if exists(select 1 from public.mini_game_challenges where room_id = p_room_id and idempotency_key = p_idempotency_key and challenger_player_id = v_actor.id) then return private.build_match_snapshot(p_room_id, v_user); end if;
  if v_room.current_phase <> 'point_decisions' or v_room.status <> 'in_progress' then raise exception using errcode = 'P0001', message = 'WRONG_PHASE'; end if;
  if v_actor.mini_game_token_used then raise exception using errcode = 'P0001', message = 'MINI_GAME_TOKEN_USED'; end if;
  if v_actor.score <= 0 then raise exception using errcode = 'P0001', message = 'ZERO_STAKE'; end if;
  if p_opponent_player_id = v_actor.id then raise exception using errcode = 'P0001', message = 'SELF_MINI_GAME_CHALLENGE'; end if;
  select * into v_opponent from public.players where id = p_opponent_player_id and room_id = p_room_id and match_participant and left_at is null for update;
  if v_opponent.id is null then raise exception using errcode = 'P0001', message = 'INVALID_TARGET'; end if;
  if v_opponent.score <= 0 then raise exception using errcode = 'P0001', message = 'ZERO_STAKE'; end if;
  select * into strict v_round from public.rounds where room_id = p_room_id and round_number = v_room.current_round;
  if exists(select 1 from private.mini_game_participant_locks where round_id = v_round.id and player_id in (v_actor.id, v_opponent.id)) then
    raise exception using errcode = 'P0001', message = 'MINI_GAME_PARTICIPANT_BUSY';
  end if;
  v_id := extensions.gen_random_uuid();
  insert into public.mini_game_challenges(id, room_id, round_id, round_number, challenger_player_id, opponent_player_id, stake_type, idempotency_key)
  values(v_id, p_room_id, v_round.id, v_round.round_number, v_actor.id, v_opponent.id, p_stake_type, p_idempotency_key);
  insert into private.mini_game_participant_locks(room_id, round_id, player_id, challenge_id)
  values(p_room_id, v_round.id, v_actor.id, v_id), (p_room_id, v_round.id, v_opponent.id, v_id);
  update public.rooms set match_version = match_version + 1 where id = p_room_id;
  perform private.record_game_event(p_room_id, v_round.round_number, 'mini_game_requested', v_actor.id,
    jsonb_build_object('opponentPlayerId', v_opponent.id, 'stakeType', p_stake_type));
  return private.build_match_snapshot(p_room_id, v_user);
exception when unique_violation then
  raise exception using errcode = 'P0001', message = 'MINI_GAME_PARTICIPANT_BUSY';
end;
$$;

create or replace function public.process_mini_game_queue(p_room_id uuid, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := private.require_anonymous_user(); v_room public.rooms%rowtype; v_round public.rounds%rowtype;
begin
  if p_idempotency_key is null then raise exception using errcode = 'P0001', message = 'INVALID_INPUT'; end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not private.is_match_participant(p_room_id, v_user) then raise exception using errcode = 'P0001', message = 'NOT_MATCH_PARTICIPANT'; end if;
  if v_room.current_phase <> 'mini_game_resolution' then return private.build_match_snapshot(p_room_id, v_user); end if;
  select * into strict v_round from public.rounds where room_id = p_room_id and round_number = v_room.current_round;
  perform private.start_next_mini_game(p_room_id, v_round.id);
  return private.build_match_snapshot(p_room_id, v_user);
end;
$$;

create or replace function public.submit_mini_game_result(
  p_room_id uuid,
  p_challenge_id uuid,
  p_result_payload jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := private.require_anonymous_user(); v_challenge public.mini_game_challenges%rowtype; v_player public.players%rowtype; v_validation record;
begin
  if p_challenge_id is null or p_result_payload is null or p_idempotency_key is null then raise exception using errcode = 'P0001', message = 'INVALID_INPUT'; end if;
  perform 1 from public.rooms where id = p_room_id for update;
  select * into v_challenge from public.mini_game_challenges where id = p_challenge_id and room_id = p_room_id for update;
  if v_challenge.id is null then raise exception using errcode = 'P0001', message = 'MINI_GAME_NOT_FOUND'; end if;
  select * into v_player from public.players where room_id = p_room_id and auth_user_id = v_user and id in (v_challenge.challenger_player_id, v_challenge.opponent_player_id);
  if v_player.id is null then raise exception using errcode = 'P0001', message = 'NOT_MINI_GAME_PARTICIPANT'; end if;
  if exists(select 1 from public.mini_game_submissions where room_id = p_room_id and idempotency_key = p_idempotency_key and player_id = v_player.id) then return private.build_match_snapshot(p_room_id, v_user); end if;
  if v_challenge.status not in ('active', 'tiebreaker_active') then raise exception using errcode = 'P0001', message = 'CHALLENGE_NOT_ACTIVE'; end if;
  if statement_timestamp() < v_challenge.starts_at then raise exception using errcode = 'P0001', message = 'MINI_GAME_NOT_STARTED'; end if;
  if statement_timestamp() > v_challenge.submission_deadline then raise exception using errcode = 'P0001', message = 'MINI_GAME_DEADLINE_EXPIRED'; end if;
  if exists(select 1 from public.mini_game_submissions where challenge_id = v_challenge.id and attempt = v_challenge.current_attempt and player_id = v_player.id) then
    raise exception using errcode = 'P0001', message = 'MINI_GAME_ALREADY_SUBMITTED';
  end if;
  select * into strict v_validation from private.validate_mini_game_submission(v_challenge.id, v_challenge.current_attempt, p_result_payload);
  insert into public.mini_game_submissions(challenge_id, room_id, round_id, attempt, player_id, result_payload,
    client_elapsed_ms, normalized_result, validation_status, validation_reason, idempotency_key)
  values(v_challenge.id, p_room_id, v_challenge.round_id, v_challenge.current_attempt, v_player.id, p_result_payload,
    v_validation.elapsed_ms, v_validation.normalized_result, v_validation.validation_status, v_validation.validation_reason, p_idempotency_key);
  update public.rooms set match_version = match_version + 1 where id = p_room_id;
  perform private.record_game_event(p_room_id, v_challenge.round_number, 'mini_game_submission_received', v_player.id,
    jsonb_build_object('challengeId', v_challenge.id, 'accepted', v_validation.validation_status = 'accepted'));
  perform private.resolve_mini_game_if_ready(v_challenge.id, false);
  return private.build_match_snapshot(p_room_id, v_user);
end;
$$;

create or replace function public.process_expired_mini_game(p_room_id uuid, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := private.require_anonymous_user(); v_challenge public.mini_game_challenges%rowtype;
begin
  if p_idempotency_key is null then raise exception using errcode = 'P0001', message = 'INVALID_INPUT'; end if;
  perform 1 from public.rooms where id = p_room_id for update;
  if not private.is_match_participant(p_room_id, v_user) then raise exception using errcode = 'P0001', message = 'NOT_MATCH_PARTICIPANT'; end if;
  select * into v_challenge from public.mini_game_challenges where room_id = p_room_id and status in ('active', 'tiebreaker_active') order by queue_position limit 1 for update;
  if v_challenge.id is null then return private.build_match_snapshot(p_room_id, v_user); end if;
  perform private.resolve_mini_game_if_ready(v_challenge.id, true);
  return private.build_match_snapshot(p_room_id, v_user);
end;
$$;

create or replace function public.get_mini_game_snapshot(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := private.require_anonymous_user();
begin
  if not private.is_match_participant(p_room_id, v_user) then raise exception using errcode = 'P0001', message = 'NOT_MATCH_PARTICIPANT'; end if;
  return private.build_match_snapshot(p_room_id, v_user);
end;
$$;

create trigger mini_game_challenges_broadcast_game_change after insert or update on public.mini_game_challenges
for each row execute function private.broadcast_game_change();
create trigger mini_game_submissions_broadcast_game_change after insert or update on public.mini_game_submissions
for each row execute function private.broadcast_game_change();

alter table public.mini_game_challenges enable row level security;
alter table public.mini_game_challenges force row level security;
alter table public.mini_game_submissions enable row level security;
alter table public.mini_game_submissions force row level security;
create policy mini_game_challenges_participant_select on public.mini_game_challenges
for select to authenticated using (private.is_mini_game_participant(id));
create policy mini_game_submissions_owner_select on public.mini_game_submissions
for select to authenticated using (private.is_mini_game_submission_owner(player_id));

revoke all on table public.mini_game_challenges, public.mini_game_submissions from public, anon, authenticated;
grant select on public.mini_game_challenges, public.mini_game_submissions to authenticated;
revoke all on table private.mini_game_participant_locks, private.mini_game_specs from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_room_member(uuid, uuid) to authenticated;
grant execute on function private.is_match_participant(uuid, uuid) to authenticated;
grant execute on function private.is_card_owner(uuid, uuid) to authenticated;
grant execute on function private.is_action_owner(uuid, uuid) to authenticated;
grant execute on function private.is_mini_game_participant(uuid, uuid) to authenticated;
grant execute on function private.is_mini_game_submission_owner(uuid, uuid) to authenticated;

revoke all on function public.request_mini_game_challenge(uuid, uuid, public.mini_game_stake_type, uuid) from public, anon;
revoke all on function public.process_mini_game_queue(uuid, uuid) from public, anon;
revoke all on function public.submit_mini_game_result(uuid, uuid, jsonb, uuid) from public, anon;
revoke all on function public.process_expired_mini_game(uuid, uuid) from public, anon;
revoke all on function public.get_mini_game_snapshot(uuid) from public, anon;
grant execute on function public.request_mini_game_challenge(uuid, uuid, public.mini_game_stake_type, uuid) to authenticated;
grant execute on function public.process_mini_game_queue(uuid, uuid) to authenticated;
grant execute on function public.submit_mini_game_result(uuid, uuid, jsonb, uuid) to authenticated;
grant execute on function public.process_expired_mini_game(uuid, uuid) to authenticated;
grant execute on function public.get_mini_game_snapshot(uuid) to authenticated;

comment on table public.mini_game_challenges is 'FIFO, escrow-backed Mini-Game queue. Detailed rows are visible only to the two participants.';
comment on table private.mini_game_specs is 'Protected deterministic seeds and independently derived expected results; no browser grants.';
comment on function public.request_mini_game_challenge is 'Queues one unavoidable Mini-Game request during point decisions; stakes and token lock only at actual start.';
