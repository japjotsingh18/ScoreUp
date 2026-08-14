begin;
set local search_path = public, extensions;

select plan(26);

insert into auth.users(id,aud,role,is_anonymous,created_at,updated_at)
select ('90000000-0000-4000-8000-' || lpad(value::text,12,'0'))::uuid,
  'authenticated','authenticated',true,now(),now() from generate_series(1,5) value;

create function pg_temp.claim(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_user,'role','authenticated','is_anonymous',true)::text, true);
end; $$;

create function pg_temp.make_four_player_room() returns uuid language plpgsql as $$
declare v_room uuid; v_code text;
begin
  perform pg_temp.claim('90000000-0000-4000-8000-000000000001'); set local role authenticated;
  perform public.create_room('Queue One',4,6,20,null,'91000000-0000-4000-8000-000000000001'); reset role;
  select id,room_code into strict v_room,v_code from public.rooms where created_by_user_id='90000000-0000-4000-8000-000000000001';
  for v_i in 2..4 loop
    perform pg_temp.claim(('90000000-0000-4000-8000-' || lpad(v_i::text,12,'0'))::uuid); set local role authenticated;
    perform public.join_room(v_code,'Queue '||v_i,null); perform public.set_ready_state(v_room,true); reset role;
  end loop;
  perform pg_temp.claim('90000000-0000-4000-8000-000000000001'); set local role authenticated;
  perform public.start_room(v_room); reset role;
  return v_room;
end; $$;

create function pg_temp.enter_points(p_room uuid) returns void language plpgsql as $$
declare v_round public.rounds%rowtype;
begin
  select * into strict v_round from public.rounds where room_id=p_room and status='active';
  insert into public.action_choices(round_id,room_id,round_number,player_id,choice,idempotency_key)
  select v_round.id,p_room,v_round.round_number,p.id,'skip',gen_random_uuid()
  from public.players p where p.room_id=p_room and p.match_participant;
  perform private.maybe_complete_action_phase(p_room,v_round.id);
end; $$;

create function pg_temp.finish_points(p_room uuid) returns void language plpgsql as $$
declare v_round uuid;
begin
  select id into strict v_round from public.rounds where room_id=p_room and status='active';
  update public.round_cards_private set resolution_status='resolved',resolution_type='lock_in',
    points_awarded=current_value,resolved_at=statement_timestamp() where round_id=v_round;
  perform private.finish_round_or_advance_turn(p_room,v_round);
end; $$;

select set_config('scoreup.queue_room',pg_temp.make_four_player_room()::text,true);
select pg_temp.enter_points(current_setting('scoreup.queue_room')::uuid);
update public.players set score=1000 where room_id=current_setting('scoreup.queue_room')::uuid;
select set_config('scoreup.qp1',(select id::text from public.players where room_id=current_setting('scoreup.queue_room')::uuid order by join_order limit 1),true);
select set_config('scoreup.qp2',(select id::text from public.players where room_id=current_setting('scoreup.queue_room')::uuid order by join_order offset 1 limit 1),true);
select set_config('scoreup.qp3',(select id::text from public.players where room_id=current_setting('scoreup.queue_room')::uuid order by join_order offset 2 limit 1),true);
select set_config('scoreup.qp4',(select id::text from public.players where room_id=current_setting('scoreup.queue_room')::uuid order by join_order offset 3 limit 1),true);

select pg_temp.claim('90000000-0000-4000-8000-000000000001'); set local role authenticated;
select lives_ok(format('select public.request_mini_game_challenge(%L,%L,''half'',%L)',current_setting('scoreup.queue_room')::uuid,current_setting('scoreup.qp2')::uuid,'92000000-0000-4000-8000-000000000001'::uuid),'first disjoint challenge queues');
select throws_ok(format('select public.request_mini_game_challenge(%L,%L,''half'',%L)',current_setting('scoreup.queue_room')::uuid,current_setting('scoreup.qp3')::uuid,'92000000-0000-4000-8000-000000000002'::uuid),'P0001','MINI_GAME_PARTICIPANT_BUSY','a queued participant cannot enter another challenge'); reset role;
select pg_temp.claim('90000000-0000-4000-8000-000000000003'); set local role authenticated;
select lives_ok(format('select public.request_mini_game_challenge(%L,%L,''all'',%L)',current_setting('scoreup.queue_room')::uuid,current_setting('scoreup.qp4')::uuid,'92000000-0000-4000-8000-000000000003'::uuid),'second disjoint challenge queues');
reset role;
select is((select count(*) from public.mini_game_challenges where room_id=current_setting('scoreup.queue_room')::uuid),2::bigint,'two disjoint challenges coexist in the queue');
select is((select max(queue_position)-min(queue_position) from public.mini_game_challenges where room_id=current_setting('scoreup.queue_room')::uuid),1::bigint,'queue positions preserve FIFO order');
select pg_temp.claim('90000000-0000-4000-8000-000000000003'); set local role authenticated;
select is((select count(*) from public.mini_game_challenges where challenger_player_id=current_setting('scoreup.qp1')::uuid),0::bigint,'RLS hides another matchup from a nonparticipant');
select throws_ok('select count(*) from private.mini_game_specs','42501',null,'raw seeds and expected answers are inaccessible'); reset role;

select pg_temp.claim('90000000-0000-4000-8000-000000000005'); set local role authenticated;
select throws_ok(format('select public.get_mini_game_snapshot(%L)',current_setting('scoreup.queue_room')::uuid),'P0001','NOT_MATCH_PARTICIPANT','cross-room outsider cannot obtain a Mini-Game snapshot'); reset role;

select set_config('scoreup.test_mini_game_type','stop_bar',true);
select pg_temp.finish_points(current_setting('scoreup.queue_room')::uuid);
select set_config('scoreup.qc1',(select id::text from public.mini_game_challenges where room_id=current_setting('scoreup.queue_room')::uuid order by queue_position limit 1),true);
select set_config('scoreup.qc2',(select id::text from public.mini_game_challenges where room_id=current_setting('scoreup.queue_room')::uuid order by queue_position offset 1 limit 1),true);
select ok((select queue_position from public.mini_game_challenges where status='active' and room_id=current_setting('scoreup.queue_room')::uuid)=(select min(queue_position) from public.mini_game_challenges where room_id=current_setting('scoreup.queue_room')::uuid),'the FIFO head starts first');
select is((select count(*) from public.mini_game_challenges where status in ('active','tiebreaker_active') and room_id=current_setting('scoreup.queue_room')::uuid),1::bigint,'only one challenge is active per room');
select is((select status from public.mini_game_challenges where id=current_setting('scoreup.qc2')::uuid),'queued'::public.mini_game_challenge_status,'second FIFO item remains queued');

select pg_temp.claim('90000000-0000-4000-8000-000000000001'); set local role authenticated;
select throws_ok(format('select public.submit_mini_game_result(%L,%L,''{"position":0.5,"elapsedMs":500}''::jsonb,%L)',current_setting('scoreup.queue_room')::uuid,current_setting('scoreup.qc1')::uuid,'92000000-0000-4000-8000-000000000004'::uuid),'P0001','MINI_GAME_NOT_STARTED','submissions before synchronized start are rejected'); reset role;
update public.mini_game_challenges set starts_at=statement_timestamp()-interval '1 second',submission_deadline=statement_timestamp()+interval '30 seconds' where id=current_setting('scoreup.qc1')::uuid;

select pg_temp.claim('90000000-0000-4000-8000-000000000003'); set local role authenticated;
select throws_ok(format('select public.submit_mini_game_result(%L,%L,''{"position":0.5,"elapsedMs":500}''::jsonb,%L)',current_setting('scoreup.queue_room')::uuid,current_setting('scoreup.qc1')::uuid,'92000000-0000-4000-8000-000000000005'::uuid),'P0001','NOT_MINI_GAME_PARTICIPANT','nonparticipant cannot submit to another matchup'); reset role;

select pg_temp.claim('90000000-0000-4000-8000-000000000001'); set local role authenticated;
select lives_ok(format('select public.submit_mini_game_result(%L,%L,''{"elapsedMs":"bad"}''::jsonb,%L)',current_setting('scoreup.queue_room')::uuid,current_setting('scoreup.qc1')::uuid,'92000000-0000-4000-8000-000000000006'::uuid),'malformed compact result is safely recorded as rejected');
select is((select validation_status from public.mini_game_submissions where challenge_id=current_setting('scoreup.qc1')::uuid and player_id=current_setting('scoreup.qp1')::uuid),'rejected'::public.mini_game_validation_status,'malformed result never becomes an accepted score');
select lives_ok(format('select public.submit_mini_game_result(%L,%L,''{"elapsedMs":"bad"}''::jsonb,%L)',current_setting('scoreup.queue_room')::uuid,current_setting('scoreup.qc1')::uuid,'92000000-0000-4000-8000-000000000006'::uuid),'identical replay key is idempotent');
select throws_ok(format('select public.submit_mini_game_result(%L,%L,''{"position":0.5,"elapsedMs":500}''::jsonb,%L)',current_setting('scoreup.queue_room')::uuid,current_setting('scoreup.qc1')::uuid,'92000000-0000-4000-8000-000000000007'::uuid),'P0001','MINI_GAME_ALREADY_SUBMITTED','second submission with a new key is rejected'); reset role;

select pg_temp.claim('90000000-0000-4000-8000-000000000002'); set local role authenticated;
select lives_ok(format('select public.submit_mini_game_result(%L,%L,''{"position":0.5,"elapsedMs":500}''::jsonb,%L)',current_setting('scoreup.queue_room')::uuid,current_setting('scoreup.qc1')::uuid,'92000000-0000-4000-8000-000000000008'::uuid),'valid opponent result resolves against an invalid submission'); reset role;
select is((select resolution_method from public.mini_game_challenges where id=current_setting('scoreup.qc1')::uuid),'opponent_invalid'::public.mini_game_resolution_method,'accepted result defeats invalid opponent result');
select is((select status from public.mini_game_challenges where id=current_setting('scoreup.qc2')::uuid),'active'::public.mini_game_challenge_status,'second FIFO item starts automatically after settlement');
select is((select count(*) from public.mini_game_challenges where status in ('active','tiebreaker_active') and room_id=current_setting('scoreup.queue_room')::uuid),1::bigint,'automatic queue advancement still preserves one active challenge');
select ok(not exists(select 1 from public.game_events where room_id=current_setting('scoreup.queue_room')::uuid and public_payload ?| array['resultPayload','normalizedResult','seed']),'public events never expose submissions, normalized results, or seeds');

update public.mini_game_challenges set starts_at=statement_timestamp()-interval '40 seconds',submission_deadline=statement_timestamp()-interval '1 second' where id=current_setting('scoreup.qc2')::uuid;
select pg_temp.claim('90000000-0000-4000-8000-000000000003'); set local role authenticated;
select throws_ok(format('select public.submit_mini_game_result(%L,%L,''{"position":0.5,"elapsedMs":500}''::jsonb,%L)',current_setting('scoreup.queue_room')::uuid,current_setting('scoreup.qc2')::uuid,'92000000-0000-4000-8000-000000000009'::uuid),'P0001','MINI_GAME_DEADLINE_EXPIRED','late result is rejected');
select lives_ok(format('select public.process_expired_mini_game(%L,%L)',current_setting('scoreup.queue_room')::uuid,'92000000-0000-4000-8000-000000000010'::uuid),'participant processes the expired FIFO tail'); reset role;
select is((select current_phase from public.rooms where id=current_setting('scoreup.queue_room')::uuid),'round_summary'::public.game_phase,'queue completion advances exactly once to round summary');
select is((select count(*) from private.mini_game_participant_locks where room_id=current_setting('scoreup.queue_room')::uuid),0::bigint,'all participant locks are released after settlement');

select * from finish();
rollback;
