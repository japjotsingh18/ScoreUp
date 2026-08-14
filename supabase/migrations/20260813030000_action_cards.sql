-- Milestone 4: complete Mystery Action Card system.
-- Mini-Game Challenges, final tiebreakers, rematches, and deployment are excluded.

alter type public.game_phase add value if not exists 'action_choice' before 'point_decisions';
alter type public.game_event_type add value if not exists 'action_phase_started';
alter type public.game_event_type add value if not exists 'action_target_required';
alter type public.game_event_type add value if not exists 'action_card_resolved';
alter type public.game_event_type add value if not exists 'action_skipped';
alter type public.game_event_type add value if not exists 'action_auto_skipped';
alter type public.game_event_type add value if not exists 'action_phase_completed';

create type public.action_card_category as enum ('positive', 'negative', 'unpredictable');
create type public.action_choice_type as enum ('draw', 'skip');
create type public.action_draw_status as enum ('selected', 'awaiting_target', 'resolved');
create type public.action_target_requirement as enum ('none', 'player_select', 'server_select');

alter table public.rounds add column action_deadline timestamptz;
alter table public.round_cards_private
  add column current_value_source_player_id uuid,
  add constraint round_cards_value_source_fk
    foreign key (room_id, current_value_source_player_id)
    references public.players(room_id, id);
update public.round_cards_private set current_value_source_player_id = player_id;
alter table public.round_cards_private alter column current_value_source_player_id set not null;

create table private.action_card_catalog (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  display_name text not null,
  category public.action_card_category not null,
  weight smallint not null check (weight > 0),
  target_requirement public.action_target_requirement not null,
  shield_blockable boolean not null default false,
  effect_parameters jsonb not null default '{}'::jsonb
    check (jsonb_typeof(effect_parameters) = 'object'),
  public_description text not null,
  resolver_identity text not null,
  enabled boolean not null default true,
  version smallint not null default 1 check (version > 0)
);

insert into private.action_card_catalog (
  code, display_name, category, weight, target_requirement,
  shield_blockable, effect_parameters, public_description, resolver_identity
) values
  ('score_boost', 'Score Boost', 'positive', 7, 'none', false, '{"amount":500}', 'Gain 500 score points immediately.', 'score_boost'),
  ('double_up', 'Double Up', 'positive', 7, 'none', false, '{"multiplier":2}', 'Double your current point card.', 'double_up'),
  ('point_swipe', 'Point Swipe', 'positive', 7, 'player_select', true, '{"amount":300}', 'Choose a player and transfer up to 300 points from them.', 'point_swipe'),
  ('shield', 'Shield', 'positive', 7, 'none', false, '{}', 'Block the next eligible targeted negative effect this round.', 'shield'),
  ('fresh_draw', 'Fresh Draw', 'positive', 6, 'none', false, '{}', 'Securely replace your current point card.', 'fresh_draw'),
  ('bonus_momentum', 'Bonus Momentum', 'positive', 6, 'none', false, '{"percent":15,"roundTo":50}', 'Gain 15% of your current score, rounded to the nearest 50.', 'bonus_momentum'),
  ('point_penalty', 'Point Penalty', 'negative', 5, 'none', false, '{"amount":400}', 'Lose up to 400 score points.', 'point_penalty'),
  ('bad_move', 'Bad Move', 'negative', 5, 'none', false, '{"divisor":2,"roundTo":50}', 'Halve your point card, rounded to the nearest 50.', 'bad_move'),
  ('forced_share', 'Forced Share', 'negative', 5, 'server_select', false, '{"amount":300,"rank":"last"}', 'Transfer up to 300 points to an eligible last-place player.', 'forced_share'),
  ('score_drop', 'Score Drop', 'negative', 5, 'none', false, '{"percent":15,"roundTo":50}', 'Lose 15% of your score, rounded to the nearest 50.', 'score_drop'),
  ('empty_round', 'Empty Round', 'negative', 5, 'none', false, '{"value":0}', 'Set your current point card to zero.', 'empty_round'),
  ('leader_bonus', 'Leader Bonus', 'negative', 5, 'server_select', false, '{"amount":300,"soleLeaderPenalty":150}', 'Pay an eligible leader, or take a smaller penalty if you are the sole leader.', 'leader_bonus'),
  ('double_or_zero', 'Double or Zero', 'unpredictable', 5, 'none', false, '{"outcomes":[0,2]}', 'Your point card securely becomes double or zero.', 'double_or_zero'),
  ('random_card_swap', 'Random Card Swap', 'unpredictable', 5, 'server_select', false, '{}', 'Securely swap point cards with another participant.', 'random_card_swap'),
  ('shared_fate', 'Shared Fate', 'unpredictable', 5, 'server_select', false, '{"amount":300}', 'You and another player independently gain or lose 300 points.', 'shared_fate'),
  ('comeback_card', 'Comeback Card', 'unpredictable', 5, 'none', false, '{"bottomGain":500,"topLoss":300}', 'Bottom-half players gain 500; top-half players lose up to 300.', 'comeback_card'),
  ('mystery_multiplier', 'Mystery Multiplier', 'unpredictable', 5, 'none', false, '{"outcomes":[0,1,2]}', 'Securely apply a 0×, 1×, or 2× multiplier to your point card.', 'mystery_multiplier'),
  ('reverse_swipe', 'Reverse Swipe', 'unpredictable', 5, 'server_select', false, '{"amount":300}', 'Securely choose another player and one transfer direction.', 'reverse_swipe');

create table public.action_choices (
  id uuid primary key default extensions.gen_random_uuid(),
  round_id uuid not null,
  room_id uuid not null,
  round_number smallint not null,
  player_id uuid not null,
  choice public.action_choice_type not null,
  automatic boolean not null default false,
  idempotency_key uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint action_choices_round_fk foreign key (room_id, round_id)
    references public.rounds(room_id, id) on delete cascade,
  constraint action_choices_player_fk foreign key (room_id, player_id)
    references public.players(room_id, id),
  constraint action_choices_player_round_unique unique (round_id, player_id),
  constraint action_choices_idempotency_unique unique (room_id, idempotency_key)
);
create index action_choices_room_round_idx
  on public.action_choices (room_id, round_number, created_at);

create table public.action_draws (
  id uuid primary key default extensions.gen_random_uuid(),
  choice_id uuid not null unique references public.action_choices(id) on delete cascade,
  round_id uuid not null,
  room_id uuid not null,
  round_number smallint not null,
  player_id uuid not null,
  card_code text not null,
  category public.action_card_category not null,
  status public.action_draw_status not null,
  target_requirement public.action_target_requirement not null,
  target_player_id uuid,
  private_effect_result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(private_effect_result) = 'object'),
  public_safe_result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(public_safe_result) = 'object'),
  idempotency_key uuid not null,
  target_idempotency_key uuid,
  drawn_at timestamptz not null default statement_timestamp(),
  target_deadline timestamptz,
  targeted_at timestamptz,
  resolved_at timestamptz,
  constraint action_draws_round_fk foreign key (room_id, round_id)
    references public.rounds(room_id, id) on delete cascade,
  constraint action_draws_player_fk foreign key (room_id, player_id)
    references public.players(room_id, id),
  constraint action_draws_target_fk foreign key (room_id, target_player_id)
    references public.players(room_id, id),
  constraint action_draws_card_fk foreign key (card_code)
    references private.action_card_catalog(code),
  constraint action_draws_player_round_unique unique (round_id, player_id),
  constraint action_draws_idempotency_unique unique (room_id, idempotency_key),
  constraint action_draws_target_idempotency_unique unique (room_id, target_idempotency_key),
  constraint action_draws_status_shape check (
    (status = 'selected' and target_requirement <> 'player_select'
      and target_player_id is null and target_deadline is null and resolved_at is null)
    or (status = 'awaiting_target' and target_requirement = 'player_select'
      and target_player_id is null and target_deadline is not null and resolved_at is null)
    or (status = 'resolved' and resolved_at is not null)
  )
);
create index action_draws_room_round_status_idx
  on public.action_draws (room_id, round_number, status);

create table private.action_shields (
  round_id uuid not null references public.rounds(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null references public.players(id),
  source_draw_id uuid not null references public.action_draws(id) on delete cascade,
  active boolean not null default true,
  consumed_by_draw_id uuid references public.action_draws(id),
  created_at timestamptz not null default statement_timestamp(),
  consumed_at timestamptz,
  primary key (round_id, player_id),
  constraint action_shields_consumption_shape check (
    (active and consumed_by_draw_id is null and consumed_at is null)
    or (not active and consumed_by_draw_id is not null and consumed_at is not null)
  )
);

create table private.point_card_mutations (
  id bigint generated always as identity primary key,
  action_draw_id uuid not null references public.action_draws(id) on delete cascade,
  round_card_id uuid not null references public.round_cards_private(id) on delete cascade,
  player_id uuid not null references public.players(id),
  mutation_type text not null,
  old_value integer not null check (old_value >= 0),
  new_value integer not null check (new_value >= 0),
  old_source_player_id uuid not null references public.players(id),
  new_source_player_id uuid not null references public.players(id),
  created_at timestamptz not null default statement_timestamp(),
  constraint point_card_mutation_once unique (action_draw_id, round_card_id)
);

alter table public.score_ledger drop constraint score_ledger_delta_check;
alter table public.score_ledger alter column decision_id drop not null;
alter table public.score_ledger
  add column action_draw_id uuid references public.action_draws(id) on delete cascade,
  add column reason_code text,
  add constraint score_ledger_source_shape check (
    (decision_id is not null and action_draw_id is null)
    or (decision_id is null and action_draw_id is not null)
  );
update public.score_ledger set reason_code = 'point_decision' where reason_code is null;
alter table public.score_ledger alter column reason_code set not null;
create unique index score_ledger_action_draw_player_reason_key
  on public.score_ledger (action_draw_id, player_id, reason_code)
  where action_draw_id is not null;

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
    room_id, round_id, player_id, decision_id, action_draw_id,
    delta, balance_after, source_key, reason_code
  ) values (
    p_room_id, p_round_id, p_player_id, p_decision_id, null,
    p_delta, v_balance, p_source_key, 'point_decision'
  );
end;
$$;

create or replace function private.is_action_owner(
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
    select 1 from public.players p
    where p.id = p_player_id and p.auth_user_id = p_user_id
      and p.match_participant and p.left_at is null
  );
$$;

create or replace function private.round_half_up_50(p_value numeric)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(0, floor((coalesce(p_value, 0) + 25) / 50) * 50)::integer;
$$;

create or replace function private.secure_random_index(
  p_count integer,
  p_test_setting text default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_override text;
  v_bytes bytea;
  v_number bigint;
begin
  if p_count <= 0 then return null; end if;
  if session_user = 'postgres' and p_test_setting is not null then
    v_override := pg_catalog.current_setting(p_test_setting, true);
    if v_override ~ '^[0-9]+$' then
      return (v_override::integer % p_count);
    end if;
  end if;
  v_bytes := extensions.gen_random_bytes(4);
  v_number := get_byte(v_bytes, 0)::bigint * 16777216
    + get_byte(v_bytes, 1)::bigint * 65536
    + get_byte(v_bytes, 2)::bigint * 256
    + get_byte(v_bytes, 3)::bigint;
  return (v_number % p_count)::integer;
end;
$$;

create or replace function private.pick_secure_player(
  p_candidates uuid[],
  p_test_setting text default 'scoreup.test_target_player_id'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_override text;
  v_index integer;
begin
  if coalesce(cardinality(p_candidates), 0) = 0 then return null; end if;
  if session_user = 'postgres' then
    v_override := pg_catalog.current_setting(p_test_setting, true);
    if v_override ~ '^[0-9a-f-]{36}$' and v_override::uuid = any(p_candidates) then
      return v_override::uuid;
    end if;
  end if;
  v_index := private.secure_random_index(cardinality(p_candidates), null);
  return p_candidates[v_index + 1];
end;
$$;

create or replace function private.select_action_card()
returns private.action_card_catalog
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_override text;
  v_total integer;
  v_roll integer;
  v_card private.action_card_catalog%rowtype;
begin
  if session_user = 'postgres' then
    v_override := pg_catalog.current_setting('scoreup.test_action_card_code', true);
    if v_override is not null and v_override <> '' then
      select * into v_card from private.action_card_catalog
      where code = v_override and enabled;
      if v_card.code is not null then return v_card; end if;
    end if;
  end if;
  select sum(weight)::integer into v_total
  from private.action_card_catalog where enabled;
  v_roll := private.secure_random_index(v_total, null) + 1;
  select c.* into v_card
  from private.action_card_catalog c
  where c.code = (
    select weighted.code
    from (
      select candidate.code,
        sum(candidate.weight) over (order by candidate.code) as ceiling
      from private.action_card_catalog candidate
      where candidate.enabled
    ) weighted
    where weighted.ceiling >= v_roll
    order by weighted.ceiling
    limit 1
  );
  return v_card;
end;
$$;

create or replace function private.apply_action_score_delta(
  p_room_id uuid,
  p_round_id uuid,
  p_player_id uuid,
  p_action_draw_id uuid,
  p_requested_delta integer,
  p_reason_code text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before bigint;
  v_after bigint;
  v_actual integer;
begin
  select score into v_before from public.players
  where id = p_player_id and room_id = p_room_id and match_participant
  for update;
  if v_before is null then
    raise exception using errcode = 'P0001', message = 'INVALID_TARGET';
  end if;
  v_after := greatest(0, v_before + p_requested_delta);
  v_actual := (v_after - v_before)::integer;
  if v_actual <> 0 then
    update public.players set score = v_after where id = p_player_id;
    insert into public.score_ledger (
      room_id, round_id, player_id, decision_id, action_draw_id,
      delta, balance_after, source_key, reason_code
    ) values (
      p_room_id, p_round_id, p_player_id, null, p_action_draw_id,
      v_actual, v_after,
      'action:' || p_action_draw_id::text || ':' || p_player_id::text || ':' || p_reason_code,
      p_reason_code
    );
  end if;
  return v_actual;
end;
$$;

create or replace function private.mutate_point_card(
  p_action_draw_id uuid,
  p_round_card_id uuid,
  p_new_value integer,
  p_new_source_player_id uuid,
  p_mutation_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_card public.round_cards_private%rowtype;
begin
  select * into v_card from public.round_cards_private
  where id = p_round_card_id for update;
  if v_card.id is null or v_card.resolution_status <> 'unresolved' then
    raise exception using errcode = 'P0001', message = 'ALREADY_RESOLVED';
  end if;
  insert into private.point_card_mutations (
    action_draw_id, round_card_id, player_id, mutation_type,
    old_value, new_value, old_source_player_id, new_source_player_id
  ) values (
    p_action_draw_id, v_card.id, v_card.player_id, p_mutation_type,
    v_card.current_value, greatest(0, p_new_value),
    v_card.current_value_source_player_id, p_new_source_player_id
  );
  update public.round_cards_private
  set current_value = greatest(0, p_new_value),
      current_value_source_player_id = p_new_source_player_id
  where id = v_card.id;
end;
$$;

alter function private.build_match_snapshot(uuid, uuid)
  rename to build_core_match_snapshot;

create or replace function private.build_match_snapshot(p_room_id uuid, p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select private.build_core_match_snapshot(p_room_id, p_user_id) as value
  ),
  actor as (
    select p.* from public.players p
    where p.room_id = p_room_id and p.auth_user_id = p_user_id
      and p.match_participant and p.left_at is null
  ),
  current_round as (
    select rd.* from public.rounds rd
    join public.rooms r on r.id = rd.room_id and r.current_round = rd.round_number
    where rd.room_id = p_room_id
  ),
  own_choice as (
    select c.* from public.action_choices c
    join actor a on a.id = c.player_id
    join current_round rd on rd.id = c.round_id
  ),
  own_draw as (
    select d.*, catalog.display_name, catalog.public_description
    from public.action_draws d
    join actor a on a.id = d.player_id
    join current_round rd on rd.id = d.round_id
    join private.action_card_catalog catalog on catalog.code = d.card_code
  )
  select base.value || jsonb_build_object(
    'actionState', jsonb_build_object(
      'phaseDeadline', rd.action_deadline,
      'respondedCount', (
        select count(*) from public.action_choices c where c.round_id = rd.id
      ),
      'participantCount', (
        select count(*) from public.players p
        where p.room_id = p_room_id and p.match_participant and p.left_at is null
      ),
      'drawsRemaining', greatest(0, a.action_draw_allowance - a.action_draws_used),
      'shieldActive', exists (
        select 1 from private.action_shields s
        where s.round_id = rd.id and s.player_id = a.id and s.active
      ),
      'choice', case when c.id is null then null else jsonb_build_object(
        'choice', c.choice,
        'automatic', c.automatic,
        'createdAt', c.created_at
      ) end,
      'draw', case when d.id is null then null else jsonb_build_object(
        'id', d.id,
        'cardCode', d.card_code,
        'displayName', d.display_name,
        'category', d.category,
        'description', d.public_description,
        'status', d.status,
        'targetPlayerId', d.target_player_id,
        'targetDeadline', d.target_deadline,
        'eligibleTargetIds', case when d.status = 'awaiting_target' then coalesce((
          select jsonb_agg(p.id order by p.join_order)
          from public.players p
          join public.round_cards_private card
            on card.round_id = rd.id and card.player_id = p.id
          where p.room_id = p_room_id and p.match_participant and p.left_at is null
            and p.id <> a.id and card.resolution_status = 'unresolved'
        ), '[]'::jsonb) else '[]'::jsonb end,
        'privateResult', d.private_effect_result,
        'publicResult', d.public_safe_result,
        'drawnAt', d.drawn_at,
        'resolvedAt', d.resolved_at
      ) end
    )
  )
  from base
  join actor a on true
  left join current_round rd on true
  left join own_choice c on true
  left join own_draw d on true;
$$;

create or replace function private.resolve_action_draw(
  p_action_draw_id uuid,
  p_target_player_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draw public.action_draws%rowtype;
  v_room public.rooms%rowtype;
  v_round public.rounds%rowtype;
  v_actor public.players%rowtype;
  v_target public.players%rowtype;
  v_actor_card public.round_cards_private%rowtype;
  v_target_card public.round_cards_private%rowtype;
  v_candidates uuid[];
  v_target_id uuid;
  v_amount integer;
  v_actor_delta integer := 0;
  v_target_delta integer := 0;
  v_new_value integer;
  v_new_card integer;
  v_multiplier integer;
  v_actor_outcome integer;
  v_target_outcome integer;
  v_position integer;
  v_count integer;
  v_blocked boolean := false;
  v_private jsonb := '{}'::jsonb;
  v_public jsonb := '{}'::jsonb;
begin
  select * into v_draw from public.action_draws where id = p_action_draw_id for update;
  if v_draw.id is null then
    raise exception using errcode = 'P0001', message = 'ACTION_DRAW_NOT_FOUND';
  end if;
  if v_draw.status = 'resolved' then return; end if;
  select * into v_room from public.rooms where id = v_draw.room_id for update;
  select * into v_round from public.rounds where id = v_draw.round_id for update;
  select * into v_actor from public.players where id = v_draw.player_id for update;
  select * into v_actor_card from public.round_cards_private
  where round_id = v_draw.round_id and player_id = v_draw.player_id for update;
  if v_room.current_phase <> 'action_choice' or v_round.phase <> 'action_choice' then
    raise exception using errcode = 'P0001', message = 'WRONG_PHASE';
  end if;

  if v_draw.target_requirement = 'player_select' then
    v_target_id := p_target_player_id;
    if v_target_id is null or v_target_id = v_actor.id then
      raise exception using errcode = 'P0001', message = 'INVALID_TARGET';
    end if;
    select * into v_target from public.players
    where id = v_target_id and room_id = v_draw.room_id
      and match_participant and left_at is null for update;
    if v_target.id is null then
      raise exception using errcode = 'P0001', message = 'INVALID_TARGET';
    end if;
    select * into v_target_card from public.round_cards_private
    where round_id = v_draw.round_id and player_id = v_target.id for update;
    if v_target_card.resolution_status <> 'unresolved' then
      raise exception using errcode = 'P0001', message = 'TARGET_RESOLVED';
    end if;
  end if;

  case v_draw.card_code
    when 'score_boost' then
      v_actor_delta := private.apply_action_score_delta(v_draw.room_id, v_draw.round_id, v_actor.id, v_draw.id, 500, 'score_boost');
      v_public := jsonb_build_object('pointsChanged', v_actor_delta);
    when 'double_up' then
      v_new_value := v_actor_card.current_value * 2;
      perform private.mutate_point_card(v_draw.id, v_actor_card.id, v_new_value, v_actor_card.current_value_source_player_id, 'double_up');
      v_private := jsonb_build_object('newCardValue', v_new_value);
      v_public := jsonb_build_object('cardModified', true);
    when 'point_swipe' then
      if exists (
        select 1 from private.action_shields s
        where s.round_id = v_draw.round_id and s.player_id = v_target.id and s.active
        for update
      ) then
        update private.action_shields
        set active = false, consumed_by_draw_id = v_draw.id,
            consumed_at = statement_timestamp()
        where round_id = v_draw.round_id and player_id = v_target.id and active;
        v_blocked := true;
        v_public := jsonb_build_object('targetPlayerId', v_target.id, 'blocked', true, 'pointsTransferred', 0);
      else
        v_amount := least(300, v_target.score::integer);
        v_target_delta := private.apply_action_score_delta(v_draw.room_id, v_draw.round_id, v_target.id, v_draw.id, -v_amount, 'point_swipe_paid');
        v_actor_delta := private.apply_action_score_delta(v_draw.room_id, v_draw.round_id, v_actor.id, v_draw.id, v_amount, 'point_swipe_received');
        v_public := jsonb_build_object('targetPlayerId', v_target.id, 'blocked', false, 'pointsTransferred', v_amount);
      end if;
    when 'shield' then
      insert into private.action_shields (round_id, room_id, player_id, source_draw_id)
      values (v_draw.round_id, v_draw.room_id, v_actor.id, v_draw.id)
      on conflict (round_id, player_id) do update
      set active = true, source_draw_id = excluded.source_draw_id,
          consumed_by_draw_id = null, consumed_at = null,
          created_at = statement_timestamp();
      v_private := jsonb_build_object('shieldActive', true);
      v_public := jsonb_build_object('shieldApplied', true);
    when 'fresh_draw' then
      v_new_card := private.draw_point_card();
      perform private.mutate_point_card(v_draw.id, v_actor_card.id, v_new_card, v_actor.id, 'fresh_draw');
      v_private := jsonb_build_object('oldCardValue', v_actor_card.current_value, 'newCardValue', v_new_card);
      v_public := jsonb_build_object('cardReplaced', true);
    when 'bonus_momentum' then
      v_amount := private.round_half_up_50(v_actor.score * 0.15);
      v_actor_delta := private.apply_action_score_delta(v_draw.room_id, v_draw.round_id, v_actor.id, v_draw.id, v_amount, 'bonus_momentum');
      v_public := jsonb_build_object('pointsChanged', v_actor_delta);
    when 'point_penalty' then
      v_amount := least(400, v_actor.score::integer);
      v_actor_delta := private.apply_action_score_delta(v_draw.room_id, v_draw.round_id, v_actor.id, v_draw.id, -v_amount, 'point_penalty');
      v_public := jsonb_build_object('pointsChanged', v_actor_delta);
    when 'bad_move' then
      v_new_value := private.round_half_up_50(v_actor_card.current_value::numeric / 2);
      perform private.mutate_point_card(v_draw.id, v_actor_card.id, v_new_value, v_actor_card.current_value_source_player_id, 'bad_move');
      v_private := jsonb_build_object('newCardValue', v_new_value);
      v_public := jsonb_build_object('cardModified', true);
    when 'forced_share' then
      select array_agg(p.id order by p.join_order) into v_candidates
      from public.players p
      where p.room_id = v_draw.room_id and p.match_participant and p.left_at is null
        and p.id <> v_actor.id
        and p.score = (select min(score) from public.players where room_id = v_draw.room_id and match_participant and left_at is null);
      v_target_id := private.pick_secure_player(v_candidates);
      if v_target_id is not null then
        select * into v_target from public.players where id = v_target_id for update;
        v_amount := least(300, v_actor.score::integer);
        v_actor_delta := private.apply_action_score_delta(v_draw.room_id, v_draw.round_id, v_actor.id, v_draw.id, -v_amount, 'forced_share_paid');
        v_target_delta := private.apply_action_score_delta(v_draw.room_id, v_draw.round_id, v_target.id, v_draw.id, v_amount, 'forced_share_received');
      else v_amount := 0; end if;
      v_public := jsonb_build_object('targetPlayerId', v_target_id, 'pointsTransferred', v_amount);
    when 'score_drop' then
      v_amount := least(v_actor.score::integer, private.round_half_up_50(v_actor.score * 0.15));
      v_actor_delta := private.apply_action_score_delta(v_draw.room_id, v_draw.round_id, v_actor.id, v_draw.id, -v_amount, 'score_drop');
      v_public := jsonb_build_object('pointsChanged', v_actor_delta);
    when 'empty_round' then
      perform private.mutate_point_card(v_draw.id, v_actor_card.id, 0, v_actor_card.current_value_source_player_id, 'empty_round');
      v_private := jsonb_build_object('newCardValue', 0);
      v_public := jsonb_build_object('cardModified', true);
    when 'leader_bonus' then
      select array_agg(p.id order by p.join_order) into v_candidates
      from public.players p
      where p.room_id = v_draw.room_id and p.match_participant and p.left_at is null
        and p.id <> v_actor.id
        and p.score = (select max(score) from public.players where room_id = v_draw.room_id and match_participant and left_at is null);
      v_target_id := private.pick_secure_player(v_candidates);
      if v_target_id is null and v_actor.score = (
        select max(score) from public.players where room_id = v_draw.room_id and match_participant and left_at is null
      ) then
        v_amount := least(150, v_actor.score::integer);
        v_actor_delta := private.apply_action_score_delta(v_draw.room_id, v_draw.round_id, v_actor.id, v_draw.id, -v_amount, 'leader_bonus_sole_penalty');
      elsif v_target_id is not null then
        select * into v_target from public.players where id = v_target_id for update;
        v_amount := least(300, v_actor.score::integer);
        v_actor_delta := private.apply_action_score_delta(v_draw.room_id, v_draw.round_id, v_actor.id, v_draw.id, -v_amount, 'leader_bonus_paid');
        v_target_delta := private.apply_action_score_delta(v_draw.room_id, v_draw.round_id, v_target.id, v_draw.id, v_amount, 'leader_bonus_received');
      else v_amount := 0; end if;
      v_public := jsonb_build_object('targetPlayerId', v_target_id, 'pointsTransferred', v_amount, 'drawerChange', v_actor_delta);
    when 'double_or_zero' then
      v_multiplier := case private.secure_random_index(2, 'scoreup.test_double_or_zero') when 0 then 0 else 2 end;
      v_new_value := v_actor_card.current_value * v_multiplier;
      perform private.mutate_point_card(v_draw.id, v_actor_card.id, v_new_value, v_actor_card.current_value_source_player_id, 'double_or_zero');
      v_private := jsonb_build_object('multiplier', v_multiplier, 'newCardValue', v_new_value);
      v_public := jsonb_build_object('multiplier', v_multiplier, 'cardModified', true);
    when 'random_card_swap' then
      select array_agg(p.id order by p.join_order) into v_candidates
      from public.players p join public.round_cards_private c on c.round_id = v_draw.round_id and c.player_id = p.id
      where p.room_id = v_draw.room_id and p.match_participant and p.left_at is null
        and p.id <> v_actor.id and c.resolution_status = 'unresolved';
      v_target_id := private.pick_secure_player(v_candidates);
      if v_target_id is not null then
        select * into v_target_card from public.round_cards_private
        where round_id = v_draw.round_id and player_id = v_target_id for update;
        perform private.mutate_point_card(v_draw.id, v_actor_card.id, v_target_card.current_value, v_target_card.current_value_source_player_id, 'random_card_swap');
        perform private.mutate_point_card(v_draw.id, v_target_card.id, v_actor_card.current_value, v_actor_card.current_value_source_player_id, 'random_card_swap');
        v_private := jsonb_build_object('targetPlayerId', v_target_id, 'newCardValue', v_target_card.current_value);
      end if;
      v_public := jsonb_build_object('targetPlayerId', v_target_id, 'cardsSwapped', v_target_id is not null);
    when 'shared_fate' then
      select array_agg(p.id order by p.join_order) into v_candidates
      from public.players p where p.room_id = v_draw.room_id and p.match_participant and p.left_at is null and p.id <> v_actor.id;
      v_target_id := private.pick_secure_player(v_candidates);
      if v_target_id is not null then
        v_actor_outcome := case private.secure_random_index(2, 'scoreup.test_shared_actor_outcome') when 0 then -300 else 300 end;
        v_target_outcome := case private.secure_random_index(2, 'scoreup.test_shared_target_outcome') when 0 then -300 else 300 end;
        v_actor_delta := private.apply_action_score_delta(v_draw.room_id, v_draw.round_id, v_actor.id, v_draw.id, v_actor_outcome, 'shared_fate_actor');
        v_target_delta := private.apply_action_score_delta(v_draw.room_id, v_draw.round_id, v_target_id, v_draw.id, v_target_outcome, 'shared_fate_target');
      end if;
      v_public := jsonb_build_object('targetPlayerId', v_target_id, 'drawerChange', v_actor_delta, 'targetChange', v_target_delta);
    when 'comeback_card' then
      select ordered.position, ordered.total into v_position, v_count
      from (
        select p.id, row_number() over (order by p.score desc, p.join_order)::integer as position,
          count(*) over ()::integer as total
        from public.players p
        where p.room_id = v_draw.room_id and p.match_participant and p.left_at is null
      ) ordered where ordered.id = v_actor.id;
      if v_position > floor(v_count::numeric / 2) then
        v_actor_delta := private.apply_action_score_delta(v_draw.room_id, v_draw.round_id, v_actor.id, v_draw.id, 500, 'comeback_gain');
        v_public := jsonb_build_object('half', 'bottom', 'pointsChanged', v_actor_delta);
      else
        v_amount := least(300, v_actor.score::integer);
        v_actor_delta := private.apply_action_score_delta(v_draw.room_id, v_draw.round_id, v_actor.id, v_draw.id, -v_amount, 'comeback_loss');
        v_public := jsonb_build_object('half', 'top', 'pointsChanged', v_actor_delta);
      end if;
    when 'mystery_multiplier' then
      v_multiplier := private.secure_random_index(3, 'scoreup.test_mystery_multiplier');
      v_new_value := v_actor_card.current_value * v_multiplier;
      perform private.mutate_point_card(v_draw.id, v_actor_card.id, v_new_value, v_actor_card.current_value_source_player_id, 'mystery_multiplier');
      v_private := jsonb_build_object('multiplier', v_multiplier, 'newCardValue', v_new_value);
      v_public := jsonb_build_object('multiplier', v_multiplier, 'cardModified', true);
    when 'reverse_swipe' then
      select array_agg(p.id order by p.join_order) into v_candidates
      from public.players p where p.room_id = v_draw.room_id and p.match_participant and p.left_at is null and p.id <> v_actor.id;
      v_target_id := private.pick_secure_player(v_candidates);
      if v_target_id is not null then
        select * into v_target from public.players where id = v_target_id for update;
        if private.secure_random_index(2, 'scoreup.test_reverse_direction') = 0 then
          v_amount := least(300, v_target.score::integer);
          v_target_delta := private.apply_action_score_delta(v_draw.room_id, v_draw.round_id, v_target.id, v_draw.id, -v_amount, 'reverse_swipe_target_paid');
          v_actor_delta := private.apply_action_score_delta(v_draw.room_id, v_draw.round_id, v_actor.id, v_draw.id, v_amount, 'reverse_swipe_actor_received');
          v_public := jsonb_build_object('targetPlayerId', v_target.id, 'direction', 'to_drawer', 'pointsTransferred', v_amount);
        else
          v_amount := least(300, v_actor.score::integer);
          v_actor_delta := private.apply_action_score_delta(v_draw.room_id, v_draw.round_id, v_actor.id, v_draw.id, -v_amount, 'reverse_swipe_actor_paid');
          v_target_delta := private.apply_action_score_delta(v_draw.room_id, v_draw.round_id, v_target.id, v_draw.id, v_amount, 'reverse_swipe_target_received');
          v_public := jsonb_build_object('targetPlayerId', v_target.id, 'direction', 'to_target', 'pointsTransferred', v_amount);
        end if;
      else v_public := jsonb_build_object('targetPlayerId', null, 'pointsTransferred', 0); end if;
    else
      raise exception using errcode = 'P0001', message = 'UNKNOWN_ACTION_CARD';
  end case;

  update public.action_draws
  set status = 'resolved', target_player_id = coalesce(v_target_id, p_target_player_id),
      private_effect_result = v_private,
      public_safe_result = v_public || jsonb_build_object('blocked', v_blocked),
      targeted_at = case when target_requirement = 'player_select' then statement_timestamp() else targeted_at end,
      resolved_at = statement_timestamp()
  where id = v_draw.id;
  update public.rooms set match_version = match_version + 1 where id = v_draw.room_id;
  perform private.record_game_event(
    v_draw.room_id, v_draw.round_number, 'action_card_resolved', v_draw.player_id,
    jsonb_build_object('cardCode', v_draw.card_code, 'category', v_draw.category, 'result', v_public || jsonb_build_object('blocked', v_blocked))
  );
end;
$$;

create or replace function private.maybe_complete_action_phase(p_room_id uuid, p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_round public.rounds%rowtype;
  v_participants integer;
  v_choices integer;
  v_pending integer;
  v_order uuid[];
  v_deadline timestamptz;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  select * into v_round from public.rounds where id = p_round_id for update;
  select count(*) into v_participants from public.players
  where room_id = p_room_id and match_participant and left_at is null;
  select count(*) into v_choices from public.action_choices where round_id = p_round_id;
  select count(*) into v_pending from public.action_draws
  where round_id = p_round_id and status = 'awaiting_target';
  if v_choices < v_participants or v_pending > 0 then return; end if;

  v_order := private.shuffle_match_players(p_room_id, (
    select decision_order from public.rounds
    where room_id = p_room_id and round_number < v_round.round_number
    order by round_number desc limit 1
  ));
  v_deadline := statement_timestamp() + make_interval(secs => v_room.turn_timer_seconds);
  update public.rounds
  set phase = 'point_decisions', decision_order = v_order,
      current_turn_index = 0, current_turn_player_id = v_order[1],
      phase_deadline = v_deadline, turn_deadline = v_deadline
  where id = p_round_id;
  update public.rooms
  set current_phase = 'point_decisions', current_turn_player_id = v_order[1],
      phase_deadline = v_deadline, match_version = match_version + 1
  where id = p_room_id;
  perform private.record_game_event(p_room_id, v_round.round_number, 'action_phase_completed', null, '{}'::jsonb);
  perform private.record_game_event(
    p_room_id, v_round.round_number, 'turn_started', v_order[1],
    jsonb_build_object('turnIndex', 0, 'deadline', v_deadline)
  );
end;
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
  if exists (select 1 from public.rounds where room_id = p_room_id and round_number = p_round_number) then
    raise exception using errcode = 'P0001', message = 'ROUND_ALREADY_EXISTS';
  end if;
  insert into public.rounds (
    id, room_id, round_number, phase, status, decision_order
  ) values (
    v_round_id, p_room_id, p_round_number, 'dealing', 'active', '{}'::uuid[]
  );
  for v_player in
    select p.id from public.players p
    where p.room_id = p_room_id and p.match_participant and p.left_at is null
    order by p.join_order
  loop
    v_card := private.draw_point_card();
    insert into public.round_cards_private (
      round_id, room_id, round_number, player_id, original_value,
      current_value, current_value_source_player_id
    ) values (
      v_round_id, p_room_id, p_round_number, v_player.id,
      v_card, v_card, v_player.id
    );
  end loop;
  v_deadline := statement_timestamp() + make_interval(secs => v_room.turn_timer_seconds);
  update public.rounds
  set phase = 'action_choice', action_deadline = v_deadline,
      phase_deadline = v_deadline, current_turn_index = null,
      current_turn_player_id = null, turn_deadline = null
  where id = v_round_id;
  update public.rooms
  set status = 'in_progress', current_round = p_round_number,
      current_phase = 'action_choice', current_turn_player_id = null,
      phase_deadline = v_deadline, match_version = match_version + 1
  where id = p_room_id;
  perform private.record_game_event(
    p_room_id, p_round_number, 'round_started', null,
    jsonb_build_object('roundNumber', p_round_number)
  );
  perform private.record_game_event(
    p_room_id, p_round_number, 'action_phase_started', null,
    jsonb_build_object('deadline', v_deadline)
  );
end;
$$;

create or replace function public.submit_action_choice(
  p_room_id uuid,
  p_choice public.action_choice_type,
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
  v_player public.players%rowtype;
  v_existing public.action_choices%rowtype;
  v_choice_id uuid := extensions.gen_random_uuid();
  v_draw_id uuid := extensions.gen_random_uuid();
  v_card private.action_card_catalog%rowtype;
begin
  if p_choice is null or p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  select * into v_player from public.players
  where room_id = p_room_id and auth_user_id = v_user_id
    and match_participant and left_at is null for update;
  if v_player.id is null then raise exception using errcode = 'P0001', message = 'NOT_MATCH_PARTICIPANT'; end if;
  select * into v_existing from public.action_choices
  where room_id = p_room_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null and v_existing.player_id = v_player.id and v_existing.choice = p_choice then
    return private.build_match_snapshot(p_room_id, v_user_id);
  elsif v_existing.id is not null then
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
  end if;
  if v_room.status <> 'in_progress' or v_room.current_phase <> 'action_choice' then
    raise exception using errcode = 'P0001', message = 'WRONG_PHASE';
  end if;
  select * into v_round from public.rounds
  where room_id = p_room_id and round_number = v_room.current_round for update;
  if exists (select 1 from public.action_choices where round_id = v_round.id and player_id = v_player.id) then
    raise exception using errcode = 'P0001', message = 'ACTION_ALREADY_CHOSEN';
  end if;
  if v_round.action_deadline <= statement_timestamp() then
    raise exception using errcode = 'P0001', message = 'ACTION_DEADLINE_EXPIRED';
  end if;
  if p_choice = 'draw' and v_player.action_draws_used >= v_player.action_draw_allowance then
    raise exception using errcode = 'P0001', message = 'ACTION_ALLOWANCE_EXHAUSTED';
  end if;

  insert into public.action_choices (
    id, round_id, room_id, round_number, player_id, choice, idempotency_key
  ) values (
    v_choice_id, v_round.id, p_room_id, v_round.round_number,
    v_player.id, p_choice, p_idempotency_key
  );
  if p_choice = 'skip' then
    perform private.record_game_event(p_room_id, v_round.round_number, 'action_skipped', v_player.id, '{}'::jsonb);
  else
    v_card := private.select_action_card();
    insert into public.action_draws (
      id, choice_id, round_id, room_id, round_number, player_id,
      card_code, category, status, target_requirement, idempotency_key,
      target_deadline
    ) values (
      v_draw_id, v_choice_id, v_round.id, p_room_id, v_round.round_number, v_player.id,
      v_card.code, v_card.category,
      case when v_card.target_requirement = 'player_select' then 'awaiting_target'::public.action_draw_status else 'selected'::public.action_draw_status end,
      v_card.target_requirement, p_idempotency_key,
      case when v_card.target_requirement = 'player_select'
        then least(v_round.action_deadline, statement_timestamp() + interval '10 seconds')
        else null end
    );
    update public.players set action_draws_used = action_draws_used + 1 where id = v_player.id;
    if v_card.target_requirement = 'player_select' then
      perform private.record_game_event(p_room_id, v_round.round_number, 'action_target_required', v_player.id, '{}'::jsonb);
    else
      perform private.resolve_action_draw(v_draw_id, null);
    end if;
  end if;
  update public.rooms set match_version = match_version + 1 where id = p_room_id;
  perform private.maybe_complete_action_phase(p_room_id, v_round.id);
  return private.build_match_snapshot(p_room_id, v_user_id);
end;
$$;

create or replace function public.submit_action_target(
  p_room_id uuid,
  p_action_draw_id uuid,
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
  v_draw public.action_draws%rowtype;
begin
  if p_action_draw_id is null or p_target_player_id is null or p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  perform 1 from public.rooms where id = p_room_id for update;
  if not private.is_match_participant(p_room_id, v_user_id) then
    raise exception using errcode = 'P0001', message = 'NOT_MATCH_PARTICIPANT';
  end if;
  select d.* into v_draw from public.action_draws d
  join public.players p on p.id = d.player_id
  where d.id = p_action_draw_id and d.room_id = p_room_id
    and p.auth_user_id = v_user_id for update of d;
  if v_draw.id is null then raise exception using errcode = 'P0001', message = 'ACTION_DRAW_NOT_FOUND'; end if;
  if v_draw.status = 'resolved' and v_draw.target_idempotency_key = p_idempotency_key then
    return private.build_match_snapshot(p_room_id, v_user_id);
  end if;
  if v_draw.status <> 'awaiting_target' then
    raise exception using errcode = 'P0001', message = 'ACTION_ALREADY_RESOLVED';
  end if;
  if v_draw.target_deadline <= statement_timestamp() then
    raise exception using errcode = 'P0001', message = 'TARGET_DEADLINE_EXPIRED';
  end if;
  update public.action_draws set target_idempotency_key = p_idempotency_key where id = v_draw.id;
  perform private.resolve_action_draw(v_draw.id, p_target_player_id);
  perform private.maybe_complete_action_phase(p_room_id, v_draw.round_id);
  return private.build_match_snapshot(p_room_id, v_user_id);
end;
$$;

create or replace function public.process_expired_action_phase(
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
  v_round public.rounds%rowtype;
  v_player record;
  v_draw record;
  v_candidates uuid[];
  v_target_id uuid;
begin
  if p_idempotency_key is null then raise exception using errcode = 'P0001', message = 'INVALID_INPUT'; end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not private.is_match_participant(p_room_id, v_user_id) then
    raise exception using errcode = 'P0001', message = 'NOT_MATCH_PARTICIPANT';
  end if;
  if v_room.current_phase <> 'action_choice' then return private.build_match_snapshot(p_room_id, v_user_id); end if;
  select * into v_round from public.rounds
  where room_id = p_room_id and round_number = v_room.current_round for update;
  if v_round.action_deadline > statement_timestamp() then
    raise exception using errcode = 'P0001', message = 'DEADLINE_NOT_EXPIRED';
  end if;
  for v_player in
    select p.id from public.players p
    where p.room_id = p_room_id and p.match_participant and p.left_at is null
      and not exists (select 1 from public.action_choices c where c.round_id = v_round.id and c.player_id = p.id)
    order by p.join_order
  loop
    insert into public.action_choices (
      round_id, room_id, round_number, player_id, choice, automatic, idempotency_key
    ) values (
      v_round.id, p_room_id, v_round.round_number, v_player.id,
      'skip', true, extensions.gen_random_uuid()
    );
    perform private.record_game_event(p_room_id, v_round.round_number, 'action_auto_skipped', v_player.id, '{}'::jsonb);
  end loop;
  for v_draw in
    select d.id, d.player_id from public.action_draws d
    where d.round_id = v_round.id and d.status = 'awaiting_target'
      and d.target_deadline <= statement_timestamp()
    order by d.drawn_at, d.id
    for update
  loop
    select array_agg(p.id order by p.join_order) into v_candidates
    from public.players p
    join public.round_cards_private c
      on c.round_id = v_round.id and c.player_id = p.id
    where p.room_id = p_room_id and p.match_participant and p.left_at is null
      and p.id <> v_draw.player_id and c.resolution_status = 'unresolved';
    v_target_id := private.pick_secure_player(v_candidates);
    if v_target_id is not null then
      update public.action_draws
      set target_idempotency_key = extensions.gen_random_uuid()
      where id = v_draw.id;
      perform private.resolve_action_draw(v_draw.id, v_target_id);
    end if;
  end loop;
  perform private.maybe_complete_action_phase(p_room_id, v_round.id);
  return private.build_match_snapshot(p_room_id, v_user_id);
end;
$$;

create or replace function public.process_expired_action_target(
  p_room_id uuid,
  p_action_draw_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_anonymous_user();
  v_draw public.action_draws%rowtype;
  v_candidates uuid[];
  v_target_id uuid;
begin
  if p_action_draw_id is null or p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  perform 1 from public.rooms where id = p_room_id for update;
  if not private.is_match_participant(p_room_id, v_user_id) then
    raise exception using errcode = 'P0001', message = 'NOT_MATCH_PARTICIPANT';
  end if;
  select * into v_draw from public.action_draws
  where id = p_action_draw_id and room_id = p_room_id for update;
  if v_draw.id is null then raise exception using errcode = 'P0001', message = 'ACTION_DRAW_NOT_FOUND'; end if;
  if v_draw.status = 'resolved' then return private.build_match_snapshot(p_room_id, v_user_id); end if;
  if v_draw.target_deadline > statement_timestamp() then
    raise exception using errcode = 'P0001', message = 'DEADLINE_NOT_EXPIRED';
  end if;
  select array_agg(p.id order by p.join_order) into v_candidates
  from public.players p join public.round_cards_private c
    on c.round_id = v_draw.round_id and c.player_id = p.id
  where p.room_id = p_room_id and p.match_participant and p.left_at is null
    and p.id <> v_draw.player_id and c.resolution_status = 'unresolved';
  v_target_id := private.pick_secure_player(v_candidates);
  if v_target_id is null then raise exception using errcode = 'P0001', message = 'NO_ELIGIBLE_TARGET'; end if;
  update public.action_draws set target_idempotency_key = p_idempotency_key where id = v_draw.id;
  perform private.resolve_action_draw(v_draw.id, v_target_id);
  perform private.maybe_complete_action_phase(p_room_id, v_draw.round_id);
  return private.build_match_snapshot(p_room_id, v_user_id);
end;
$$;

create or replace function public.get_action_state_snapshot(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := private.require_anonymous_user();
begin
  if not private.is_match_participant(p_room_id, v_user_id) then
    raise exception using errcode = 'P0001', message = 'NOT_MATCH_PARTICIPANT';
  end if;
  return private.build_match_snapshot(p_room_id, v_user_id);
end;
$$;

create trigger action_choices_broadcast_game_change
after insert or update on public.action_choices
for each row execute function private.broadcast_game_change();
create trigger action_draws_broadcast_game_change
after insert or update on public.action_draws
for each row execute function private.broadcast_game_change();

alter table public.action_choices enable row level security;
alter table public.action_draws enable row level security;
alter table public.action_choices force row level security;
alter table public.action_draws force row level security;
create policy action_choices_owner_select on public.action_choices
for select to authenticated using (private.is_action_owner(player_id));
create policy action_draws_owner_select on public.action_draws
for select to authenticated using (private.is_action_owner(player_id));

revoke all on table public.action_choices, public.action_draws from public, anon, authenticated;
grant select on public.action_choices, public.action_draws to authenticated;
revoke all on table private.action_card_catalog, private.action_shields,
  private.point_card_mutations from public, anon, authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_room_member(uuid, uuid) to authenticated;
grant execute on function private.is_match_participant(uuid, uuid) to authenticated;
grant execute on function private.is_card_owner(uuid, uuid) to authenticated;
grant execute on function private.is_action_owner(uuid, uuid) to authenticated;

revoke all on function public.submit_action_choice(uuid, public.action_choice_type, uuid) from public, anon;
revoke all on function public.submit_action_target(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.process_expired_action_phase(uuid, uuid) from public, anon;
revoke all on function public.process_expired_action_target(uuid, uuid, uuid) from public, anon;
revoke all on function public.get_action_state_snapshot(uuid) from public, anon;
grant execute on function public.submit_action_choice(uuid, public.action_choice_type, uuid) to authenticated;
grant execute on function public.submit_action_target(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.process_expired_action_phase(uuid, uuid) to authenticated;
grant execute on function public.process_expired_action_target(uuid, uuid, uuid) to authenticated;
grant execute on function public.get_action_state_snapshot(uuid) to authenticated;

comment on table private.action_card_catalog is
  'Server-owned weighted 18-card catalog. No browser role can select or mutate it.';
comment on function public.submit_action_choice is
  'Authenticated one-per-round Draw or Skip. Card selection and resolution remain server-authoritative.';
comment on function public.process_expired_action_target is
  'Participant-triggered secure automatic target selection after an owner target deadline expires.';
