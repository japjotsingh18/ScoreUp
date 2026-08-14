begin;
set local search_path = public, extensions;

select plan(34);

insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', true, now(), now()),
  ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', true, now(), now()),
  ('10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', true, now(), now()),
  ('10000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', true, now(), now());

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;

select lives_ok(
  $$ select public.create_room('Maya', 3, 8, 30, 'correct horse', '20000000-0000-4000-8000-000000000001') $$,
  'an anonymous user can atomically create a room'
);
select lives_ok(
  $$ select public.create_room('Maya', 3, 8, 30, 'correct horse', '20000000-0000-4000-8000-000000000001') $$,
  'repeating a create request is idempotent'
);

reset role;
select is((select count(*) from public.rooms where creation_request_id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'idempotent create produces one room');
select matches((select room_code from public.rooms limit 1), '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$', 'room code is human-readable and normalized');
select isnt((select password_hash from public.rooms limit 1), 'correct horse', 'plaintext passwords are never stored');
select matches((select password_hash from public.rooms limit 1), '^\$2', 'password uses a bcrypt-compatible pgcrypto hash');
select ok((select (private.build_lobby_snapshot(id, '10000000-0000-4000-8000-000000000001')->'room') ? 'hasPassword' from public.rooms limit 1), 'snapshot exposes only a password-required flag');
select ok(not (select (private.build_lobby_snapshot(id, '10000000-0000-4000-8000-000000000001')->'room') ? 'passwordHash' from public.rooms limit 1), 'snapshot never exposes a password hash');

select set_config('scoreup.test_room_id', (select id::text from public.rooms limit 1), true);
select set_config('scoreup.test_room_code', (select room_code from public.rooms limit 1), true);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;

select throws_ok(
  format('select public.join_room(%L, %L, %L)', current_setting('scoreup.test_room_code'), 'Jordan', 'wrong password'),
  'P0001', 'ROOM_ACCESS_DENIED', 'incorrect password is rejected generically'
);
select lives_ok(
  format('select public.join_room(%L, %L, %L)', current_setting('scoreup.test_room_code'), 'Jordan', 'correct horse'),
  'a second anonymous user can join a valid room'
);
select lives_ok(
  format('select public.join_room(%L, %L, %L)', current_setting('scoreup.test_room_code'), 'Ignored Name', null),
  'the same authenticated user reconnects without another password or seat'
);

reset role;
select is((select count(*) from public.players where room_id = current_setting('scoreup.test_room_id')::uuid), 2::bigint, 'reconnect does not create a duplicate player');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select throws_ok(
  format('select public.join_room(%L, %L, %L)', current_setting('scoreup.test_room_code'), 'jOrDaN', 'correct horse'),
  'P0001', 'DUPLICATE_NAME', 'display names are unique regardless of capitalization'
);
select lives_ok(
  format('select public.join_room(%L, %L, %L)', current_setting('scoreup.test_room_code'), 'Avery', 'correct horse'),
  'a third distinct player can join within capacity'
);
select throws_ok(
  format('select public.start_room(%L)', current_setting('scoreup.test_room_id')::uuid),
  'P0001', 'HOST_ONLY', 'a non-host cannot start the room'
);
select throws_ok(
  format('select public.remove_lobby_player(%L, %L)', current_setting('scoreup.test_room_id')::uuid, (select id from public.players where is_host)),
  'P0001', 'HOST_ONLY', 'a non-host cannot remove another player'
);
select throws_ok(
  format('update public.players set ready = true where room_id = %L', current_setting('scoreup.test_room_id')::uuid),
  '42501', null, 'direct player updates are denied'
);
select throws_ok(
  format('update public.rooms set max_players = 10 where id = %L', current_setting('scoreup.test_room_id')::uuid),
  '42501', null, 'protected room settings cannot be changed directly'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","is_anonymous":true}', true);
select throws_ok(
  $$ select public.join_room('ZZZZZ', 'No Room', null) $$,
  'P0001', 'ROOM_NOT_FOUND', 'joining an invalid room is rejected'
);
select throws_ok(
  format('select public.join_room(%L, %L, %L)', current_setting('scoreup.test_room_code'), 'Taylor', 'correct horse'),
  'P0001', 'ROOM_FULL', 'room capacity cannot be bypassed'
);
select is((select count(id) from public.rooms), 0::bigint, 'an unrelated user cannot read a room');
select throws_ok(
  'select password_hash from public.rooms',
  '42501', null, 'password columns cannot be selected by authenticated clients'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
select throws_ok(
  format('select public.start_room(%L)', current_setting('scoreup.test_room_id')::uuid),
  'P0001', 'PLAYERS_NOT_READY', 'host start is rejected while a connected player is not ready'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":true}', true);
select lives_ok(format('select public.set_ready_state(%L, true)', current_setting('scoreup.test_room_id')::uuid), 'a player can update only their own ready state');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}', true);
select lives_ok(format('select public.set_ready_state(%L, true)', current_setting('scoreup.test_room_id')::uuid), 'another player can independently ready up');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
select lives_ok(format('select public.start_room(%L)', current_setting('scoreup.test_room_id')::uuid), 'host can lock a room when all connected players are ready');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","is_anonymous":true}', true);
select throws_ok(
  format('select public.join_room(%L, %L, %L)', current_setting('scoreup.test_room_code'), 'Avery', 'correct horse'),
  'P0001', 'ROOM_STARTED', 'new players cannot join a started room'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}', true);
select lives_ok(
  $$ select public.create_room('Solo', 6, 6, 20, null, '20000000-0000-4000-8000-000000000002') $$,
  'another user can create an independent room'
);
select set_config(
  'scoreup.solo_room_id',
  (select id::text from public.rooms where room_code <> current_setting('scoreup.test_room_code')),
  true
);
select set_config(
  'scoreup.solo_room_code',
  (select room_code from public.rooms where room_code <> current_setting('scoreup.test_room_code')),
  true
);
select throws_ok(
  format('select public.start_room(%L)', current_setting('scoreup.solo_room_id')::uuid),
  'P0001', 'MINIMUM_PLAYERS', 'start is rejected with fewer than two connected players'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","is_anonymous":true}', true);
select lives_ok(
  format('select public.join_room(%L, %L, null)', current_setting('scoreup.solo_room_code'), 'Removable'),
  'another user can join the independent room'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}', true);
select lives_ok(
  format(
    'select public.remove_lobby_player(%L, %L)',
    current_setting('scoreup.solo_room_id')::uuid,
    (select id from public.players where room_id = current_setting('scoreup.solo_room_id')::uuid and not is_host)
  ),
  'the host can remove another lobby player'
);

reset role;
select is((select count(distinct room_code) from public.rooms), (select count(*) from public.rooms), 'separately created rooms have unique codes');

-- Host transfer is activity-triggered: the oldest disconnected host is replaced by the earliest connected seat.
update public.rooms set status = 'lobby', started_at = null where id = current_setting('scoreup.test_room_id')::uuid;
update public.players
set connected = false, disconnected_at = now() - interval '61 seconds'
where room_id = current_setting('scoreup.test_room_id')::uuid and auth_user_id = '10000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select lives_ok(format('select public.heartbeat_room(%L)', current_setting('scoreup.test_room_id')::uuid), 'authorized activity safely runs host maintenance');
reset role;
select is((select auth_user_id from public.players where room_id = current_setting('scoreup.test_room_id')::uuid and is_host), '10000000-0000-4000-8000-000000000002'::uuid, 'host transfers after the 60-second grace period');

select * from finish();
rollback;
