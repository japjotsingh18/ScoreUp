begin;
set local search_path = public, extensions;

select plan(42);

insert into auth.users(id,aud,role,is_anonymous,created_at,updated_at)
select ('70000000-0000-4000-8000-' || lpad(value::text,12,'0'))::uuid,
  'authenticated','authenticated',true,now(),now() from generate_series(1,8) value;

create function pg_temp.claim(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_user,'role','authenticated','is_anonymous',true)::text, true);
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
  from public.players p where p.room_id=p_room and p.match_participant
  on conflict(round_id,player_id) do nothing;
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

-- Half stake, token timing, privacy, deterministic Stop the Bar, and exactly-once settlement.
select set_config('scoreup.mini_room1',pg_temp.make_room('70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','Mini Half','71000000-0000-4000-8000-000000000001')::text,true);
select set_config('scoreup.mini_actor1',(select id::text from public.players where room_id=current_setting('scoreup.mini_room1')::uuid order by join_order limit 1),true);
select set_config('scoreup.mini_target1',(select id::text from public.players where room_id=current_setting('scoreup.mini_room1')::uuid order by join_order offset 1 limit 1),true);
select ok(current_setting('scoreup.mini_room1')::uuid is not null,'first Mini-Game room starts');
select pg_temp.claim('70000000-0000-4000-8000-000000000001'); set local role authenticated;
select throws_ok(format('select public.request_mini_game_challenge(%L,%L,%L,%L)',current_setting('scoreup.mini_room1')::uuid,current_setting('scoreup.mini_target1')::uuid,'half'::public.mini_game_stake_type,'72000000-0000-4000-8000-000000000001'::uuid),'P0001','WRONG_PHASE','challenge requests are rejected during action choice');
reset role;
select pg_temp.enter_points(current_setting('scoreup.mini_room1')::uuid);
update public.players set score=case when id=current_setting('scoreup.mini_actor1')::uuid then 2000 else 0 end where room_id=current_setting('scoreup.mini_room1')::uuid;
select pg_temp.claim('70000000-0000-4000-8000-000000000001'); set local role authenticated;
select throws_ok(format('select public.request_mini_game_challenge(%L,%L,%L,%L)',current_setting('scoreup.mini_room1')::uuid,current_setting('scoreup.mini_actor1')::uuid,'half'::public.mini_game_stake_type,'72000000-0000-4000-8000-000000000002'::uuid),'P0001','SELF_MINI_GAME_CHALLENGE','self Mini-Game challenge is rejected');
select throws_ok(format('select public.request_mini_game_challenge(%L,%L,%L,%L)',current_setting('scoreup.mini_room1')::uuid,current_setting('scoreup.mini_target1')::uuid,'half'::public.mini_game_stake_type,'72000000-0000-4000-8000-000000000003'::uuid),'P0001','ZERO_STAKE','zero-score opponent is rejected');
reset role;
update public.players set score=case when id=current_setting('scoreup.mini_actor1')::uuid then 2000 else 1200 end where room_id=current_setting('scoreup.mini_room1')::uuid;
select pg_temp.claim('70000000-0000-4000-8000-000000000001'); set local role authenticated;
select lives_ok(format('select public.request_mini_game_challenge(%L,%L,%L,%L)',current_setting('scoreup.mini_room1')::uuid,current_setting('scoreup.mini_target1')::uuid,'half'::public.mini_game_stake_type,'72000000-0000-4000-8000-000000000004'::uuid),'valid Half challenge queues');
select lives_ok(format('select public.request_mini_game_challenge(%L,%L,%L,%L)',current_setting('scoreup.mini_room1')::uuid,current_setting('scoreup.mini_target1')::uuid,'half'::public.mini_game_stake_type,'72000000-0000-4000-8000-000000000004'::uuid),'duplicate request replay is idempotent');
reset role;
select is((select count(*) from public.mini_game_challenges where room_id=current_setting('scoreup.mini_room1')::uuid),1::bigint,'replay creates one queued challenge');
select ok(not (select mini_game_token_used from public.players where id=current_setting('scoreup.mini_actor1')::uuid),'queued challenge does not consume the token');
select set_config('scoreup.test_mini_game_type','stop_bar',true);
select pg_temp.finish_points(current_setting('scoreup.mini_room1')::uuid);
select set_config('scoreup.challenge1',(select id::text from public.mini_game_challenges where room_id=current_setting('scoreup.mini_room1')::uuid),true);
select is((select status from public.mini_game_challenges where id=current_setting('scoreup.challenge1')::uuid),'active'::public.mini_game_challenge_status,'front queue item starts after point scoring');
select is((select stake_per_player from public.mini_game_challenges where id=current_setting('scoreup.challenge1')::uuid),600,'Half stake uses lower score, halves, and floors to 50');
select is((select pot from public.mini_game_challenges where id=current_setting('scoreup.challenge1')::uuid),1200,'Half pot contains both matched stakes');
select is((select score from public.players where id=current_setting('scoreup.mini_actor1')::uuid),1400::bigint,'challenger stake is atomically deducted');
select is((select score from public.players where id=current_setting('scoreup.mini_target1')::uuid),600::bigint,'opponent matched stake is atomically deducted');
select ok((select mini_game_token_used from public.players where id=current_setting('scoreup.mini_actor1')::uuid),'challenger token is consumed only at successful start');
select ok(not (select mini_game_token_used from public.players where id=current_setting('scoreup.mini_target1')::uuid),'challenged player token remains available');
select is((select count(*) from public.score_ledger where mini_game_challenge_id=current_setting('scoreup.challenge1')::uuid),2::bigint,'escrow creates two signed deduction entries');
update public.mini_game_challenges set starts_at=statement_timestamp()-interval '1 second',submission_deadline=statement_timestamp()+interval '30 seconds' where id=current_setting('scoreup.challenge1')::uuid;
select set_config('scoreup.targetpos',(select expected_result->>'targetPosition' from private.mini_game_specs where challenge_id=current_setting('scoreup.challenge1')::uuid and attempt=1),true);
select pg_temp.claim('70000000-0000-4000-8000-000000000001'); set local role authenticated;
select lives_ok(format('select public.submit_mini_game_result(%L,%L,jsonb_build_object(''position'',%L::numeric,''elapsedMs'',1000),%L)',current_setting('scoreup.mini_room1')::uuid,current_setting('scoreup.challenge1')::uuid,current_setting('scoreup.targetpos'),'72000000-0000-4000-8000-000000000005'::uuid),'exact Stop the Bar result is accepted'); reset role;
select pg_temp.claim('70000000-0000-4000-8000-000000000002'); set local role authenticated;
select lives_ok(format('select public.submit_mini_game_result(%L,%L,jsonb_build_object(''position'',least(1,%L::numeric+0.1),''elapsedMs'',900),%L)',current_setting('scoreup.mini_room1')::uuid,current_setting('scoreup.challenge1')::uuid,current_setting('scoreup.targetpos'),'72000000-0000-4000-8000-000000000006'::uuid),'second Stop the Bar result settles the challenge'); reset role;
select is((select winner_player_id from public.mini_game_challenges where id=current_setting('scoreup.challenge1')::uuid),current_setting('scoreup.mini_actor1')::uuid,'smallest target distance wins Stop the Bar');
select is((select score from public.players where id=current_setting('scoreup.mini_actor1')::uuid),2600::bigint,'winner receives the entire pot exactly once');
select is((select count(*) from public.score_ledger where mini_game_challenge_id=current_setting('scoreup.challenge1')::uuid),3::bigint,'settlement adds one pot award ledger entry');
select is((select current_phase from public.rooms where id=current_setting('scoreup.mini_room1')::uuid),'round_summary'::public.game_phase,'empty queue advances to round summary');

-- Stake All and no-valid-submission random fallback.
select set_config('scoreup.mini_room2',pg_temp.make_room('70000000-0000-4000-8000-000000000003','70000000-0000-4000-8000-000000000004','Mini All','71000000-0000-4000-8000-000000000002')::text,true);
select pg_temp.enter_points(current_setting('scoreup.mini_room2')::uuid);
select set_config('scoreup.mini_actor2',(select id::text from public.players where room_id=current_setting('scoreup.mini_room2')::uuid order by join_order limit 1),true);
select set_config('scoreup.mini_target2',(select id::text from public.players where room_id=current_setting('scoreup.mini_room2')::uuid order by join_order offset 1 limit 1),true);
update public.players set score=case when id=current_setting('scoreup.mini_actor2')::uuid then 2000 else 1200 end where room_id=current_setting('scoreup.mini_room2')::uuid;
select pg_temp.claim('70000000-0000-4000-8000-000000000003'); set local role authenticated;
select lives_ok(format('select public.request_mini_game_challenge(%L,%L,%L,%L)',current_setting('scoreup.mini_room2')::uuid,current_setting('scoreup.mini_target2')::uuid,'all'::public.mini_game_stake_type,'72000000-0000-4000-8000-000000000007'::uuid),'Stake All challenge queues'); reset role;
select pg_temp.finish_points(current_setting('scoreup.mini_room2')::uuid);
select set_config('scoreup.challenge2',(select id::text from public.mini_game_challenges where room_id=current_setting('scoreup.mini_room2')::uuid),true);
select is((select stake_per_player from public.mini_game_challenges where id=current_setting('scoreup.challenge2')::uuid),1200,'Stake All uses the complete matched limit');
select is((select pot from public.mini_game_challenges where id=current_setting('scoreup.challenge2')::uuid),2400,'Stake All pot is twice the matched limit');
update public.mini_game_challenges set starts_at=statement_timestamp()-interval '40 seconds',submission_deadline=statement_timestamp()-interval '1 second' where id=current_setting('scoreup.challenge2')::uuid;
select set_config('scoreup.test_mini_random_winner','0',true);
select pg_temp.claim('70000000-0000-4000-8000-000000000004'); set local role authenticated;
select lives_ok(format('select public.process_expired_mini_game(%L,%L)',current_setting('scoreup.mini_room2')::uuid,'72000000-0000-4000-8000-000000000008'::uuid),'any participant processes an expired challenge'); reset role;
select is((select resolution_method from public.mini_game_challenges where id=current_setting('scoreup.challenge2')::uuid),'random_fallback'::public.mini_game_resolution_method,'no valid submissions use secure random fallback');
select is((select winner_player_id from public.mini_game_challenges where id=current_setting('scoreup.challenge2')::uuid),current_setting('scoreup.mini_actor2')::uuid,'deterministic owner-only fallback selects expected winner in tests');
select is((select score from public.players where id=current_setting('scoreup.mini_actor2')::uuid),3200::bigint,'fallback winner receives locked Stake All pot');

-- Memory tie creates a no-extra-stake seeded Stop the Bar tiebreaker, then fallback.
select set_config('scoreup.mini_room3',pg_temp.make_room('70000000-0000-4000-8000-000000000005','70000000-0000-4000-8000-000000000006','Mini Tie','71000000-0000-4000-8000-000000000003')::text,true);
select pg_temp.enter_points(current_setting('scoreup.mini_room3')::uuid);
select set_config('scoreup.mini_actor3',(select id::text from public.players where room_id=current_setting('scoreup.mini_room3')::uuid order by join_order limit 1),true);
select set_config('scoreup.mini_target3',(select id::text from public.players where room_id=current_setting('scoreup.mini_room3')::uuid order by join_order offset 1 limit 1),true);
update public.players set score=1000 where room_id=current_setting('scoreup.mini_room3')::uuid;
select set_config('scoreup.test_mini_game_type','memory_sequence',true);
select pg_temp.claim('70000000-0000-4000-8000-000000000005'); set local role authenticated;
select public.request_mini_game_challenge(current_setting('scoreup.mini_room3')::uuid,current_setting('scoreup.mini_target3')::uuid,'half','72000000-0000-4000-8000-000000000009'); reset role;
select pg_temp.finish_points(current_setting('scoreup.mini_room3')::uuid);
select set_config('scoreup.challenge3',(select id::text from public.mini_game_challenges where room_id=current_setting('scoreup.mini_room3')::uuid),true);
update public.mini_game_challenges set starts_at=statement_timestamp()-interval '1 second',submission_deadline=statement_timestamp()+interval '30 seconds' where id=current_setting('scoreup.challenge3')::uuid;
select set_config('scoreup.sequence',(select participant_spec->'sequence' from private.mini_game_specs where challenge_id=current_setting('scoreup.challenge3')::uuid and attempt=1)::text,true);
select pg_temp.claim('70000000-0000-4000-8000-000000000005'); set local role authenticated;
select public.submit_mini_game_result(current_setting('scoreup.mini_room3')::uuid,current_setting('scoreup.challenge3')::uuid,jsonb_build_object('sequence',current_setting('scoreup.sequence')::jsonb,'correctConsecutive',6,'elapsedMs',1000),'72000000-0000-4000-8000-000000000010'); reset role;
select pg_temp.claim('70000000-0000-4000-8000-000000000006'); set local role authenticated;
select lives_ok(format('select public.submit_mini_game_result(%L,%L,jsonb_build_object(''sequence'',%L::jsonb,''correctConsecutive'',6,''elapsedMs'',1000),%L)',current_setting('scoreup.mini_room3')::uuid,current_setting('scoreup.challenge3')::uuid,current_setting('scoreup.sequence'),'72000000-0000-4000-8000-000000000011'::uuid),'equal Memory results start a tiebreaker'); reset role;
select is((select status from public.mini_game_challenges where id=current_setting('scoreup.challenge3')::uuid),'tiebreaker_active'::public.mini_game_challenge_status,'ordinary tie enters tiebreaker state');
select is((select game_type from public.mini_game_challenges where id=current_setting('scoreup.challenge3')::uuid),'stop_bar'::public.mini_game_type,'ordinary tie uses Stop the Bar');
select is((select current_attempt from public.mini_game_challenges where id=current_setting('scoreup.challenge3')::uuid),2::smallint,'tiebreaker is a second attempt');
select is((select count(*) from public.score_ledger where mini_game_challenge_id=current_setting('scoreup.challenge3')::uuid),2::bigint,'tiebreaker transfers no additional stake');
update public.mini_game_challenges set starts_at=statement_timestamp()-interval '1 second',submission_deadline=statement_timestamp()+interval '20 seconds' where id=current_setting('scoreup.challenge3')::uuid;
select set_config('scoreup.tiepos',(select expected_result->>'targetPosition' from private.mini_game_specs where challenge_id=current_setting('scoreup.challenge3')::uuid and attempt=2),true);
select pg_temp.claim('70000000-0000-4000-8000-000000000005'); set local role authenticated;
select public.submit_mini_game_result(current_setting('scoreup.mini_room3')::uuid,current_setting('scoreup.challenge3')::uuid,jsonb_build_object('position',current_setting('scoreup.tiepos')::numeric,'elapsedMs',1000),'72000000-0000-4000-8000-000000000012'); reset role;
select set_config('scoreup.test_mini_random_winner','1',true);
select pg_temp.claim('70000000-0000-4000-8000-000000000006'); set local role authenticated;
select public.submit_mini_game_result(current_setting('scoreup.mini_room3')::uuid,current_setting('scoreup.challenge3')::uuid,jsonb_build_object('position',current_setting('scoreup.tiepos')::numeric,'elapsedMs',1000),'72000000-0000-4000-8000-000000000013'); reset role;
select is((select resolution_method from public.mini_game_challenges where id=current_setting('scoreup.challenge3')::uuid),'random_fallback'::public.mini_game_resolution_method,'repeated tie uses secure random fallback');
select is((select winner_player_id from public.mini_game_challenges where id=current_setting('scoreup.challenge3')::uuid),current_setting('scoreup.mini_target3')::uuid,'repeated tie fallback resolves a winner');
select is((select min(challenges_tied) from public.players where room_id=current_setting('scoreup.mini_room3')::uuid),1,'both participants record the ordinary tie');

-- Different Symbol independent validation and deterministic specification shape.
select set_config('scoreup.mini_room4',pg_temp.make_room('70000000-0000-4000-8000-000000000007','70000000-0000-4000-8000-000000000008','Mini Different','71000000-0000-4000-8000-000000000004')::text,true);
select pg_temp.enter_points(current_setting('scoreup.mini_room4')::uuid);
select set_config('scoreup.mini_actor4',(select id::text from public.players where room_id=current_setting('scoreup.mini_room4')::uuid order by join_order limit 1),true);
select set_config('scoreup.mini_target4',(select id::text from public.players where room_id=current_setting('scoreup.mini_room4')::uuid order by join_order offset 1 limit 1),true);
update public.players set score=1000 where room_id=current_setting('scoreup.mini_room4')::uuid;
select set_config('scoreup.test_mini_game_type','different_symbol',true);
select pg_temp.claim('70000000-0000-4000-8000-000000000007'); set local role authenticated;
select public.request_mini_game_challenge(current_setting('scoreup.mini_room4')::uuid,current_setting('scoreup.mini_target4')::uuid,'all','72000000-0000-4000-8000-000000000014'); reset role;
select pg_temp.finish_points(current_setting('scoreup.mini_room4')::uuid);
select set_config('scoreup.challenge4',(select id::text from public.mini_game_challenges where room_id=current_setting('scoreup.mini_room4')::uuid),true);
select is((select jsonb_array_length(participant_spec->'cells') from private.mini_game_specs where challenge_id=current_setting('scoreup.challenge4')::uuid),25,'Different Symbol spec has an identical 5x5 grid');
update public.mini_game_challenges set starts_at=statement_timestamp()-interval '1 second',submission_deadline=statement_timestamp()+interval '30 seconds' where id=current_setting('scoreup.challenge4')::uuid;
select set_config('scoreup.cell',(select expected_result->>'targetCell' from private.mini_game_specs where challenge_id=current_setting('scoreup.challenge4')::uuid),true);
select pg_temp.claim('70000000-0000-4000-8000-000000000007'); set local role authenticated;
select public.submit_mini_game_result(current_setting('scoreup.mini_room4')::uuid,current_setting('scoreup.challenge4')::uuid,jsonb_build_object('selectedCell',current_setting('scoreup.cell')::integer,'incorrectTaps',1,'elapsedMs',1000),'72000000-0000-4000-8000-000000000015'); reset role;
select pg_temp.claim('70000000-0000-4000-8000-000000000008'); set local role authenticated;
select public.submit_mini_game_result(current_setting('scoreup.mini_room4')::uuid,current_setting('scoreup.challenge4')::uuid,jsonb_build_object('selectedCell',(current_setting('scoreup.cell')::integer+1)%25,'incorrectTaps',0,'elapsedMs',500),'72000000-0000-4000-8000-000000000016'); reset role;
select is((select winner_player_id from public.mini_game_challenges where id=current_setting('scoreup.challenge4')::uuid),current_setting('scoreup.mini_actor4')::uuid,'correct Different Symbol solution beats a faster incorrect result');
select is((select count(*) from public.mini_game_submissions where challenge_id=current_setting('scoreup.challenge4')::uuid and validation_status='accepted'),2::bigint,'both well-formed Different Symbol payloads validate independently');

select is((select participant_spec from private.generate_mini_game_spec('memory_sequence',decode(repeat('01',32),'hex'))),(select participant_spec from private.generate_mini_game_spec('memory_sequence',decode(repeat('01',32),'hex'))),'identical seeds derive identical specifications');
select is((select jsonb_array_length(participant_spec->'sequence') from private.generate_mini_game_spec('memory_sequence',decode(repeat('02',32),'hex'))),6,'Memory Sequence derives six accessible symbols');

select * from finish();
rollback;
