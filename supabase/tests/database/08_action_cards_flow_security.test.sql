begin;
set local search_path = public, extensions;

select plan(33);

insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at)
select ('60000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', true, now(), now()
from generate_series(1, 6) value;

create function pg_temp.make_two_player_room(p_host_user uuid, p_guest_user uuid, p_name text, p_rounds integer, p_key uuid)
returns uuid language plpgsql as $$
declare v_room uuid; v_code text;
begin
  perform set_config('request.jwt.claim.sub', p_host_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_host_user, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  set local role authenticated;
  perform public.create_room(p_name, 2, p_rounds, 20, null, p_key);
  reset role;
  select id, room_code into strict v_room, v_code from public.rooms where created_by_user_id = p_host_user order by created_at desc limit 1;
  perform set_config('request.jwt.claim.sub', p_guest_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_guest_user, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  set local role authenticated;
  perform public.join_room(v_code, p_name || ' Guest', null);
  perform public.set_ready_state(v_room, true);
  reset role;
  perform set_config('request.jwt.claim.sub', p_host_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_host_user, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  set local role authenticated;
  perform public.start_room(v_room);
  reset role;
  return v_room;
end;
$$;

select set_config('scoreup.flow_room', pg_temp.make_two_player_room(
  '60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002',
  'Flow', 6, '61000000-0000-4000-8000-000000000001')::text, true);
select set_config('scoreup.flow_actor', (select id::text from public.players where room_id = current_setting('scoreup.flow_room')::uuid order by join_order limit 1), true);

select is((select current_phase from public.rooms where id = current_setting('scoreup.flow_room')::uuid), 'action_choice'::public.game_phase, 'new rounds enter action choice');
select is((select action_draw_allowance from public.players where id = current_setting('scoreup.flow_actor')::uuid), 2::smallint, 'six-round matches allow two draws');
select set_config('scoreup.test_action_card_code', 'score_boost', true);
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"60000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(format('select public.submit_action_choice(%L, %L, %L)', current_setting('scoreup.flow_room')::uuid, 'draw'::public.action_choice_type, '62000000-0000-4000-8000-000000000001'::uuid), 'authenticated player draws through the authoritative RPC');
select lives_ok(format('select public.submit_action_choice(%L, %L, %L)', current_setting('scoreup.flow_room')::uuid, 'draw'::public.action_choice_type, '62000000-0000-4000-8000-000000000001'::uuid), 'replaying the same draw is idempotent');
select is((public.get_action_state_snapshot(current_setting('scoreup.flow_room')::uuid)->'actionState'->'draw'->>'cardCode'), 'score_boost', 'only the owner snapshot includes its persisted card identity');
select is((public.get_action_state_snapshot(current_setting('scoreup.flow_room')::uuid)->'actionState'->>'drawsRemaining')::integer, 1, 'a draw consumes exactly one allowance');
select throws_ok($$ select private.select_action_card() $$, '42501', null, 'authenticated users cannot execute the selector or its test override');
reset role;
select is((select count(*) from public.action_choices where room_id = current_setting('scoreup.flow_room')::uuid), 1::bigint, 'a replay creates one action choice');
select is((select count(*) from public.action_draws where room_id = current_setting('scoreup.flow_room')::uuid), 1::bigint, 'a replay creates one action draw');
select is((select score from public.players where id = current_setting('scoreup.flow_actor')::uuid), 500::bigint, 'a replay applies Score Boost once');
select is((select count(*) from public.score_ledger where room_id = current_setting('scoreup.flow_room')::uuid), 1::bigint, 'a replay writes one append-only ledger mutation');

select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"60000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select is((select count(*) from public.action_draws where room_id = current_setting('scoreup.flow_room')::uuid), 0::bigint, 'RLS hides another player action draw and private result');
select is(public.get_action_state_snapshot(current_setting('scoreup.flow_room')::uuid)->'actionState'->'draw', 'null'::jsonb, 'another player snapshot contains no private card result');
select lives_ok(format('select public.submit_action_choice(%L, %L, %L)', current_setting('scoreup.flow_room')::uuid, 'skip'::public.action_choice_type, '62000000-0000-4000-8000-000000000002'::uuid), 'the other participant may skip without consuming an allowance');
select throws_ok(format('select public.submit_action_choice(%L, %L, %L)', current_setting('scoreup.flow_room')::uuid, 'draw'::public.action_choice_type, '62000000-0000-4000-8000-000000000003'::uuid), 'P0001', 'WRONG_PHASE', 'draws are rejected after action choice closes');
reset role;
select is((select current_phase from public.rooms where id = current_setting('scoreup.flow_room')::uuid), 'point_decisions'::public.game_phase, 'point decisions begin only after every response resolves');
select is((select count(*) from public.rounds where room_id = current_setting('scoreup.flow_room')::uuid and cardinality(decision_order) = 2), 1::bigint, 'decision order activates after the action phase');

select set_config('scoreup.target_room', pg_temp.make_two_player_room(
  '60000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000004',
  'Target', 10, '61000000-0000-4000-8000-000000000002')::text, true);
select set_config('scoreup.target_actor', (select id::text from public.players where room_id = current_setting('scoreup.target_room')::uuid order by join_order limit 1), true);
select set_config('scoreup.target_player', (select id::text from public.players where room_id = current_setting('scoreup.target_room')::uuid order by join_order offset 1 limit 1), true);
update public.players set score = 500 where id = current_setting('scoreup.target_player')::uuid;
select set_config('scoreup.test_action_card_code', 'point_swipe', true);
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"60000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(format('select public.submit_action_choice(%L, %L, %L)', current_setting('scoreup.target_room')::uuid, 'draw'::public.action_choice_type, '62000000-0000-4000-8000-000000000004'::uuid), 'targeted draw persists before target selection');
select set_config('scoreup.target_draw', (select id::text from public.action_draws where room_id = current_setting('scoreup.target_room')::uuid), true);
select is((select status from public.action_draws where id = current_setting('scoreup.target_draw')::uuid), 'awaiting_target'::public.action_draw_status, 'Point Swipe enters awaiting-target state');
select is((select action_draw_allowance from public.players where id = current_setting('scoreup.target_actor')::uuid), 3::smallint, 'ten-round matches allow three draws');
select throws_ok(format('select public.submit_action_target(%L, %L, %L, %L)', current_setting('scoreup.target_room')::uuid, current_setting('scoreup.target_draw')::uuid, current_setting('scoreup.target_actor')::uuid, '62000000-0000-4000-8000-000000000005'::uuid), 'P0001', 'INVALID_TARGET', 'a targeted action cannot select its drawer');
select lives_ok(format('select public.submit_action_target(%L, %L, %L, %L)', current_setting('scoreup.target_room')::uuid, current_setting('scoreup.target_draw')::uuid, current_setting('scoreup.target_player')::uuid, '62000000-0000-4000-8000-000000000006'::uuid), 'the owner resolves an eligible target');
select lives_ok(format('select public.submit_action_target(%L, %L, %L, %L)', current_setting('scoreup.target_room')::uuid, current_setting('scoreup.target_draw')::uuid, current_setting('scoreup.target_player')::uuid, '62000000-0000-4000-8000-000000000006'::uuid), 'duplicate target submission is idempotent');
reset role;
select is((select score from public.players where id = current_setting('scoreup.target_player')::uuid), 200::bigint, 'duplicate target resolution debits once');
select is((select count(*) from public.score_ledger where action_draw_id = current_setting('scoreup.target_draw')::uuid), 2::bigint, 'one targeted transfer has exactly two signed ledger entries');

select set_config('scoreup.expiry_room', pg_temp.make_two_player_room(
  '60000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000006',
  'Expiry', 8, '61000000-0000-4000-8000-000000000003')::text, true);
select is((select min(action_draw_allowance) from public.players where room_id = current_setting('scoreup.expiry_room')::uuid), 2::smallint, 'eight-round matches allow two draws');
select set_config('scoreup.test_action_card_code', 'point_swipe', true);
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claims', '{"sub":"60000000-0000-4000-8000-000000000005","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(format('select public.submit_action_choice(%L, %L, %L)', current_setting('scoreup.expiry_room')::uuid, 'draw'::public.action_choice_type, '62000000-0000-4000-8000-000000000008'::uuid), 'targeted draw can remain pending until its server deadline');
reset role;
update public.players set score = 500
where room_id = current_setting('scoreup.expiry_room')::uuid
  and auth_user_id = '60000000-0000-4000-8000-000000000006';
update public.action_draws set target_deadline = statement_timestamp() - interval '1 second'
where room_id = current_setting('scoreup.expiry_room')::uuid;
update public.rounds set action_deadline = statement_timestamp() - interval '1 second' where room_id = current_setting('scoreup.expiry_room')::uuid;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claims', '{"sub":"60000000-0000-4000-8000-000000000005","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(format('select public.process_expired_action_phase(%L, %L)', current_setting('scoreup.expiry_room')::uuid, '62000000-0000-4000-8000-000000000007'::uuid), 'an active participant processes the shared expired deadline');
reset role;
select is((select count(*) from public.action_choices where room_id = current_setting('scoreup.expiry_room')::uuid and automatic), 1::bigint, 'every unanswered participant becomes an automatic skip');
select is((select status from public.action_draws where room_id = current_setting('scoreup.expiry_room')::uuid), 'resolved'::public.action_draw_status, 'the shared deadline securely resolves a disconnected owner target');
select is((select score from public.players where room_id = current_setting('scoreup.expiry_room')::uuid and auth_user_id = '60000000-0000-4000-8000-000000000006'), 200::bigint, 'automatic target selection applies the transfer once');
select is((select current_phase from public.rooms where id = current_setting('scoreup.expiry_room')::uuid), 'point_decisions'::public.game_phase, 'automatic skips advance the round transactionally');
select ok(not exists(select 1 from public.game_events where event_type = 'action_card_resolved' and public_payload::text ~ 'oldCardValue|newCardValue'), 'public action events never expose private point-card values');

select * from finish();
rollback;
