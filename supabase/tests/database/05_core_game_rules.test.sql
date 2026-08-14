begin;
set local search_path = public, extensions;

select plan(42);

insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at)
select
  ('40000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', true, now(), now()
from generate_series(1, 8) value;

-- Two-player deterministic loss, win, and zero-value challenge.
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(
  $$ select public.create_room('Rules Host', 2, 6, 20, null, '41000000-0000-4000-8000-000000000001') $$,
  'loss-test room is created'
);
reset role;
select set_config('scoreup.loss_room_id', (select id::text from public.rooms where created_by_user_id = '40000000-0000-4000-8000-000000000001'), true);
select set_config('scoreup.loss_room_code', (select room_code from public.rooms where id = current_setting('scoreup.loss_room_id')::uuid), true);

select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(format('select public.join_room(%L, %L, null)', current_setting('scoreup.loss_room_code'), 'Rules Rival'), 'loss-test rival joins');
select lives_ok(format('select public.set_ready_state(%L, true)', current_setting('scoreup.loss_room_id')::uuid), 'loss-test rival readies');
reset role;

select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(format('select public.start_room(%L)', current_setting('scoreup.loss_room_id')::uuid), 'loss-test match starts');
reset role;
select set_config('scoreup.loss_actor_id', (select current_turn_player_id::text from public.rooms where id = current_setting('scoreup.loss_room_id')::uuid), true);
select set_config('scoreup.loss_actor_user', (select auth_user_id::text from public.players where id = current_setting('scoreup.loss_actor_id')::uuid), true);
select set_config('scoreup.loss_target_id', (select id::text from public.players where room_id = current_setting('scoreup.loss_room_id')::uuid and id <> current_setting('scoreup.loss_actor_id')::uuid), true);
update public.round_cards_private set original_value = 0, current_value = 0 where room_id = current_setting('scoreup.loss_room_id')::uuid and player_id = current_setting('scoreup.loss_actor_id')::uuid;
update public.round_cards_private set original_value = 1000, current_value = 1000 where room_id = current_setting('scoreup.loss_room_id')::uuid and player_id = current_setting('scoreup.loss_target_id')::uuid;
select set_config('request.jwt.claim.sub', current_setting('scoreup.loss_actor_user'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('scoreup.loss_actor_user'), 'role', 'authenticated', 'is_anonymous', true)::text, true);
set local role authenticated;
select lives_ok(
  format('select public.challenge_point_card(%L, %L, %L)', current_setting('scoreup.loss_room_id')::uuid, current_setting('scoreup.loss_target_id')::uuid, '42000000-0000-4000-8000-000000000001'::uuid),
  'zero-value actor can challenge and lose deterministically'
);
reset role;
select is((select score from public.players where id = current_setting('scoreup.loss_actor_id')::uuid), 0::bigint, 'losing actor receives zero points');
select is((select score from public.players where id = current_setting('scoreup.loss_target_id')::uuid), 1000::bigint, 'target winner receives the combined value');
select is((select resolution_type from public.round_cards_private where room_id = current_setting('scoreup.loss_room_id')::uuid and player_id = current_setting('scoreup.loss_actor_id')::uuid), 'challenge_loss'::public.card_resolution_type, 'lower actor card records a loss');
select is((select resolution_type from public.round_cards_private where room_id = current_setting('scoreup.loss_room_id')::uuid and player_id = current_setting('scoreup.loss_target_id')::uuid), 'challenge_win'::public.card_resolution_type, 'higher target card records a win');
select is((select status from public.rounds where room_id = current_setting('scoreup.loss_room_id')::uuid), 'completed'::public.round_status, 'two-player challenge completes the round');

-- Two-player final-round tie: no false unique winner and no extra round.
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(
  $$ select public.create_room('Tie Host', 2, 6, 20, null, '41000000-0000-4000-8000-000000000002') $$,
  'tie-test room is created'
);
reset role;
select set_config('scoreup.tie_room_id', (select id::text from public.rooms where created_by_user_id = '40000000-0000-4000-8000-000000000003'), true);
select set_config('scoreup.tie_room_code', (select room_code from public.rooms where id = current_setting('scoreup.tie_room_id')::uuid), true);
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000004","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(format('select public.join_room(%L, %L, null)', current_setting('scoreup.tie_room_code'), 'Tie Rival'), 'tie-test rival joins');
select lives_ok(format('select public.set_ready_state(%L, true)', current_setting('scoreup.tie_room_id')::uuid), 'tie-test rival readies');
reset role;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(format('select public.start_room(%L)', current_setting('scoreup.tie_room_id')::uuid), 'tie-test match starts');
reset role;
update public.rounds set round_number = 6 where room_id = current_setting('scoreup.tie_room_id')::uuid;
update public.round_cards_private set round_number = 6, original_value = 500, current_value = 500 where room_id = current_setting('scoreup.tie_room_id')::uuid;
update public.rooms set current_round = 6 where id = current_setting('scoreup.tie_room_id')::uuid;
select set_config('scoreup.tie_actor_id', (select current_turn_player_id::text from public.rooms where id = current_setting('scoreup.tie_room_id')::uuid), true);
select set_config('scoreup.tie_actor_user', (select auth_user_id::text from public.players where id = current_setting('scoreup.tie_actor_id')::uuid), true);
select set_config('scoreup.tie_target_id', (select id::text from public.players where room_id = current_setting('scoreup.tie_room_id')::uuid and id <> current_setting('scoreup.tie_actor_id')::uuid), true);
select set_config('request.jwt.claim.sub', current_setting('scoreup.tie_actor_user'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('scoreup.tie_actor_user'), 'role', 'authenticated', 'is_anonymous', true)::text, true);
set local role authenticated;
select lives_ok(
  format('select public.challenge_point_card(%L, %L, %L)', current_setting('scoreup.tie_room_id')::uuid, current_setting('scoreup.tie_target_id')::uuid, '42000000-0000-4000-8000-000000000002'::uuid),
  'equal cards resolve deterministically'
);
reset role;
select is((select min(score) from public.players where room_id = current_setting('scoreup.tie_room_id')::uuid and match_participant), 500::bigint, 'tie awards each player their own value');
select is((select max(score) from public.players where room_id = current_setting('scoreup.tie_room_id')::uuid and match_participant), 500::bigint, 'tie does not award a combined pot');
select is((select status from public.rooms where id = current_setting('scoreup.tie_room_id')::uuid), 'completed'::public.room_status, 'final round completes the match');
select is((select current_phase from public.rooms where id = current_setting('scoreup.tie_room_id')::uuid), 'completed'::public.game_phase, 'final match enters completed phase');
select ok((select tiebreaker_required from public.rooms where id = current_setting('scoreup.tie_room_id')::uuid), 'first-place tie records a future tiebreaker requirement');
select ok((select public_payload->'winnerPlayerId' = 'null'::jsonb and (public_payload->>'tiebreakerRequired')::boolean from public.game_events where room_id = current_setting('scoreup.tie_room_id')::uuid and event_type = 'match_completed'), 'match event does not falsely declare a tied winner');
select is((select count(*) from public.rounds where room_id = current_setting('scoreup.tie_room_id')::uuid), 1::bigint, 'final completion creates no extra round');

-- Three-player room covers odd rosters, invalid targets, phases, deadline checks, and zero Lock In replay.
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000005","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(
  $$ select public.create_room('Odd Host', 3, 6, 20, null, '41000000-0000-4000-8000-000000000003') $$,
  'odd-player room is created'
);
reset role;
select set_config('scoreup.odd_room_id', (select id::text from public.rooms where created_by_user_id = '40000000-0000-4000-8000-000000000005'), true);
select set_config('scoreup.odd_room_code', (select room_code from public.rooms where id = current_setting('scoreup.odd_room_id')::uuid), true);
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000006', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000006","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(format('select public.join_room(%L, %L, null)', current_setting('scoreup.odd_room_code'), 'Odd Two'), 'second odd-room player joins');
select lives_ok(format('select public.set_ready_state(%L, true)', current_setting('scoreup.odd_room_id')::uuid), 'second odd-room player readies');
reset role;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000007', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000007","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(format('select public.join_room(%L, %L, null)', current_setting('scoreup.odd_room_code'), 'Odd Three'), 'third odd-room player joins');
select lives_ok(format('select public.set_ready_state(%L, true)', current_setting('scoreup.odd_room_id')::uuid), 'third odd-room player readies');
reset role;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000005","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(format('select public.start_room(%L)', current_setting('scoreup.odd_room_id')::uuid), 'odd-player match starts');
reset role;
select is((select count(*) from public.players where room_id = current_setting('scoreup.odd_room_id')::uuid and match_participant), 3::bigint, 'odd player count is preserved in the frozen roster');
select set_config('scoreup.odd_actor_id', (select current_turn_player_id::text from public.rooms where id = current_setting('scoreup.odd_room_id')::uuid), true);
select set_config('scoreup.odd_actor_user', (select auth_user_id::text from public.players where id = current_setting('scoreup.odd_actor_id')::uuid), true);
select set_config('scoreup.odd_target_id', (select id::text from public.players where room_id = current_setting('scoreup.odd_room_id')::uuid and id <> current_setting('scoreup.odd_actor_id')::uuid order by join_order limit 1), true);
select set_config('request.jwt.claim.sub', current_setting('scoreup.odd_actor_user'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('scoreup.odd_actor_user'), 'role', 'authenticated', 'is_anonymous', true)::text, true);
set local role authenticated;
select throws_ok(
  format('select public.challenge_point_card(%L, %L, %L)', current_setting('scoreup.odd_room_id')::uuid, current_setting('scoreup.tie_target_id')::uuid, '42000000-0000-4000-8000-000000000003'::uuid),
  'P0001', 'INVALID_TARGET', 'cross-room challenge target is rejected'
);
reset role;
update public.round_cards_private set resolution_status = 'resolved', resolution_type = 'lock_in', points_awarded = current_value, resolved_at = statement_timestamp() where room_id = current_setting('scoreup.odd_room_id')::uuid and player_id = current_setting('scoreup.odd_target_id')::uuid;
set local role authenticated;
select throws_ok(
  format('select public.challenge_point_card(%L, %L, %L)', current_setting('scoreup.odd_room_id')::uuid, current_setting('scoreup.odd_target_id')::uuid, '42000000-0000-4000-8000-000000000004'::uuid),
  'P0001', 'TARGET_RESOLVED', 'resolved target cannot be challenged again'
);
reset role;
update public.round_cards_private set resolution_status = 'unresolved', resolution_type = null, points_awarded = 0, resolved_at = null where room_id = current_setting('scoreup.odd_room_id')::uuid and player_id = current_setting('scoreup.odd_target_id')::uuid;
update public.rooms set current_phase = 'round_summary' where id = current_setting('scoreup.odd_room_id')::uuid;
set local role authenticated;
select throws_ok(
  format('select public.lock_in_point_card(%L, %L)', current_setting('scoreup.odd_room_id')::uuid, '42000000-0000-4000-8000-000000000005'::uuid),
  'P0001', 'WRONG_PHASE', 'point action is rejected in the wrong phase'
);
reset role;
update public.rooms set current_phase = 'point_decisions' where id = current_setting('scoreup.odd_room_id')::uuid;
set local role authenticated;
select throws_ok(
  format('select public.process_expired_turn(%L, %L, %L)', current_setting('scoreup.odd_room_id')::uuid, current_setting('scoreup.odd_actor_id')::uuid, '42000000-0000-4000-8000-000000000006'::uuid),
  'P0001', 'DEADLINE_NOT_EXPIRED', 'server refuses premature timeout processing'
);
reset role;
update public.round_cards_private set original_value = 0, current_value = 0 where room_id = current_setting('scoreup.odd_room_id')::uuid and player_id = current_setting('scoreup.odd_actor_id')::uuid;
set local role authenticated;
select lives_ok(
  format('select public.lock_in_point_card(%L, %L)', current_setting('scoreup.odd_room_id')::uuid, '42000000-0000-4000-8000-000000000007'::uuid),
  'zero-value card can Lock In'
);
select lives_ok(
  format('select public.lock_in_point_card(%L, %L)', current_setting('scoreup.odd_room_id')::uuid, '42000000-0000-4000-8000-000000000007'::uuid),
  'duplicate zero-value Lock In is idempotent'
);
reset role;
select is((select score from public.players where id = current_setting('scoreup.odd_actor_id')::uuid), 0::bigint, 'zero-value Lock In never creates negative points');
select is((select count(*) from public.point_decisions where room_id = current_setting('scoreup.odd_room_id')::uuid and acting_player_id = current_setting('scoreup.odd_actor_id')::uuid), 1::bigint, 'duplicate Lock In creates one decision');

select set_config('request.jwt.claim.sub', current_setting('scoreup.odd_actor_user'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('scoreup.odd_actor_user'), 'role', 'authenticated', 'is_anonymous', true)::text, true);
set local role authenticated;
select lives_ok(format('select public.get_match_snapshot(%L)', current_setting('scoreup.odd_room_id')::uuid), 'reconnecting participant restores an authoritative snapshot');
reset role;
select is((select count(*) from public.round_cards_private where room_id = current_setting('scoreup.odd_room_id')::uuid), 3::bigint, 'reconnection creates no duplicate card');
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000008', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000008","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select throws_ok(
  format('select public.get_match_snapshot(%L)', current_setting('scoreup.odd_room_id')::uuid),
  'P0001', 'NOT_MATCH_PARTICIPANT', 'non-participant cannot fetch the match snapshot'
);
reset role;
select ok(not exists (
  select 1 from public.game_events
  where room_id = current_setting('scoreup.odd_room_id')::uuid
    and (public_payload ? 'actorCardValue' or public_payload ? 'targetCardValue')
), 'public events never reveal unresolved card values');
select ok(not exists (select 1 from public.players where room_id = current_setting('scoreup.odd_room_id')::uuid and score < 0), 'scores remain non-negative');

select * from finish();
rollback;
