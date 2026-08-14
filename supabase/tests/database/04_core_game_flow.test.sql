begin;
set local search_path = public, extensions;

select plan(48);

create function pg_temp.complete_action_phase(p_room_id uuid)
returns void
language plpgsql
as $$
declare
  v_round public.rounds%rowtype;
begin
  select * into strict v_round from public.rounds
  where room_id = p_room_id and status = 'active';
  insert into public.action_choices (
    id, round_id, room_id, round_number, player_id, choice, idempotency_key
  )
  select gen_random_uuid(), v_round.id, p_room_id, v_round.round_number,
    p.id, 'skip', gen_random_uuid()
  from public.players p
  where p.room_id = p_room_id and p.match_participant and p.left_at is null
  on conflict (round_id, player_id) do nothing;
  perform private.maybe_complete_action_phase(p_room_id, v_round.id);
end;
$$;

insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at)
select
  ('30000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', true, now(), now()
from generate_series(1, 10) value;

-- Four-player room used for initialization, privacy, challenge, timeout, and next-round tests.
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(
  $$ select public.create_room('Host One', 4, 6, 20, null, '31000000-0000-4000-8000-000000000001') $$,
  'host creates the core-game test room'
);
reset role;
select set_config('scoreup.core_room_id', (select id::text from public.rooms where created_by_user_id = '30000000-0000-4000-8000-000000000001'), true);
select set_config('scoreup.core_room_code', (select room_code from public.rooms where id = current_setting('scoreup.core_room_id')::uuid), true);

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(format('select public.join_room(%L, %L, null)', current_setting('scoreup.core_room_code'), 'Player Two'), 'player two joins');
select lives_ok(format('select public.set_ready_state(%L, true)', current_setting('scoreup.core_room_id')::uuid), 'player two readies');
reset role;

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(format('select public.join_room(%L, %L, null)', current_setting('scoreup.core_room_code'), 'Player Three'), 'player three joins');
select lives_ok(format('select public.set_ready_state(%L, true)', current_setting('scoreup.core_room_id')::uuid), 'player three readies');
reset role;

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000004","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(format('select public.join_room(%L, %L, null)', current_setting('scoreup.core_room_code'), 'Player Four'), 'player four joins');
select lives_ok(format('select public.set_ready_state(%L, true)', current_setting('scoreup.core_room_id')::uuid), 'player four readies');
reset role;

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(format('select public.start_room(%L)', current_setting('scoreup.core_room_id')::uuid), 'host atomically initializes the match');
select lives_ok(format('select public.start_room(%L)', current_setting('scoreup.core_room_id')::uuid), 'duplicate host start safely returns the existing match');
reset role;

select is((select status from public.rooms where id = current_setting('scoreup.core_room_id')::uuid), 'in_progress'::public.room_status, 'match enters in-progress status');
select is((select current_round from public.rooms where id = current_setting('scoreup.core_room_id')::uuid), 1::smallint, 'match starts at round one');
select is((select current_phase from public.rooms where id = current_setting('scoreup.core_room_id')::uuid), 'action_choice'::public.game_phase, 'dealing atomically reaches action choice');
select is((select count(*) from public.players where room_id = current_setting('scoreup.core_room_id')::uuid and match_participant), 4::bigint, 'the connected roster is frozen');
select is((select count(*) from public.rounds where room_id = current_setting('scoreup.core_room_id')::uuid), 1::bigint, 'duplicate start creates only one round');
select is((select count(*) from public.round_cards_private where room_id = current_setting('scoreup.core_room_id')::uuid), 4::bigint, 'one private card is dealt per participant');
select ok(not exists (
  select 1 from public.round_cards_private
  where room_id = current_setting('scoreup.core_room_id')::uuid
    and original_value not in (0, 100, 250, 500, 750, 1000)
), 'every generated card uses an allowed deck value');
select pg_temp.complete_action_phase(current_setting('scoreup.core_room_id')::uuid);
select is((
  select count(distinct player_id) from unnest((select decision_order from public.rounds where room_id = current_setting('scoreup.core_room_id')::uuid)) player_id
), 4::bigint, 'secure decision order contains every participant exactly once');
select is((select min(action_draw_allowance) from public.players where room_id = current_setting('scoreup.core_room_id')::uuid and match_participant), 2::smallint, 'six-round matches calculate two future action draws');
select is((select max(score) from public.players where room_id = current_setting('scoreup.core_room_id')::uuid), 0::bigint, 'all match scores start at zero');
select throws_ok(
  format('select public.leave_room(%L)', current_setting('scoreup.core_room_id')::uuid),
  'P0001', 'ROOM_STARTED', 'a participant cannot mutate the frozen roster by leaving mid-match'
);

-- RLS permits only the caller's unresolved card and no direct protected writes.
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select is((select count(id) from public.round_cards_private where room_id = current_setting('scoreup.core_room_id')::uuid), 1::bigint, 'a participant reads only their unresolved private card');
select ok(not (public.get_match_snapshot(current_setting('scoreup.core_room_id')::uuid)->'players'->0) ? 'currentValue', 'public player state contains no private card value');
select is(jsonb_array_length(public.get_match_snapshot(current_setting('scoreup.core_room_id')::uuid)->'roundSummaries'), 0, 'active-round snapshot contains no public card summary');
select throws_ok(
  format('update public.players set score = 999999 where room_id = %L', current_setting('scoreup.core_room_id')::uuid),
  '42501', null, 'clients cannot modify scores directly'
);
select throws_ok(
  format('update public.round_cards_private set current_value = 1000 where room_id = %L', current_setting('scoreup.core_room_id')::uuid),
  '42501', null, 'clients cannot modify cards directly'
);
reset role;

-- Select identities from the randomized order for wrong-turn and deterministic challenge checks.
select set_config('scoreup.actor_player_id', (select current_turn_player_id::text from public.rooms where id = current_setting('scoreup.core_room_id')::uuid), true);
select set_config('scoreup.actor_user_id', (select auth_user_id::text from public.players where id = current_setting('scoreup.actor_player_id')::uuid), true);
select set_config('scoreup.other_user_id', (select auth_user_id::text from public.players where room_id = current_setting('scoreup.core_room_id')::uuid and id <> current_setting('scoreup.actor_player_id')::uuid order by join_order limit 1), true);
select set_config('scoreup.target_player_id', (select id::text from public.players where room_id = current_setting('scoreup.core_room_id')::uuid and id <> current_setting('scoreup.actor_player_id')::uuid order by join_order limit 1), true);
update public.round_cards_private set original_value = 750, current_value = 750 where room_id = current_setting('scoreup.core_room_id')::uuid and player_id = current_setting('scoreup.actor_player_id')::uuid;
update public.round_cards_private set original_value = 250, current_value = 250 where room_id = current_setting('scoreup.core_room_id')::uuid and player_id = current_setting('scoreup.target_player_id')::uuid;

select set_config('request.jwt.claim.sub', current_setting('scoreup.other_user_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('scoreup.other_user_id'), 'role', 'authenticated', 'is_anonymous', true)::text, true);
set local role authenticated;
select throws_ok(
  format('select public.lock_in_point_card(%L, %L)', current_setting('scoreup.core_room_id')::uuid, '32000000-0000-4000-8000-000000000001'::uuid),
  'P0001', 'WRONG_TURN', 'a non-active player cannot act'
);
reset role;

select set_config('request.jwt.claim.sub', current_setting('scoreup.actor_user_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('scoreup.actor_user_id'), 'role', 'authenticated', 'is_anonymous', true)::text, true);
set local role authenticated;
select throws_ok(
  format('select public.challenge_point_card(%L, %L, %L)', current_setting('scoreup.core_room_id')::uuid, current_setting('scoreup.actor_player_id')::uuid, '32000000-0000-4000-8000-000000000002'::uuid),
  'P0001', 'SELF_CHALLENGE', 'a player cannot challenge themselves'
);
select lives_ok(
  format('select public.challenge_point_card(%L, %L, %L)', current_setting('scoreup.core_room_id')::uuid, current_setting('scoreup.target_player_id')::uuid, '32000000-0000-4000-8000-000000000003'::uuid),
  'the active player can challenge an unresolved opponent'
);
select lives_ok(
  format('select public.challenge_point_card(%L, %L, %L)', current_setting('scoreup.core_room_id')::uuid, current_setting('scoreup.target_player_id')::uuid, '32000000-0000-4000-8000-000000000003'::uuid),
  'replaying the same challenge request is idempotent'
);
reset role;
select is((select score from public.players where id = current_setting('scoreup.actor_player_id')::uuid), 1000::bigint, 'challenge winner receives both card values exactly once');
select is((select score from public.players where id = current_setting('scoreup.target_player_id')::uuid), 0::bigint, 'challenge loser receives zero points');
select is((select count(*) from public.point_decisions where room_id = current_setting('scoreup.core_room_id')::uuid and idempotency_key = '32000000-0000-4000-8000-000000000003'), 1::bigint, 'duplicate challenge produces one decision');
select ok((select public_payload ? 'actorCardValue' from public.game_events where room_id = current_setting('scoreup.core_room_id')::uuid and event_type = 'challenge_resolved' order by sequence desc limit 1), 'resolved challenge event may reveal both participating cards');

-- Locking the next of two unresolved players automatically locks the final player.
select set_config('scoreup.lock_player_id', (select current_turn_player_id::text from public.rooms where id = current_setting('scoreup.core_room_id')::uuid), true);
select set_config('scoreup.lock_user_id', (select auth_user_id::text from public.players where id = current_setting('scoreup.lock_player_id')::uuid), true);
select set_config('request.jwt.claim.sub', current_setting('scoreup.lock_user_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('scoreup.lock_user_id'), 'role', 'authenticated', 'is_anonymous', true)::text, true);
set local role authenticated;
select lives_ok(
  format('select public.lock_in_point_card(%L, %L)', current_setting('scoreup.core_room_id')::uuid, '32000000-0000-4000-8000-000000000004'::uuid),
  'active player locks in through the authoritative RPC'
);
select lives_ok(
  format('select public.lock_in_point_card(%L, %L)', current_setting('scoreup.core_room_id')::uuid, '32000000-0000-4000-8000-000000000004'::uuid),
  'duplicate Lock In returns safely without another award'
);
reset role;
select is((select count(*) from public.round_cards_private where room_id = current_setting('scoreup.core_room_id')::uuid and resolution_status = 'unresolved'), 0::bigint, 'final unresolved player is automatically locked in');
select is((select status from public.rounds where room_id = current_setting('scoreup.core_room_id')::uuid and round_number = 1), 'completed'::public.round_status, 'round completes when every card is resolved');
select is((select current_phase from public.rooms where id = current_setting('scoreup.core_room_id')::uuid), 'round_summary'::public.game_phase, 'completed non-final round enters summary phase');
select is((select count(*) from public.score_ledger where room_id = current_setting('scoreup.core_room_id')::uuid), 4::bigint, 'every participant has exactly one score-ledger award');

-- Authorized summary advance creates a fresh round and distinct secure order.
select set_config('scoreup.round_one_order', (select decision_order::text from public.rounds where room_id = current_setting('scoreup.core_room_id')::uuid and round_number = 1), true);
update public.rooms set phase_deadline = statement_timestamp() - interval '1 second' where id = current_setting('scoreup.core_room_id')::uuid;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(
  format('select public.advance_round_summary(%L, %L)', current_setting('scoreup.core_room_id')::uuid, '32000000-0000-4000-8000-000000000005'::uuid),
  'an authorized participant advances an expired summary'
);
select lives_ok(
  format('select public.advance_round_summary(%L, %L)', current_setting('scoreup.core_room_id')::uuid, '32000000-0000-4000-8000-000000000005'::uuid),
  'replaying a round advance safely returns the current round'
);
reset role;
select pg_temp.complete_action_phase(current_setting('scoreup.core_room_id')::uuid);
select is((select current_round from public.rooms where id = current_setting('scoreup.core_room_id')::uuid), 2::smallint, 'next round initializes exactly once');
select isnt((select decision_order::text from public.rounds where room_id = current_setting('scoreup.core_room_id')::uuid and round_number = 2), current_setting('scoreup.round_one_order'), 'the next round receives a new order');
select is((select count(*) from public.round_cards_private where room_id = current_setting('scoreup.core_room_id')::uuid and round_number = 2), 4::bigint, 'next round deals one new card per participant');

-- Expired turns are participant-triggered, idempotent, and use server time.
select set_config('scoreup.timeout_player_id', (select current_turn_player_id::text from public.rooms where id = current_setting('scoreup.core_room_id')::uuid), true);
update public.rooms set phase_deadline = statement_timestamp() - interval '1 second' where id = current_setting('scoreup.core_room_id')::uuid;
update public.rounds set phase_deadline = statement_timestamp() - interval '1 second', turn_deadline = statement_timestamp() - interval '1 second' where room_id = current_setting('scoreup.core_room_id')::uuid and round_number = 2;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(
  format('select public.process_expired_turn(%L, %L, %L)', current_setting('scoreup.core_room_id')::uuid, current_setting('scoreup.timeout_player_id')::uuid, '32000000-0000-4000-8000-000000000006'::uuid),
  'any participant can process the expired active turn'
);
select lives_ok(
  format('select public.process_expired_turn(%L, %L, %L)', current_setting('scoreup.core_room_id')::uuid, current_setting('scoreup.timeout_player_id')::uuid, '32000000-0000-4000-8000-000000000007'::uuid),
  'a concurrent-style timeout replay safely observes the resolved turn'
);
reset role;
select is((select count(*) from public.point_decisions where room_id = current_setting('scoreup.core_room_id')::uuid and round_number = 2 and decision_type = 'timeout'), 1::bigint, 'timeout processing creates one decision and award');
select is((select timeouts_count from public.players where id = current_setting('scoreup.timeout_player_id')::uuid), 1, 'timed-out player records one timeout');

select * from finish();
rollback;
