-- Milestone 6: authoritative completion, championship ranking, statistics, and rematches.

alter type public.game_phase add value if not exists 'finalizing' before 'completed';
alter type public.game_phase add value if not exists 'championship_tiebreaker' before 'completed';
alter type public.game_event_type add value if not exists 'match_finalizing';
alter type public.game_event_type add value if not exists 'championship_tiebreaker_started';
alter type public.game_event_type add value if not exists 'championship_submission_received';
alter type public.game_event_type add value if not exists 'championship_resolved';
alter type public.game_event_type add value if not exists 'rematch_created';

create type public.championship_status as enum ('active', 'resolved');
create type public.championship_resolution_method as enum (
  'skill', 'timing', 'timeout', 'secure_fallback'
);
create type public.championship_validation_status as enum ('accepted', 'rejected');
create type public.match_stat_category as enum (
  'lock_in_points', 'biggest_point_challenge', 'action_draws',
  'mini_game_wins', 'biggest_comeback'
);

create table public.championship_tiebreakers (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  status public.championship_status not null default 'active',
  starts_at timestamptz not null,
  submission_deadline timestamptz not null,
  winner_player_id uuid,
  resolution_method public.championship_resolution_method,
  resolved_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint championship_deadline_order check (submission_deadline > starts_at),
  constraint championship_winner_room_fk foreign key (room_id, winner_player_id)
    references public.players(room_id, id),
  constraint championship_resolution_shape check (
    (status = 'active' and winner_player_id is null and resolution_method is null and resolved_at is null)
    or (status = 'resolved' and winner_player_id is not null and resolution_method is not null and resolved_at is not null)
  )
);

create table public.championship_participants (
  room_id uuid not null references public.championship_tiebreakers(room_id) on delete cascade,
  player_id uuid not null,
  join_order bigint not null,
  primary key (room_id, player_id),
  constraint championship_participant_player_fk foreign key (room_id, player_id)
    references public.players(room_id, id)
);

create table private.championship_specs (
  room_id uuid primary key references public.championship_tiebreakers(room_id) on delete cascade,
  seed bytea not null check (octet_length(seed) = 32),
  participant_spec jsonb not null,
  expected_result jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint championship_participant_spec_object check (jsonb_typeof(participant_spec) = 'object'),
  constraint championship_expected_result_object check (jsonb_typeof(expected_result) = 'object')
);

create table public.championship_submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references public.championship_tiebreakers(room_id) on delete cascade,
  player_id uuid not null,
  idempotency_key uuid not null,
  validation_status public.championship_validation_status not null,
  validation_reason text,
  normalized_distance integer,
  elapsed_ms integer,
  submitted_at timestamptz not null default statement_timestamp(),
  constraint championship_submission_participant_fk foreign key (room_id, player_id)
    references public.championship_participants(room_id, player_id),
  constraint championship_submission_player_unique unique (room_id, player_id),
  constraint championship_submission_idempotency_unique unique (room_id, idempotency_key),
  constraint championship_submission_validation_shape check (
    (validation_status = 'accepted' and validation_reason is null and normalized_distance is not null and elapsed_ms is not null)
    or (validation_status = 'rejected' and validation_reason is not null and normalized_distance is null)
  )
);

create table public.match_results (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  winner_player_id uuid not null,
  resolution_method public.championship_resolution_method not null,
  completed_at timestamptz not null,
  constraint match_result_winner_room_fk foreign key (room_id, winner_player_id)
    references public.players(room_id, id)
);

create table public.match_result_players (
  room_id uuid not null references public.match_results(room_id) on delete cascade,
  player_id uuid not null,
  final_score bigint not null check (final_score >= 0),
  final_rank integer not null check (final_rank > 0),
  display_order integer not null check (display_order > 0),
  primary key (room_id, player_id),
  unique (room_id, display_order),
  constraint match_result_player_room_fk foreign key (room_id, player_id)
    references public.players(room_id, id)
);

create table public.match_stat_awards (
  room_id uuid not null references public.match_results(room_id) on delete cascade,
  category public.match_stat_category not null,
  player_id uuid not null,
  value bigint not null check (value > 0),
  primary key (room_id, category, player_id),
  constraint match_stat_player_room_fk foreign key (room_id, player_id)
    references public.players(room_id, id)
);

create table public.rematches (
  source_room_id uuid primary key references public.rooms(id) on delete restrict,
  rematch_room_id uuid not null unique references public.rooms(id) on delete restrict,
  requested_by_player_id uuid not null references public.players(id) on delete restrict,
  idempotency_key uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (source_room_id, idempotency_key),
  check (source_room_id <> rematch_room_id)
);

create or replace function private.is_championship_participant(
  p_room_id uuid, p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.championship_participants cp
    join public.players p on p.id = cp.player_id and p.room_id = cp.room_id
    where cp.room_id = p_room_id and p.auth_user_id = p_user_id
      and p.match_participant and p.left_at is null
  );
$$;

create or replace function private.championship_random_index(p_count integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_override text;
begin
  if p_count <= 0 then raise exception using errcode = 'P0001', message = 'INVALID_RANDOM_BOUND'; end if;
  if session_user = 'postgres' then
    v_override := pg_catalog.current_setting('scoreup.test_championship_random_winner', true);
    if v_override ~ '^\\d+$' then return (v_override::integer % p_count); end if;
  end if;
  return private.secure_random_index(p_count, null);
end;
$$;

create or replace function private.record_match_statistics(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with values_by_player as (
    select p.id player_id, coalesce(sum(sl.delta) filter (where sl.delta > 0), 0)::bigint value
    from public.players p
    left join public.point_decisions d on d.room_id = p.room_id and d.acting_player_id = p.id
      and d.decision_type in ('lock_in', 'auto_lock_in', 'timeout')
    left join public.score_ledger sl on sl.decision_id = d.id and sl.player_id = p.id
    where p.room_id = p_room_id and p.match_participant
    group by p.id
  ), best as (select max(value) value from values_by_player where value > 0)
  insert into public.match_stat_awards(room_id, category, player_id, value)
  select p_room_id, 'lock_in_points', v.player_id, v.value from values_by_player v join best b on b.value = v.value;

  with values_by_player as (
    select sl.player_id, max(sl.delta)::bigint value
    from public.score_ledger sl join public.point_decisions d on d.id = sl.decision_id
    where sl.room_id = p_room_id and d.decision_type = 'challenge' and sl.delta > 0
    group by sl.player_id
  ), best as (select max(value) value from values_by_player where value > 0)
  insert into public.match_stat_awards(room_id, category, player_id, value)
  select p_room_id, 'biggest_point_challenge', v.player_id, v.value from values_by_player v join best b on b.value = v.value;

  with values_by_player as (
    select id player_id, action_draws_used::bigint value from public.players
    where room_id = p_room_id and match_participant
  ), best as (select max(value) value from values_by_player where value > 0)
  insert into public.match_stat_awards(room_id, category, player_id, value)
  select p_room_id, 'action_draws', v.player_id, v.value from values_by_player v join best b on b.value = v.value;

  with values_by_player as (
    select id player_id, challenges_won::bigint value from public.players
    where room_id = p_room_id and match_participant
  ), best as (select max(value) value from values_by_player where value > 0)
  insert into public.match_stat_awards(room_id, category, player_id, value)
  select p_room_id, 'mini_game_wins', v.player_id, v.value from values_by_player v join best b on b.value = v.value;

  with round_balances as (
    select rd.round_number, p.id player_id,
      coalesce((select sl.balance_after from public.score_ledger sl
        where sl.room_id = p_room_id and sl.player_id = p.id and sl.created_at <= rd.completed_at
        order by sl.created_at desc, sl.id desc limit 1), 0)::bigint score
    from public.rounds rd cross join public.players p
    where rd.room_id = p_room_id and rd.status = 'completed'
      and p.room_id = p_room_id and p.match_participant
  ), round_ranks as (
    select player_id, round_number, rank() over (partition by round_number order by score desc)::integer rank
    from round_balances
  ), values_by_player as (
    select rr.player_id, greatest(0, max(rr.rank - mrp.final_rank))::bigint value
    from round_ranks rr join public.match_result_players mrp
      on mrp.room_id = p_room_id and mrp.player_id = rr.player_id
    group by rr.player_id
  ), best as (select max(value) value from values_by_player where value > 0)
  insert into public.match_stat_awards(room_id, category, player_id, value)
  select p_room_id, 'biggest_comeback', v.player_id, v.value from values_by_player v join best b on b.value = v.value;
end;
$$;

create or replace function private.complete_match(
  p_room_id uuid,
  p_winner_id uuid,
  p_resolution_method public.championship_resolution_method
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_completed_at timestamptz := statement_timestamp(); v_round smallint;
begin
  perform 1 from public.rooms where id = p_room_id for update;
  if exists (select 1 from public.match_results where room_id = p_room_id) then return; end if;
  if not exists (select 1 from public.players where room_id = p_room_id and id = p_winner_id and match_participant) then
    raise exception using errcode = 'P0001', message = 'INVALID_WINNER';
  end if;
  insert into public.match_results(room_id, winner_player_id, resolution_method, completed_at)
  values(p_room_id, p_winner_id, p_resolution_method, v_completed_at);
  with ranked as (
    select p.id, p.score,
      rank() over (order by case when p.id = p_winner_id then 0 else 1 end, p.score desc)::integer final_rank,
      row_number() over (order by case when p.id = p_winner_id then 0 else 1 end, p.score desc, p.join_order)::integer display_order
    from public.players p where p.room_id = p_room_id and p.match_participant
  )
  insert into public.match_result_players(room_id, player_id, final_score, final_rank, display_order)
  select p_room_id, id, score, final_rank, display_order from ranked;
  perform private.record_match_statistics(p_room_id);
  update public.rooms set status = 'completed', current_phase = 'completed',
    current_turn_player_id = null, phase_deadline = null, completed_at = v_completed_at,
    match_version = match_version + 1 where id = p_room_id;
  select current_round into v_round from public.rooms where id = p_room_id;
  perform private.record_game_event(p_room_id, v_round, 'match_completed', p_winner_id,
    jsonb_build_object('winnerPlayerId', p_winner_id, 'resolutionMethod', p_resolution_method));
end;
$$;

create or replace function private.start_championship_tiebreaker(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_seed bytea; v_spec record; v_start timestamptz; v_deadline timestamptz; v_top bigint; v_round smallint;
begin
  perform 1 from public.rooms where id = p_room_id for update;
  if exists(select 1 from public.championship_tiebreakers where room_id = p_room_id) then return; end if;
  select max(score) into v_top from public.players where room_id = p_room_id and match_participant;
  v_seed := extensions.gen_random_bytes(32);
  select * into strict v_spec from private.generate_mini_game_spec('stop_bar', v_seed);
  v_start := statement_timestamp() + interval '3 seconds';
  v_deadline := v_start + interval '12 seconds';
  insert into public.championship_tiebreakers(room_id, starts_at, submission_deadline)
  values(p_room_id, v_start, v_deadline);
  insert into public.championship_participants(room_id, player_id, join_order)
  select p_room_id, id, join_order from public.players
  where room_id = p_room_id and match_participant and score = v_top;
  insert into private.championship_specs(room_id, seed, participant_spec, expected_result)
  values(p_room_id, v_seed, v_spec.participant_spec, v_spec.expected_result);
  update public.rooms set current_phase = 'championship_tiebreaker', phase_deadline = v_deadline,
    tiebreaker_required = true, match_version = match_version + 1 where id = p_room_id;
  select current_round into v_round from public.rooms where id = p_room_id;
  perform private.record_game_event(p_room_id, v_round, 'championship_tiebreaker_started', null,
    jsonb_build_object('participantCount', (select count(*) from public.championship_participants where room_id = p_room_id),
      'startsAt', v_start, 'deadline', v_deadline));
end;
$$;

create or replace function private.resolve_championship_if_ready(p_room_id uuid, p_force boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tie public.championship_tiebreakers%rowtype; v_participants integer; v_submissions integer;
  v_valid integer; v_best_distance integer; v_best_elapsed integer; v_candidates uuid[];
  v_winner uuid; v_method public.championship_resolution_method; v_round smallint;
begin
  select * into strict v_tie from public.championship_tiebreakers where room_id = p_room_id for update;
  if v_tie.status = 'resolved' then return; end if;
  select count(*) into v_participants from public.championship_participants where room_id = p_room_id;
  select count(*), count(*) filter(where validation_status = 'accepted') into v_submissions, v_valid
    from public.championship_submissions where room_id = p_room_id;
  if not p_force and v_submissions < v_participants then return; end if;
  if p_force and v_tie.submission_deadline > statement_timestamp() then
    raise exception using errcode = 'P0001', message = 'DEADLINE_NOT_EXPIRED';
  end if;
  if v_valid > 0 then
    select min(normalized_distance) into v_best_distance from public.championship_submissions
      where room_id = p_room_id and validation_status = 'accepted';
    select min(elapsed_ms) into v_best_elapsed from public.championship_submissions
      where room_id = p_room_id and validation_status = 'accepted' and normalized_distance = v_best_distance;
    select array_agg(player_id order by player_id) into v_candidates from public.championship_submissions
      where room_id = p_room_id and validation_status = 'accepted'
        and normalized_distance = v_best_distance and elapsed_ms = v_best_elapsed;
    if cardinality(v_candidates) = 1 then
      v_winner := v_candidates[1];
      if p_force and v_submissions < v_participants then v_method := 'timeout';
      elsif (select count(*) from public.championship_submissions where room_id = p_room_id and validation_status = 'accepted' and normalized_distance = v_best_distance) = 1 then v_method := 'skill';
      else v_method := 'timing'; end if;
    else
      v_winner := v_candidates[private.championship_random_index(cardinality(v_candidates)) + 1];
      v_method := 'secure_fallback';
    end if;
  else
    select array_agg(player_id order by join_order) into v_candidates
      from public.championship_participants where room_id = p_room_id;
    v_winner := v_candidates[private.championship_random_index(cardinality(v_candidates)) + 1];
    v_method := 'secure_fallback';
  end if;
  update public.championship_tiebreakers set status = 'resolved', winner_player_id = v_winner,
    resolution_method = v_method, resolved_at = statement_timestamp() where room_id = p_room_id;
  select current_round into v_round from public.rooms where id = p_room_id;
  perform private.record_game_event(p_room_id, v_round, 'championship_resolved', v_winner,
    jsonb_build_object('winnerPlayerId', v_winner, 'resolutionMethod', v_method));
  perform private.complete_match(p_room_id, v_winner, v_method);
end;
$$;

create or replace function private.finalize_match(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_top_count integer; v_winner uuid; v_round smallint;
begin
  perform 1 from public.rooms where id = p_room_id for update;
  if exists(select 1 from public.match_results where room_id = p_room_id) then return; end if;
  select count(*) into v_top_count from public.players p
  where p.room_id = p_room_id and p.match_participant
    and p.score = (select max(score) from public.players where room_id = p_room_id and match_participant);
  select current_round into v_round from public.rooms where id = p_room_id;
  perform private.record_game_event(p_room_id, v_round, 'match_finalizing', null,
    jsonb_build_object('tiebreakerRequired', v_top_count > 1));
  if v_top_count > 1 then
    perform private.start_championship_tiebreaker(p_room_id);
  else
    select id into strict v_winner from public.players
      where room_id = p_room_id and match_participant order by score desc, join_order limit 1;
    perform private.complete_match(p_room_id, v_winner, 'skill');
  end if;
end;
$$;

create or replace function private.finalize_mini_game_phase(p_room_id uuid, p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_room public.rooms%rowtype; v_round public.rounds%rowtype; v_deadline timestamptz;
begin
  select * into strict v_room from public.rooms where id = p_room_id for update;
  select * into strict v_round from public.rounds where id = p_round_id for update;
  if exists(select 1 from public.mini_game_challenges where round_id = p_round_id and status in ('queued','active','tiebreaker_active')) then return; end if;
  if v_room.current_phase <> 'mini_game_resolution' then return; end if;
  v_deadline := case when v_round.round_number < v_room.total_rounds then statement_timestamp() + interval '8 seconds' else null end;
  update public.rounds set status = 'completed', phase = 'round_summary', current_turn_index = null,
    current_turn_player_id = null, turn_deadline = null, completed_at = statement_timestamp(), phase_deadline = v_deadline
    where id = p_round_id;
  perform private.record_game_event(p_room_id, v_round.round_number, 'mini_game_phase_completed', null, '{}');
  perform private.record_game_event(p_room_id, v_round.round_number, 'round_completed', null, jsonb_build_object('roundNumber', v_round.round_number));
  perform private.record_game_event(p_room_id, v_round.round_number, 'scores_updated', null, jsonb_build_object('roundNumber', v_round.round_number));
  if v_round.round_number >= v_room.total_rounds then
    update public.rooms set current_phase = 'finalizing', current_turn_player_id = null,
      phase_deadline = null, tiebreaker_required = false, match_version = match_version + 1 where id = p_room_id;
    perform private.finalize_match(p_room_id);
  else
    update public.rooms set current_phase = 'round_summary', current_turn_player_id = null,
      phase_deadline = v_deadline, match_version = match_version + 1 where id = p_room_id;
  end if;
end;
$$;

create or replace function public.submit_championship_result(
  p_room_id uuid, p_result_payload jsonb, p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_anonymous_user(); v_player public.players%rowtype;
  v_tie public.championship_tiebreakers%rowtype; v_spec private.championship_specs%rowtype;
  v_elapsed integer; v_position numeric; v_target numeric; v_distance integer;
  v_status public.championship_validation_status := 'accepted'::public.championship_validation_status; v_reason text; v_server_elapsed integer; v_round smallint;
begin
  if p_idempotency_key is null or jsonb_typeof(p_result_payload) <> 'object' or pg_column_size(p_result_payload) > 1024 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  select p.* into v_player from public.players p join public.championship_participants cp
    on cp.room_id = p.room_id and cp.player_id = p.id
    where p.room_id = p_room_id and p.auth_user_id = v_user and p.left_at is null;
  if v_player.id is null then
    raise exception using errcode = 'P0001', message = 'NOT_CHAMPIONSHIP_PARTICIPANT';
  end if;
  select * into strict v_tie from public.championship_tiebreakers where room_id = p_room_id for update;
  if exists(select 1 from public.championship_submissions where room_id = p_room_id and player_id = v_player.id and idempotency_key = p_idempotency_key) then
    return private.build_match_snapshot(p_room_id, v_user);
  end if;
  if exists(select 1 from public.championship_submissions where room_id = p_room_id and player_id = v_player.id) then
    raise exception using errcode = 'P0001', message = 'CHAMPIONSHIP_ALREADY_SUBMITTED';
  end if;
  if v_tie.status <> 'active' then return private.build_match_snapshot(p_room_id, v_user); end if;
  if statement_timestamp() < v_tie.starts_at then raise exception using errcode = 'P0001', message = 'CHAMPIONSHIP_NOT_STARTED'; end if;
  if statement_timestamp() > v_tie.submission_deadline then raise exception using errcode = 'P0001', message = 'DEADLINE_EXPIRED'; end if;
  select * into strict v_spec from private.championship_specs where room_id = p_room_id;
  begin
    v_elapsed := (p_result_payload->>'elapsedMs')::integer;
    v_position := (p_result_payload->>'position')::numeric;
  exception when others then v_status := 'rejected'::public.championship_validation_status; v_reason := 'MALFORMED_PAYLOAD'; end;
  if v_status = 'accepted' then
    v_server_elapsed := floor(extract(epoch from (statement_timestamp() - v_tie.starts_at)) * 1000)::integer;
    if v_elapsed < 100 or v_elapsed > 10000 or v_elapsed > v_server_elapsed + 1500 then
      v_status := 'rejected'::public.championship_validation_status; v_reason := 'INFEASIBLE_TIMING';
    elsif v_position < 0 or v_position > 1 then
      v_status := 'rejected'::public.championship_validation_status; v_reason := 'INVALID_POSITION';
    else
      v_target := (v_spec.expected_result->>'targetPosition')::numeric;
      v_distance := round(abs(v_position - v_target) * 1000000)::integer;
    end if;
  end if;
  insert into public.championship_submissions(room_id, player_id, idempotency_key, validation_status,
    validation_reason, normalized_distance, elapsed_ms)
  values(p_room_id, v_player.id, p_idempotency_key, v_status, v_reason,
    case when v_status = 'accepted' then v_distance else null end, v_elapsed);
  select current_round into v_round from public.rooms where id = p_room_id;
  perform private.record_game_event(p_room_id, v_round, 'championship_submission_received', v_player.id,
    jsonb_build_object('playerId', v_player.id));
  perform private.resolve_championship_if_ready(p_room_id, false);
  return private.build_match_snapshot(p_room_id, v_user);
end;
$$;

create or replace function public.process_expired_championship(p_room_id uuid, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := private.require_anonymous_user();
begin
  if p_idempotency_key is null or not private.is_match_participant(p_room_id, v_user) then
    raise exception using errcode = 'P0001', message = 'NOT_MATCH_PARTICIPANT';
  end if;
  perform private.resolve_championship_if_ready(p_room_id, true);
  return private.build_match_snapshot(p_room_id, v_user);
end;
$$;

create or replace function public.request_rematch(p_room_id uuid, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_anonymous_user(); v_source public.rooms%rowtype; v_actor public.players%rowtype;
  v_new_room uuid; v_new_code text; v_new_host uuid; v_attempt integer := 0;
begin
  if p_idempotency_key is null then raise exception using errcode = 'P0001', message = 'INVALID_INPUT'; end if;
  select * into strict v_source from public.rooms where id = p_room_id for update;
  select * into strict v_actor from public.players where room_id = p_room_id and auth_user_id = v_user
    and match_participant and left_at is null;
  if v_source.status <> 'completed' or not exists(select 1 from public.match_results where room_id = p_room_id) then
    raise exception using errcode = 'P0001', message = 'MATCH_NOT_COMPLETED';
  end if;
  select rematch_room_id into v_new_room from public.rematches where source_room_id = p_room_id;
  if v_new_room is not null then return private.build_lobby_snapshot(v_new_room, v_user); end if;
  loop
    v_attempt := v_attempt + 1; v_new_code := private.generate_room_code(); v_new_room := extensions.gen_random_uuid();
    begin
      insert into public.rooms(id, room_code, host_player_id, status, max_players, total_rounds,
        turn_timer_seconds, password_hash, created_by_user_id, creation_request_id)
      values(v_new_room, v_new_code, v_source.host_player_id, 'lobby', v_source.max_players,
        v_source.total_rounds, v_source.turn_timer_seconds, v_source.password_hash, v_user, p_idempotency_key);
      exit;
    exception when unique_violation then
      if v_attempt >= 8 then raise exception using errcode = 'P0001', message = 'ROOM_CODE_UNAVAILABLE'; end if;
    end;
  end loop;
  insert into public.players(room_id, auth_user_id, display_name, ready, connected, is_host,
    last_seen_at, disconnected_at)
  select v_new_room, p.auth_user_id, p.display_name, false, p.connected, p.is_host,
    p.last_seen_at, p.disconnected_at
  from public.players p where p.room_id = p_room_id and p.match_participant and p.left_at is null
  order by p.join_order;
  select id into strict v_new_host from public.players where room_id = v_new_room and is_host;
  update public.rooms set host_player_id = v_new_host where id = v_new_room;
  insert into public.rematches(source_room_id, rematch_room_id, requested_by_player_id, idempotency_key)
  values(p_room_id, v_new_room, v_actor.id, p_idempotency_key);
  perform private.record_game_event(p_room_id, v_source.current_round, 'rematch_created', v_actor.id,
    jsonb_build_object('rematchRoomId', v_new_room));
  return private.build_lobby_snapshot(v_new_room, v_user);
end;
$$;

alter function private.build_match_snapshot(uuid, uuid) rename to build_mini_match_snapshot;

create or replace function private.build_match_snapshot(p_room_id uuid, p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (select private.build_mini_match_snapshot(p_room_id, p_user_id) value),
  actor as (select * from public.players where room_id = p_room_id and auth_user_id = p_user_id and match_participant and left_at is null),
  room_state as (select * from public.rooms where id = p_room_id),
  tie as (select * from public.championship_tiebreakers where room_id = p_room_id),
  result as (select * from public.match_results where room_id = p_room_id)
  select (case when result.room_id is null then base.value else jsonb_set(base.value, '{players}', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'displayName', p.display_name, 'score', mrp.final_score, 'rank', mrp.final_rank,
      'connected', p.connected, 'isHost', p.is_host, 'isSelf', p.auth_user_id = p_user_id,
      'resolved', true, 'resolutionType', c.resolution_type
    ) order by mrp.display_order)
    from public.match_result_players mrp join public.players p on p.id = mrp.player_id
    left join public.round_cards_private c on c.room_id = p_room_id and c.round_number = r.current_round and c.player_id = p.id
    where mrp.room_id = p_room_id
  ), '[]'::jsonb)) end) || jsonb_build_object(
    'completionState', jsonb_build_object(
      'phase', r.current_phase,
      'tiebreaker', case when tie.room_id is null then null else jsonb_build_object(
        'status', tie.status, 'isParticipant', private.is_championship_participant(p_room_id, p_user_id),
        'participantIds', coalesce((select jsonb_agg(cp.player_id order by cp.join_order) from public.championship_participants cp where cp.room_id = p_room_id), '[]'::jsonb),
        'startsAt', tie.starts_at, 'submissionDeadline', tie.submission_deadline,
        'specification', case when private.is_championship_participant(p_room_id, p_user_id) and tie.status = 'active'
          then (select s.participant_spec from private.championship_specs s where s.room_id = p_room_id) else null end,
        'ownSubmitted', exists(select 1 from public.championship_submissions cs join actor a on a.id = cs.player_id where cs.room_id = p_room_id),
        'submittedCount', (select count(*) from public.championship_submissions cs where cs.room_id = p_room_id),
        'participantCount', (select count(*) from public.championship_participants cp where cp.room_id = p_room_id),
        'winnerPlayerId', tie.winner_player_id, 'resolutionMethod', tie.resolution_method
      ) end,
      'result', case when result.room_id is null then null else jsonb_build_object(
        'winnerPlayerId', result.winner_player_id, 'resolutionMethod', result.resolution_method,
        'completedAt', result.completed_at,
        'rankings', coalesce((select jsonb_agg(jsonb_build_object('playerId', mrp.player_id,
          'score', mrp.final_score, 'rank', mrp.final_rank, 'displayOrder', mrp.display_order) order by mrp.display_order)
          from public.match_result_players mrp where mrp.room_id = p_room_id), '[]'::jsonb),
        'statistics', coalesce((select jsonb_agg(jsonb_build_object('category', msa.category,
          'playerId', msa.player_id, 'value', msa.value) order by msa.category, msa.player_id)
          from public.match_stat_awards msa where msa.room_id = p_room_id), '[]'::jsonb)
      ) end,
      'rematchRoomId', (select rematch_room_id from public.rematches where source_room_id = p_room_id)
    )
  )
  from base join actor a on true join room_state r on true left join tie on true left join result on true;
$$;

create trigger championship_tiebreakers_broadcast_game_change after insert or update on public.championship_tiebreakers
for each row execute function private.broadcast_game_change();
create trigger championship_submissions_broadcast_game_change after insert or update on public.championship_submissions
for each row execute function private.broadcast_game_change();
create trigger match_results_broadcast_game_change after insert or update on public.match_results
for each row execute function private.broadcast_game_change();

-- Snapshot reads refresh the caller's heartbeat. Do not turn those invisible
-- timestamp-only writes into another snapshot read for every connected client.
-- Connectivity changes still broadcast so disconnect/recovery UI stays live.
create or replace function private.broadcast_game_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_room_id uuid;
begin
  if tg_op = 'UPDATE' and tg_table_name = 'players' then
    if (old.display_name, old.score, old.ready, old.connected, old.is_host,
        old.left_at, old.match_participant, old.action_draw_allowance,
        old.action_draws_used, old.mini_game_token_used)
         is not distinct from
       (new.display_name, new.score, new.ready, new.connected, new.is_host,
        new.left_at, new.match_participant, new.action_draw_allowance,
        new.action_draws_used, new.mini_game_token_used) then
      return null;
    end if;
  end if;

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

alter table public.championship_tiebreakers enable row level security;
alter table public.championship_participants enable row level security;
alter table public.championship_submissions enable row level security;
alter table public.match_results enable row level security;
alter table public.match_result_players enable row level security;
alter table public.match_stat_awards enable row level security;
alter table public.rematches enable row level security;
alter table public.championship_tiebreakers force row level security;
alter table public.championship_participants force row level security;
alter table public.championship_submissions force row level security;
alter table public.match_results force row level security;
alter table public.match_result_players force row level security;
alter table public.match_stat_awards force row level security;
alter table public.rematches force row level security;

create policy championship_member_select on public.championship_tiebreakers for select to authenticated
using (private.is_match_participant(room_id));
create policy championship_participant_member_select on public.championship_participants for select to authenticated
using (private.is_match_participant(room_id));
create policy championship_submission_owner_select on public.championship_submissions for select to authenticated
using (private.is_card_owner(player_id));
create policy match_results_member_select on public.match_results for select to authenticated
using (private.is_match_participant(room_id));
create policy match_result_players_member_select on public.match_result_players for select to authenticated
using (private.is_match_participant(room_id));
create policy match_stat_awards_member_select on public.match_stat_awards for select to authenticated
using (private.is_match_participant(room_id));

revoke all on table private.championship_specs from public, anon, authenticated;
revoke all on table public.championship_tiebreakers, public.championship_participants,
  public.championship_submissions, public.match_results, public.match_result_players,
  public.match_stat_awards, public.rematches from public, anon, authenticated;
grant select on table public.championship_tiebreakers, public.championship_participants,
  public.championship_submissions, public.match_results, public.match_result_players,
  public.match_stat_awards to authenticated;

revoke all on function public.submit_championship_result(uuid, jsonb, uuid) from public, anon;
revoke all on function public.process_expired_championship(uuid, uuid) from public, anon;
revoke all on function public.request_rematch(uuid, uuid) from public, anon;
grant execute on function public.submit_championship_result(uuid, jsonb, uuid) to authenticated;
grant execute on function public.process_expired_championship(uuid, uuid) to authenticated;
grant execute on function public.request_rematch(uuid, uuid) to authenticated;

comment on table public.match_results is 'Immutable authoritative winner and completion record for one room/match identity.';
comment on function public.request_rematch is 'Creates one new ready-check room identity while preserving the completed source room and its auditable history.';
