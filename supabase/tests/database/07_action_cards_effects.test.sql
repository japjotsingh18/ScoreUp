begin;
set local search_path = public, extensions;

select plan(40);

insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at)
select ('50000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', true, now(), now()
from generate_series(1, 3) value;

select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok($$ select public.create_room('Action Host', 3, 6, 20, null, '51000000-0000-4000-8000-000000000001') $$, 'action-effect room is created');
reset role;
select set_config('scoreup.action_room', (select id::text from public.rooms where created_by_user_id = '50000000-0000-4000-8000-000000000001'), true);
select set_config('scoreup.action_code', (select room_code from public.rooms where id = current_setting('scoreup.action_room')::uuid), true);

select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(format('select public.join_room(%L, %L, null)', current_setting('scoreup.action_code'), 'Action Two'), 'second effect player joins');
select public.set_ready_state(current_setting('scoreup.action_room')::uuid, true);
reset role;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(format('select public.join_room(%L, %L, null)', current_setting('scoreup.action_code'), 'Action Three'), 'third effect player joins');
select public.set_ready_state(current_setting('scoreup.action_room')::uuid, true);
reset role;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(format('select public.start_room(%L)', current_setting('scoreup.action_room')::uuid), 'effect match starts in action choice');
reset role;

select set_config('scoreup.actor', (select id::text from public.players where room_id = current_setting('scoreup.action_room')::uuid order by join_order limit 1), true);
select set_config('scoreup.target', (select id::text from public.players where room_id = current_setting('scoreup.action_room')::uuid order by join_order offset 1 limit 1), true);
select set_config('scoreup.third', (select id::text from public.players where room_id = current_setting('scoreup.action_room')::uuid order by join_order offset 2 limit 1), true);

create function pg_temp.reset_effect_state()
returns void language plpgsql as $$
begin
  delete from public.action_choices where room_id = current_setting('scoreup.action_room')::uuid;
  update public.players set score = case id
    when current_setting('scoreup.actor')::uuid then 1000
    when current_setting('scoreup.target')::uuid then 500 else 0 end
  where room_id = current_setting('scoreup.action_room')::uuid;
  update public.round_cards_private card
  set original_value = case card.player_id when current_setting('scoreup.actor')::uuid then 500 when current_setting('scoreup.target')::uuid then 250 else 750 end,
      current_value = case card.player_id when current_setting('scoreup.actor')::uuid then 500 when current_setting('scoreup.target')::uuid then 250 else 750 end,
      current_value_source_player_id = card.player_id,
      resolution_status = 'unresolved', resolution_type = null, points_awarded = 0, resolved_at = null
  where room_id = current_setting('scoreup.action_room')::uuid;
end;
$$;

create function pg_temp.resolve_card(p_actor uuid, p_code text, p_target uuid default null)
returns uuid language plpgsql as $$
declare
  v_round public.rounds%rowtype;
  v_choice uuid := gen_random_uuid();
  v_draw uuid := gen_random_uuid();
  v_card private.action_card_catalog%rowtype;
begin
  select * into strict v_round from public.rounds where room_id = current_setting('scoreup.action_room')::uuid;
  select * into strict v_card from private.action_card_catalog where code = p_code;
  insert into public.action_choices(id, round_id, room_id, round_number, player_id, choice, idempotency_key)
  values(v_choice, v_round.id, v_round.room_id, v_round.round_number, p_actor, 'draw', gen_random_uuid());
  insert into public.action_draws(id, choice_id, round_id, room_id, round_number, player_id, card_code, category, status, target_requirement, idempotency_key, target_deadline)
  values(v_draw, v_choice, v_round.id, v_round.room_id, v_round.round_number, p_actor, p_code, v_card.category,
    case when v_card.target_requirement = 'player_select' then 'awaiting_target'::public.action_draw_status else 'selected'::public.action_draw_status end,
    v_card.target_requirement, gen_random_uuid(), case when v_card.target_requirement = 'player_select' then now() + interval '10 seconds' end);
  perform private.resolve_action_draw(v_draw, p_target);
  return v_draw;
end;
$$;

select pg_temp.reset_effect_state(); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'score_boost');
select is((select score from public.players where id = current_setting('scoreup.actor')::uuid), 1500::bigint, 'Score Boost adds 500');
select pg_temp.reset_effect_state(); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'double_up');
select is((select current_value from public.round_cards_private where player_id = current_setting('scoreup.actor')::uuid), 1000, 'Double Up doubles the current card');
select pg_temp.reset_effect_state(); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'point_swipe', current_setting('scoreup.target')::uuid);
select is((select score from public.players where id = current_setting('scoreup.actor')::uuid), 1300::bigint, 'Point Swipe credits the drawer');
select is((select score from public.players where id = current_setting('scoreup.target')::uuid), 200::bigint, 'Point Swipe debits up to 300');
select pg_temp.reset_effect_state(); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'shield');
select ok((select active from private.action_shields where player_id = current_setting('scoreup.actor')::uuid), 'Shield becomes active for the round');
select pg_temp.reset_effect_state(); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'fresh_draw');
select ok((select current_value in (0,100,250,500,750,1000) from public.round_cards_private where player_id = current_setting('scoreup.actor')::uuid), 'Fresh Draw uses the secure point deck');
select is((select count(*) from private.point_card_mutations), 1::bigint, 'Fresh Draw leaves one private mutation record');
select pg_temp.reset_effect_state(); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'bonus_momentum');
select is((select score from public.players where id = current_setting('scoreup.actor')::uuid), 1150::bigint, 'Bonus Momentum rounds 15 percent to 150');
select pg_temp.reset_effect_state();
update public.players set score = 0 where id = current_setting('scoreup.actor')::uuid;
select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'bonus_momentum');
select is((select score from public.players where id = current_setting('scoreup.actor')::uuid), 50::bigint, 'Bonus Momentum awards its 50 point minimum at zero score');
select pg_temp.reset_effect_state(); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'point_penalty');
select is((select score from public.players where id = current_setting('scoreup.actor')::uuid), 600::bigint, 'Point Penalty removes 400 without underflow');
select pg_temp.reset_effect_state(); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'bad_move');
select is((select current_value from public.round_cards_private where player_id = current_setting('scoreup.actor')::uuid), 250, 'Bad Move halves and rounds the current card');
select pg_temp.reset_effect_state(); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'forced_share');
select is((select score from public.players where id = current_setting('scoreup.third')::uuid), 300::bigint, 'Forced Share pays an eligible last-place player');
select pg_temp.reset_effect_state(); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'score_drop');
select is((select score from public.players where id = current_setting('scoreup.actor')::uuid), 850::bigint, 'Score Drop removes rounded 15 percent');
select pg_temp.reset_effect_state(); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'empty_round');
select is((select current_value from public.round_cards_private where player_id = current_setting('scoreup.actor')::uuid), 0, 'Empty Round zeroes the current card');
select pg_temp.reset_effect_state(); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'leader_bonus');
select is((select score from public.players where id = current_setting('scoreup.actor')::uuid), 850::bigint, 'Leader Bonus charges the sole leader 150');

select pg_temp.reset_effect_state(); select set_config('scoreup.test_double_or_zero', '0', true); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'double_or_zero');
select is((select current_value from public.round_cards_private where player_id = current_setting('scoreup.actor')::uuid), 0, 'Double or Zero supports the zero outcome');
select pg_temp.reset_effect_state(); select set_config('scoreup.test_double_or_zero', '1', true); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'double_or_zero');
select is((select current_value from public.round_cards_private where player_id = current_setting('scoreup.actor')::uuid), 1000, 'Double or Zero supports the double outcome');
select pg_temp.reset_effect_state(); select set_config('scoreup.test_target_player_id', current_setting('scoreup.target'), true); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'random_card_swap');
select is((select current_value from public.round_cards_private where player_id = current_setting('scoreup.actor')::uuid), 250, 'Random Card Swap gives the actor the target card');
select is((select current_value from public.round_cards_private where player_id = current_setting('scoreup.target')::uuid), 500, 'Random Card Swap gives the target the actor card');
select pg_temp.reset_effect_state(); select set_config('scoreup.test_shared_actor_outcome', '0', true); select set_config('scoreup.test_shared_target_outcome', '1', true); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'shared_fate');
select is((select score from public.players where id = current_setting('scoreup.actor')::uuid), 700::bigint, 'Shared Fate can deduct from the actor');
select is((select score from public.players where id = current_setting('scoreup.target')::uuid), 800::bigint, 'Shared Fate independently credits its target');
select pg_temp.reset_effect_state(); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'comeback_card');
select is((select score from public.players where id = current_setting('scoreup.actor')::uuid), 700::bigint, 'Comeback Card penalizes a top-half actor');
select pg_temp.reset_effect_state(); select pg_temp.resolve_card(current_setting('scoreup.third')::uuid, 'comeback_card');
select is((select score from public.players where id = current_setting('scoreup.third')::uuid), 500::bigint, 'Comeback Card rewards a bottom-half actor including odd rosters');
select pg_temp.reset_effect_state(); select set_config('scoreup.test_mystery_multiplier', '0', true); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'mystery_multiplier');
select is((select current_value from public.round_cards_private where player_id = current_setting('scoreup.actor')::uuid), 0, 'Mystery Multiplier supports zero');
select pg_temp.reset_effect_state(); select set_config('scoreup.test_mystery_multiplier', '1', true); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'mystery_multiplier');
select is((select current_value from public.round_cards_private where player_id = current_setting('scoreup.actor')::uuid), 500, 'Mystery Multiplier supports one');
select pg_temp.reset_effect_state(); select set_config('scoreup.test_mystery_multiplier', '2', true); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'mystery_multiplier');
select is((select current_value from public.round_cards_private where player_id = current_setting('scoreup.actor')::uuid), 1000, 'Mystery Multiplier supports two');
select pg_temp.reset_effect_state(); select set_config('scoreup.test_reverse_direction', '0', true); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'reverse_swipe');
select is((select score from public.players where id = current_setting('scoreup.actor')::uuid), 1300::bigint, 'Reverse Swipe can transfer toward the drawer');
select pg_temp.reset_effect_state(); select set_config('scoreup.test_reverse_direction', '1', true); select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'reverse_swipe');
select is((select score from public.players where id = current_setting('scoreup.actor')::uuid), 700::bigint, 'Reverse Swipe can transfer away from the drawer');

select pg_temp.reset_effect_state(); select pg_temp.resolve_card(current_setting('scoreup.target')::uuid, 'shield');
select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'point_swipe', current_setting('scoreup.target')::uuid);
select is((select score from public.players where id = current_setting('scoreup.target')::uuid), 500::bigint, 'Shield blocks the complete targeted swipe');
select ok(not (select active from private.action_shields where player_id = current_setting('scoreup.target')::uuid), 'a successful block consumes Shield');
select is((select count(*) from public.score_ledger where room_id = current_setting('scoreup.action_room')::uuid), 0::bigint, 'blocked transfer writes no false score ledger entries');

select pg_temp.reset_effect_state();
update public.round_cards_private
set resolution_status = 'resolved', resolution_type = 'lock_in',
    points_awarded = current_value, resolved_at = statement_timestamp()
where player_id <> current_setting('scoreup.actor')::uuid;
select pg_temp.resolve_card(current_setting('scoreup.actor')::uuid, 'random_card_swap');
select is((select current_value from public.round_cards_private where player_id = current_setting('scoreup.actor')::uuid), 500, 'Random Card Swap is a no-op without an eligible card');
select ok((select public_safe_result->>'cardsSwapped' = 'false' from public.action_draws where player_id = current_setting('scoreup.actor')::uuid), 'no-target swap resolves with a public-safe no-effect result');

select is(private.round_half_up_50(25), 50, 'half-way point rounding is half up');
select is(private.round_half_up_50(24), 0, 'values below the half-way boundary round down');
select is((select count(*) from public.action_draws where status <> 'resolved'), 0::bigint, 'every tested card resolves transactionally');

select * from finish();
rollback;
