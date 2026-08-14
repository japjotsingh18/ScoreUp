begin;
set local search_path = public, extensions;

select plan(26);

insert into auth.users(id,aud,role,is_anonymous,created_at,updated_at)
select ('a0000000-0000-4000-8000-' || lpad(value::text,12,'0'))::uuid,
  'authenticated','authenticated',true,now(),now() from generate_series(1,6) value;

create function pg_temp.claim(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',p_user::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated','is_anonymous',true)::text,true);
end; $$;

create function pg_temp.make_room(p_host uuid,p_guest uuid,p_name text,p_key uuid)
returns uuid language plpgsql as $$
declare v_room uuid; v_code text;
begin
  perform pg_temp.claim(p_host); set local role authenticated;
  perform public.create_room(p_name,2,6,20,null,p_key); reset role;
  select id,room_code into strict v_room,v_code from public.rooms where created_by_user_id=p_host order by created_at desc limit 1;
  perform pg_temp.claim(p_guest); set local role authenticated;
  perform public.join_room(v_code,p_name||' Guest',null); perform public.set_ready_state(v_room,true); reset role;
  perform pg_temp.claim(p_host); set local role authenticated; perform public.start_room(v_room); reset role;
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

-- A positive score whose Half stake rounds to zero is cancelled at queue start.
select set_config('scoreup.edge_room1',pg_temp.make_room('a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002','Rounded','a1000000-0000-4000-8000-000000000001')::text,true);
select pg_temp.enter_points(current_setting('scoreup.edge_room1')::uuid);
select set_config('scoreup.edge_actor1',(select id::text from public.players where room_id=current_setting('scoreup.edge_room1')::uuid order by join_order limit 1),true);
select set_config('scoreup.edge_target1',(select id::text from public.players where room_id=current_setting('scoreup.edge_room1')::uuid order by join_order offset 1 limit 1),true);
update public.players set score=case when id=current_setting('scoreup.edge_actor1')::uuid then 75 else 100 end where room_id=current_setting('scoreup.edge_room1')::uuid;
select pg_temp.claim('a0000000-0000-4000-8000-000000000001'); set local role authenticated;
select lives_ok(format('select public.request_mini_game_challenge(%L,%L,''half'',%L)',current_setting('scoreup.edge_room1')::uuid,current_setting('scoreup.edge_target1')::uuid,'a2000000-0000-4000-8000-000000000001'::uuid),'positive-score Half request may queue before final stake calculation'); reset role;
select pg_temp.finish_points(current_setting('scoreup.edge_room1')::uuid);
select is((select status from public.mini_game_challenges where room_id=current_setting('scoreup.edge_room1')::uuid),'cancelled'::public.mini_game_challenge_status,'zero-rounded stake cancels at actual start');
select is((select cancellation_reason from public.mini_game_challenges where room_id=current_setting('scoreup.edge_room1')::uuid),'ZERO_STAKE','cancellation records the zero-stake reason');
select ok(not (select mini_game_token_used from public.players where id=current_setting('scoreup.edge_actor1')::uuid),'cancelled queued challenge does not consume the token');
select is((select array_agg(score order by join_order) from public.players where room_id=current_setting('scoreup.edge_room1')::uuid),array[75::bigint,100::bigint],'cancelled challenge never deducts scores');
select is((select count(*) from public.score_ledger where mini_game_challenge_id=(select id from public.mini_game_challenges where room_id=current_setting('scoreup.edge_room1')::uuid)),0::bigint,'cancelled unstarted challenge creates no ledger entries');
select is((select current_phase from public.rooms where id=current_setting('scoreup.edge_room1')::uuid),'round_summary'::public.game_phase,'cancelled queue passes safely to summary');
update public.rooms set status='completed',current_phase='completed' where id=current_setting('scoreup.edge_room1')::uuid;
select pg_temp.claim('a0000000-0000-4000-8000-000000000001'); set local role authenticated;
select throws_ok(format('select public.request_mini_game_challenge(%L,%L,''all'',%L)',current_setting('scoreup.edge_room1')::uuid,current_setting('scoreup.edge_target1')::uuid,'a2000000-0000-4000-8000-000000000002'::uuid),'P0001','WRONG_PHASE','final results reject new challenge requests'); reset role;

-- Locked escrow can only be refunded through the private transactional recovery path.
select set_config('scoreup.edge_room2',pg_temp.make_room('a0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000004','Refund','a1000000-0000-4000-8000-000000000002')::text,true);
select pg_temp.enter_points(current_setting('scoreup.edge_room2')::uuid);
select set_config('scoreup.edge_actor2',(select id::text from public.players where room_id=current_setting('scoreup.edge_room2')::uuid order by join_order limit 1),true);
select set_config('scoreup.edge_target2',(select id::text from public.players where room_id=current_setting('scoreup.edge_room2')::uuid order by join_order offset 1 limit 1),true);
update public.players set score=case when id=current_setting('scoreup.edge_actor2')::uuid then 1000 else 800 end where room_id=current_setting('scoreup.edge_room2')::uuid;
select set_config('scoreup.test_mini_game_type','stop_bar',true);
select pg_temp.claim('a0000000-0000-4000-8000-000000000003'); set local role authenticated;
select public.request_mini_game_challenge(current_setting('scoreup.edge_room2')::uuid,current_setting('scoreup.edge_target2')::uuid,'all','a2000000-0000-4000-8000-000000000003'); reset role;
select pg_temp.finish_points(current_setting('scoreup.edge_room2')::uuid);
select set_config('scoreup.edge_challenge2',(select id::text from public.mini_game_challenges where room_id=current_setting('scoreup.edge_room2')::uuid),true);
select is((select array_agg(score order by join_order) from public.players where room_id=current_setting('scoreup.edge_room2')::uuid),array[200::bigint,0::bigint],'Stake All deductions remain non-negative');
select pg_temp.claim('a0000000-0000-4000-8000-000000000003'); set local role authenticated;
select throws_ok(format('update public.mini_game_challenges set pot=999999 where id=%L',current_setting('scoreup.edge_challenge2')::uuid),'42501',null,'client cannot alter stake or escrow');
select throws_ok(format('update public.players set mini_game_token_used=false where id=%L',current_setting('scoreup.edge_actor2')::uuid),'42501',null,'client cannot restore its token directly');
select throws_ok('select private.select_mini_game_type()','42501',null,'authenticated clients cannot execute deterministic game selection controls'); reset role;
update public.mini_game_challenges set starts_at=statement_timestamp()-interval '1 second',submission_deadline=statement_timestamp()+interval '30 seconds' where id=current_setting('scoreup.edge_challenge2')::uuid;
select pg_temp.claim('a0000000-0000-4000-8000-000000000003'); set local role authenticated;
select lives_ok(format('select public.submit_mini_game_result(%L,%L,''{"position":0.5,"elapsedMs":50}''::jsonb,%L)',current_setting('scoreup.edge_room2')::uuid,current_setting('scoreup.edge_challenge2')::uuid,'a2000000-0000-4000-8000-000000000004'::uuid),'infeasible timing is recorded without trusting the client');
select is((select validation_status from public.mini_game_submissions where challenge_id=current_setting('scoreup.edge_challenge2')::uuid),'rejected'::public.mini_game_validation_status,'infeasible timing is rejected');
reset role; select pg_temp.claim('a0000000-0000-4000-8000-000000000004'); set local role authenticated;
select is((select count(*) from public.mini_game_submissions where challenge_id=current_setting('scoreup.edge_challenge2')::uuid),0::bigint,'opponent cannot read the other private submission'); reset role;
select lives_ok(format('select private.refund_mini_game_escrow(%L,%L)',current_setting('scoreup.edge_challenge2')::uuid,'SERVER_FAILURE'),'private recovery refunds a locked challenge');
select is((select status from public.mini_game_challenges where id=current_setting('scoreup.edge_challenge2')::uuid),'refunded'::public.mini_game_challenge_status,'refund reaches an auditable terminal state');
select is((select array_agg(score order by join_order) from public.players where room_id=current_setting('scoreup.edge_room2')::uuid),array[1000::bigint,800::bigint],'refund restores both exact pre-escrow balances');
select is((select count(*) from public.score_ledger where mini_game_challenge_id=current_setting('scoreup.edge_challenge2')::uuid),4::bigint,'refund ledger contains two deductions and two restores');
select ok((select mini_game_token_used from public.players where id=current_setting('scoreup.edge_actor2')::uuid),'a successfully started challenge keeps its token consumed after server refund');
select lives_ok(format('select private.refund_mini_game_escrow(%L,%L)',current_setting('scoreup.edge_challenge2')::uuid,'REPLAY'),'refund recovery is idempotent');
select is((select count(*) from public.score_ledger where mini_game_challenge_id=current_setting('scoreup.edge_challenge2')::uuid),4::bigint,'refund replay creates no duplicate ledger entries');
select is((select current_phase from public.rooms where id=current_setting('scoreup.edge_room2')::uuid),'round_summary'::public.game_phase,'refund advances the empty queue');

-- A valid result wins when its opponent times out.
select set_config('scoreup.edge_room3',pg_temp.make_room('a0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000006','Timeout','a1000000-0000-4000-8000-000000000003')::text,true);
select pg_temp.enter_points(current_setting('scoreup.edge_room3')::uuid);
select set_config('scoreup.edge_actor3',(select id::text from public.players where room_id=current_setting('scoreup.edge_room3')::uuid order by join_order limit 1),true);
select set_config('scoreup.edge_target3',(select id::text from public.players where room_id=current_setting('scoreup.edge_room3')::uuid order by join_order offset 1 limit 1),true);
update public.players set score=500 where room_id=current_setting('scoreup.edge_room3')::uuid;
select pg_temp.claim('a0000000-0000-4000-8000-000000000005'); set local role authenticated;
select public.request_mini_game_challenge(current_setting('scoreup.edge_room3')::uuid,current_setting('scoreup.edge_target3')::uuid,'all','a2000000-0000-4000-8000-000000000005'); reset role;
select pg_temp.finish_points(current_setting('scoreup.edge_room3')::uuid);
select set_config('scoreup.edge_challenge3',(select id::text from public.mini_game_challenges where room_id=current_setting('scoreup.edge_room3')::uuid),true);
update public.mini_game_challenges set starts_at=statement_timestamp()-interval '1 second',submission_deadline=statement_timestamp()+interval '30 seconds' where id=current_setting('scoreup.edge_challenge3')::uuid;
select pg_temp.claim('a0000000-0000-4000-8000-000000000005'); set local role authenticated;
select lives_ok(format('select public.submit_mini_game_result(%L,%L,''{"position":0.5,"elapsedMs":500}''::jsonb,%L)',current_setting('scoreup.edge_room3')::uuid,current_setting('scoreup.edge_challenge3')::uuid,'a2000000-0000-4000-8000-000000000006'::uuid),'one participant submits a valid result'); reset role;
update public.mini_game_challenges set submission_deadline=statement_timestamp()-interval '1 second' where id=current_setting('scoreup.edge_challenge3')::uuid;
select pg_temp.claim('a0000000-0000-4000-8000-000000000006'); set local role authenticated;
select public.process_expired_mini_game(current_setting('scoreup.edge_room3')::uuid,'a2000000-0000-4000-8000-000000000007'); reset role;
select is((select resolution_method from public.mini_game_challenges where id=current_setting('scoreup.edge_challenge3')::uuid),'opponent_timeout'::public.mini_game_resolution_method,'one valid result defeats a timed-out opponent');
select is((select winner_player_id from public.mini_game_challenges where id=current_setting('scoreup.edge_challenge3')::uuid),current_setting('scoreup.edge_actor3')::uuid,'the valid submitter receives the pot');

select * from finish();
rollback;
