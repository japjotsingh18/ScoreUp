begin;
set local search_path = public, extensions;

select plan(72);

insert into auth.users(id,aud,role,is_anonymous,created_at,updated_at)
select ('b5000000-0000-4000-8000-' || lpad(value::text,12,'0'))::uuid,
  'authenticated','authenticated',true,now(),now() from generate_series(1,10) value;

create function pg_temp.claim(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',p_user::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated','is_anonymous',true)::text,true);
end; $$;

-- Unique-winner completion plus competition ranking and derived, tied statistics.
insert into public.rooms(id,room_code,host_player_id,status,max_players,total_rounds,turn_timer_seconds,
  created_by_user_id,creation_request_id,current_round,current_phase,started_at)
values('b6000000-0000-4000-8000-000000000001','CMPA2','b6100000-0000-4000-8000-000000000001',
  'in_progress',4,6,20,'b5000000-0000-4000-8000-000000000001','b6200000-0000-4000-8000-000000000001',6,'finalizing',now()-interval '10 minutes');
insert into public.players(id,room_id,auth_user_id,display_name,is_host,match_participant,score,
  action_draw_allowance,action_draws_used,challenges_won)
values
('b6100000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001','Alpha',true,true,1200,2,1,1),
('b6100000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000002','Bravo',false,true,800,2,2,0),
('b6100000-0000-4000-8000-000000000003','b6000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000003','Charlie',false,true,800,2,2,1),
('b6100000-0000-4000-8000-000000000004','b6000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000004','Delta',false,true,300,2,0,1);
insert into public.rounds(id,room_id,round_number,phase,status,decision_order,started_at,completed_at)
values('b6300000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001',6,'round_summary','completed',
  array['b6100000-0000-4000-8000-000000000001','b6100000-0000-4000-8000-000000000002','b6100000-0000-4000-8000-000000000003','b6100000-0000-4000-8000-000000000004']::uuid[],now()-interval '2 minutes',now());
insert into public.point_decisions(id,round_id,room_id,round_number,acting_player_id,target_player_id,decision_type,idempotency_key)
values
('b6400000-0000-4000-8000-000000000001','b6300000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001',6,'b6100000-0000-4000-8000-000000000001',null,'lock_in','b6500000-0000-4000-8000-000000000001'),
('b6400000-0000-4000-8000-000000000002','b6300000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001',6,'b6100000-0000-4000-8000-000000000002',null,'lock_in','b6500000-0000-4000-8000-000000000002'),
('b6400000-0000-4000-8000-000000000003','b6300000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001',6,'b6100000-0000-4000-8000-000000000003','b6100000-0000-4000-8000-000000000004','challenge','b6500000-0000-4000-8000-000000000003'),
('b6400000-0000-4000-8000-000000000004','b6300000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001',6,'b6100000-0000-4000-8000-000000000004',null,'auto_lock_in','b6500000-0000-4000-8000-000000000004');
insert into public.score_ledger(room_id,round_id,player_id,decision_id,delta,balance_after,source_key,reason_code,created_at)
values
('b6000000-0000-4000-8000-000000000001','b6300000-0000-4000-8000-000000000001','b6100000-0000-4000-8000-000000000001','b6400000-0000-4000-8000-000000000001',600,100,'complete:1','point_decision',now()-interval '1 minute'),
('b6000000-0000-4000-8000-000000000001','b6300000-0000-4000-8000-000000000001','b6100000-0000-4000-8000-000000000002','b6400000-0000-4000-8000-000000000002',500,500,'complete:2','point_decision',now()-interval '1 minute'),
('b6000000-0000-4000-8000-000000000001','b6300000-0000-4000-8000-000000000001','b6100000-0000-4000-8000-000000000003','b6400000-0000-4000-8000-000000000003',700,700,'complete:3','point_decision',now()-interval '1 minute'),
('b6000000-0000-4000-8000-000000000001','b6300000-0000-4000-8000-000000000001','b6100000-0000-4000-8000-000000000004','b6400000-0000-4000-8000-000000000004',100,1500,'complete:4','point_decision',now()-interval '1 minute');

select lives_ok($$select private.finalize_match('b6000000-0000-4000-8000-000000000001')$$,'unique leader finalizes transactionally');
select is((select winner_player_id from public.match_results where room_id='b6000000-0000-4000-8000-000000000001'),'b6100000-0000-4000-8000-000000000001'::uuid,'highest score is authoritative winner');
select is((select status from public.rooms where id='b6000000-0000-4000-8000-000000000001'),'completed'::public.room_status,'room is completed only after result storage');
select is((select current_phase from public.rooms where id='b6000000-0000-4000-8000-000000000001'),'completed'::public.game_phase,'phase reaches completed');
select is((select completed_at from public.rooms where id='b6000000-0000-4000-8000-000000000001'),(select completed_at from public.match_results where room_id='b6000000-0000-4000-8000-000000000001'),'room and result share one completion timestamp');
select is((select count(*) from public.match_results where room_id='b6000000-0000-4000-8000-000000000001'),1::bigint,'exactly one official result exists');
select is((select final_rank from public.match_result_players where player_id='b6100000-0000-4000-8000-000000000001'),1,'winner is rank one');
select is((select count(*) from public.match_result_players where room_id='b6000000-0000-4000-8000-000000000001' and final_rank=2),2::bigint,'lower score tie shares competition rank two');
select is((select final_rank from public.match_result_players where player_id='b6100000-0000-4000-8000-000000000004'),4,'rank after a two-player tie skips to four');
select is((select player_id from public.match_result_players where room_id='b6000000-0000-4000-8000-000000000001' and display_order=2),'b6100000-0000-4000-8000-000000000002'::uuid,'join order is only the display fallback within a rank tie');
select is((select count(*) from public.game_events where room_id='b6000000-0000-4000-8000-000000000001' and event_type='match_completed'),1::bigint,'one completion event is recorded');
select is((select player_id from public.match_stat_awards where room_id='b6000000-0000-4000-8000-000000000001' and category='lock_in_points'),'b6100000-0000-4000-8000-000000000001'::uuid,'most lock-in points derives from ledger decisions');
select is((select value from public.match_stat_awards where room_id='b6000000-0000-4000-8000-000000000001' and category='lock_in_points'),600::bigint,'lock-in award value is reproducible');
select is((select player_id from public.match_stat_awards where room_id='b6000000-0000-4000-8000-000000000001' and category='biggest_point_challenge'),'b6100000-0000-4000-8000-000000000003'::uuid,'biggest challenge victory derives from its score award');
select is((select value from public.match_stat_awards where room_id='b6000000-0000-4000-8000-000000000001' and category='biggest_point_challenge'),700::bigint,'challenge award value is reproducible');
select is((select count(*) from public.match_stat_awards where room_id='b6000000-0000-4000-8000-000000000001' and category='action_draws'),2::bigint,'action-draw award preserves ties');
select is((select count(*) from public.match_stat_awards where room_id='b6000000-0000-4000-8000-000000000001' and category='mini_game_wins'),3::bigint,'Mini-Game win award preserves all tied leaders');
select is((select player_id from public.match_stat_awards where room_id='b6000000-0000-4000-8000-000000000001' and category='biggest_comeback'),'b6100000-0000-4000-8000-000000000001'::uuid,'biggest comeback compares round-end and final ranks');
select ok(not exists(select 1 from public.match_stat_awards where room_id='b6000000-0000-4000-8000-000000000001' and value<=0),'zero values never masquerade as qualifying awards');
select lives_ok($$select private.complete_match('b6000000-0000-4000-8000-000000000001','b6100000-0000-4000-8000-000000000001','skill')$$,'completion replay is idempotent');
select is((select count(*) from public.match_results where room_id='b6000000-0000-4000-8000-000000000001'),1::bigint,'completion replay creates no duplicate result');

-- Three tied leaders receive one shared seeded championship with frozen scores.
insert into public.rooms(id,room_code,host_player_id,status,max_players,total_rounds,turn_timer_seconds,password_hash,
  created_by_user_id,creation_request_id,current_round,current_phase,started_at)
values('b6000000-0000-4000-8000-000000000002','CMPB2','b6100000-0000-4000-8000-000000000005',
  'in_progress',4,6,30,'$2a$10$abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuv',
  'b5000000-0000-4000-8000-000000000005','b6200000-0000-4000-8000-000000000002',6,'finalizing',now()-interval '10 minutes');
insert into public.players(id,room_id,auth_user_id,display_name,is_host,match_participant,score,action_draw_allowance)
values
('b6100000-0000-4000-8000-000000000005','b6000000-0000-4000-8000-000000000002','b5000000-0000-4000-8000-000000000005','Echo',true,true,1000,2),
('b6100000-0000-4000-8000-000000000006','b6000000-0000-4000-8000-000000000002','b5000000-0000-4000-8000-000000000006','Foxtrot',false,true,1000,2),
('b6100000-0000-4000-8000-000000000007','b6000000-0000-4000-8000-000000000002','b5000000-0000-4000-8000-000000000007','Golf',false,true,1000,2),
('b6100000-0000-4000-8000-000000000008','b6000000-0000-4000-8000-000000000002','b5000000-0000-4000-8000-000000000008','Hotel',false,true,400,2);
insert into public.rounds(id,room_id,round_number,phase,status,decision_order,started_at,completed_at)
values('b6300000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000002',6,'round_summary','completed',
  array['b6100000-0000-4000-8000-000000000005','b6100000-0000-4000-8000-000000000006','b6100000-0000-4000-8000-000000000007','b6100000-0000-4000-8000-000000000008']::uuid[],now()-interval '2 minutes',now());
select lives_ok($$select private.finalize_match('b6000000-0000-4000-8000-000000000002')$$,'multi-player top tie starts a championship');
select is((select status from public.rooms where id='b6000000-0000-4000-8000-000000000002'),'in_progress'::public.room_status,'tied room remains in progress');
select is((select current_phase from public.rooms where id='b6000000-0000-4000-8000-000000000002'),'championship_tiebreaker'::public.game_phase,'tied room enters championship phase');
select is((select count(*) from public.championship_participants where room_id='b6000000-0000-4000-8000-000000000002'),3::bigint,'every tied top player participates');
select is((select octet_length(seed) from private.championship_specs where room_id='b6000000-0000-4000-8000-000000000002'),32,'championship uses a protected 32-byte seed');
select is((select sum(score) from public.players where room_id='b6000000-0000-4000-8000-000000000002'),3400::numeric,'starting the championship transfers no score');
select is(private.build_match_snapshot('b6000000-0000-4000-8000-000000000002','b5000000-0000-4000-8000-000000000008')->'completionState'->'tiebreaker'->'specification','null'::jsonb,'non-finalists cannot see the active specification');
select is(private.build_match_snapshot('b6000000-0000-4000-8000-000000000002','b5000000-0000-4000-8000-000000000005')->'completionState'->'tiebreaker'->'specification'->>'type','stop_bar','a finalist receives the shared Stop Bar specification');
update public.championship_tiebreakers set starts_at=statement_timestamp()-interval '2 seconds',submission_deadline=statement_timestamp()+interval '10 seconds' where room_id='b6000000-0000-4000-8000-000000000002';
select set_config('scoreup.champ_target',(select expected_result->>'targetPosition' from private.championship_specs where room_id='b6000000-0000-4000-8000-000000000002'),true);
select pg_temp.claim('b5000000-0000-4000-8000-000000000008'); set local role authenticated;
select throws_ok($$select public.submit_championship_result('b6000000-0000-4000-8000-000000000002',jsonb_build_object('position',0.5,'elapsedMs',1000),'b6600000-0000-4000-8000-000000000001')$$,'P0001','NOT_CHAMPIONSHIP_PARTICIPANT','lower-ranked players cannot submit'); reset role;
select pg_temp.claim('b5000000-0000-4000-8000-000000000005'); set local role authenticated;
select lives_ok(format('select public.submit_championship_result(%L,jsonb_build_object(''position'',%L::numeric+0.001,''elapsedMs'',1200),%L)','b6000000-0000-4000-8000-000000000002'::uuid,current_setting('scoreup.champ_target'),'b6600000-0000-4000-8000-000000000002'::uuid),'first finalist submits');
select lives_ok(format('select public.submit_championship_result(%L,jsonb_build_object(''position'',%L::numeric+0.001,''elapsedMs'',1200),%L)','b6000000-0000-4000-8000-000000000002'::uuid,current_setting('scoreup.champ_target'),'b6600000-0000-4000-8000-000000000002'::uuid),'exact submission replay is idempotent'); reset role;
select is((select count(*) from public.championship_submissions where room_id='b6000000-0000-4000-8000-000000000002' and player_id='b6100000-0000-4000-8000-000000000005'),1::bigint,'submission replay creates one row');
select pg_temp.claim('b5000000-0000-4000-8000-000000000005'); set local role authenticated;
select throws_ok(format('select public.submit_championship_result(%L,jsonb_build_object(''position'',%L::numeric+0.001,''elapsedMs'',1200),%L)','b6000000-0000-4000-8000-000000000002'::uuid,current_setting('scoreup.champ_target'),'b6600000-0000-4000-8000-000000000003'::uuid),'P0001','CHAMPIONSHIP_ALREADY_SUBMITTED','a second payload cannot replace a locked result'); reset role;
select pg_temp.claim('b5000000-0000-4000-8000-000000000006'); set local role authenticated;
select lives_ok(format('select public.submit_championship_result(%L,jsonb_build_object(''position'',%L::numeric+0.002,''elapsedMs'',1300),%L)','b6000000-0000-4000-8000-000000000002'::uuid,current_setting('scoreup.champ_target'),'b6600000-0000-4000-8000-000000000004'::uuid),'second finalist submits'); reset role;
select is((select status from public.championship_tiebreakers where room_id='b6000000-0000-4000-8000-000000000002'),'active'::public.championship_status,'championship waits for every finalist');
select pg_temp.claim('b5000000-0000-4000-8000-000000000007'); set local role authenticated;
select lives_ok(format('select public.submit_championship_result(%L,jsonb_build_object(''position'',%L::numeric+0.003,''elapsedMs'',1400),%L)','b6000000-0000-4000-8000-000000000002'::uuid,current_setting('scoreup.champ_target'),'b6600000-0000-4000-8000-000000000005'::uuid),'final finalist resolves the championship'); reset role;
select is((select status from public.rooms where id='b6000000-0000-4000-8000-000000000002'),'completed'::public.room_status,'resolved championship completes the match');
select is((select winner_player_id from public.match_results where room_id='b6000000-0000-4000-8000-000000000002'),'b6100000-0000-4000-8000-000000000005'::uuid,'closest marker wins among all tied leaders');
select is((select resolution_method from public.match_results where room_id='b6000000-0000-4000-8000-000000000002'),'skill'::public.championship_resolution_method,'unique closest result records skill resolution');
select is((select sum(score) from public.players where room_id='b6000000-0000-4000-8000-000000000002'),3400::numeric,'championship completion transfers no score');
select is((select final_rank from public.match_result_players where player_id='b6100000-0000-4000-8000-000000000005'),1,'championship winner is unique rank one');
select is((select count(*) from public.match_result_players where room_id='b6000000-0000-4000-8000-000000000002' and final_rank=2),2::bigint,'remaining tied leaders share rank two');
select is((select final_rank from public.match_result_players where player_id='b6100000-0000-4000-8000-000000000008'),4,'lower player keeps competition rank four');
select ok((select completed_at is not null from public.match_results where room_id='b6000000-0000-4000-8000-000000000002'),'official result has an authoritative timestamp');
select is((select count(*) from public.game_events where room_id='b6000000-0000-4000-8000-000000000002' and event_type='match_completed'),1::bigint,'championship emits exactly one final completion event');
select ok(not exists(select 1 from public.game_events where room_id='b6000000-0000-4000-8000-000000000002' and (public_payload ? 'position' or public_payload ? 'normalizedDistance')),'public events reveal no submitted position or normalized result');

-- Disconnect plus deadline safely resolves from the sole valid finalist.
insert into public.rooms(id,room_code,host_player_id,status,max_players,total_rounds,turn_timer_seconds,
  created_by_user_id,creation_request_id,current_round,current_phase,started_at)
values('b6000000-0000-4000-8000-000000000003','CMPC2','b6100000-0000-4000-8000-000000000009',
  'in_progress',2,6,20,'b5000000-0000-4000-8000-000000000009','b6200000-0000-4000-8000-000000000003',6,'finalizing',now()-interval '10 minutes');
insert into public.players(id,room_id,auth_user_id,display_name,is_host,match_participant,score,action_draw_allowance)
values
('b6100000-0000-4000-8000-000000000009','b6000000-0000-4000-8000-000000000003','b5000000-0000-4000-8000-000000000009','India',true,true,900,2),
('b6100000-0000-4000-8000-000000000010','b6000000-0000-4000-8000-000000000003','b5000000-0000-4000-8000-000000000010','Juliet',false,true,900,2);
insert into public.rounds(id,room_id,round_number,phase,status,decision_order,started_at,completed_at)
values('b6300000-0000-4000-8000-000000000003','b6000000-0000-4000-8000-000000000003',6,'round_summary','completed',
  array['b6100000-0000-4000-8000-000000000009','b6100000-0000-4000-8000-000000000010']::uuid[],now()-interval '2 minutes',now());
select lives_ok($$select private.finalize_match('b6000000-0000-4000-8000-000000000003')$$,'second top tie starts safely');
update public.championship_tiebreakers set starts_at=statement_timestamp()-interval '2 seconds',submission_deadline=statement_timestamp()+interval '5 seconds' where room_id='b6000000-0000-4000-8000-000000000003';
select set_config('scoreup.timeout_target',(select expected_result->>'targetPosition' from private.championship_specs where room_id='b6000000-0000-4000-8000-000000000003'),true);
select pg_temp.claim('b5000000-0000-4000-8000-000000000009'); set local role authenticated;
select lives_ok(format('select public.submit_championship_result(%L,jsonb_build_object(''position'',%L::numeric,''elapsedMs'',1000),%L)','b6000000-0000-4000-8000-000000000003'::uuid,current_setting('scoreup.timeout_target'),'b6600000-0000-4000-8000-000000000006'::uuid),'connected finalist submits before peer disconnect'); reset role;
update public.players set connected=false,disconnected_at=statement_timestamp() where id='b6100000-0000-4000-8000-000000000010';
select ok(not (select connected from public.players where id='b6100000-0000-4000-8000-000000000010'),'disconnect is represented without removing the finalist');
update public.championship_tiebreakers set submission_deadline=statement_timestamp()-interval '1 second' where room_id='b6000000-0000-4000-8000-000000000003';
select pg_temp.claim('b5000000-0000-4000-8000-000000000009'); set local role authenticated;
select lives_ok($$select public.process_expired_championship('b6000000-0000-4000-8000-000000000003','b6600000-0000-4000-8000-000000000007')$$,'any participant can process the expired championship'); reset role;
select is((select winner_player_id from public.match_results where room_id='b6000000-0000-4000-8000-000000000003'),'b6100000-0000-4000-8000-000000000009'::uuid,'sole valid submitter wins after timeout');
select is((select resolution_method from public.match_results where room_id='b6000000-0000-4000-8000-000000000003'),'timeout'::public.championship_resolution_method,'deadline resolution is auditable as timeout');
select is((select sum(score) from public.players where room_id='b6000000-0000-4000-8000-000000000003'),1800::numeric,'timeout resolution transfers no score');

-- Rematch creates a separate ready-check room and preserves all source history.
select pg_temp.claim('b5000000-0000-4000-8000-000000000005'); set local role authenticated;
select lives_ok($$select public.request_rematch('b6000000-0000-4000-8000-000000000002','b6700000-0000-4000-8000-000000000001')$$,'completed participant creates the rematch lobby'); reset role;
select set_config('scoreup.rematch_room',(select rematch_room_id::text from public.rematches where source_room_id='b6000000-0000-4000-8000-000000000002'),true);
select isnt(current_setting('scoreup.rematch_room')::uuid,'b6000000-0000-4000-8000-000000000002'::uuid,'rematch uses a new room identity');
select is((select status from public.rooms where id='b6000000-0000-4000-8000-000000000002'),'completed'::public.room_status,'source match remains completed');
select is((select total_rounds from public.rooms where id=current_setting('scoreup.rematch_room')::uuid),6::smallint,'round configuration is retained');
select is((select turn_timer_seconds from public.rooms where id=current_setting('scoreup.rematch_room')::uuid),30::smallint,'timer configuration is retained');
select is((select password_hash from public.rooms where id=current_setting('scoreup.rematch_room')::uuid),(select password_hash from public.rooms where id='b6000000-0000-4000-8000-000000000002'),'password hash is copied only server-side');
select is((select count(*) from public.players where room_id=current_setting('scoreup.rematch_room')::uuid),4::bigint,'same roster receives new seats');
select ok(not exists(select 1 from public.players where room_id=current_setting('scoreup.rematch_room')::uuid and ready),'every rematch seat returns to ready-check');
select ok(not exists(select 1 from public.players where room_id=current_setting('scoreup.rematch_room')::uuid and (score<>0 or match_participant)),'new seats carry no old score or active-match authority');
select is((select auth_user_id from public.players where room_id=current_setting('scoreup.rematch_room')::uuid and is_host),'b5000000-0000-4000-8000-000000000005'::uuid,'host identity is retained');
select pg_temp.claim('b5000000-0000-4000-8000-000000000006'); set local role authenticated;
select lives_ok($$select public.request_rematch('b6000000-0000-4000-8000-000000000002','b6700000-0000-4000-8000-000000000002')$$,'another participant reuses the existing rematch'); reset role;
select is((select count(*) from public.rematches where source_room_id='b6000000-0000-4000-8000-000000000002'),1::bigint,'concurrent rematch intent cannot fork lobbies');
select is((select count(*) from public.match_result_players where room_id='b6000000-0000-4000-8000-000000000002'),4::bigint,'source ranking history remains intact');
select is((select status from public.rooms where id=current_setting('scoreup.rematch_room')::uuid),'lobby'::public.room_status,'rematch starts as a lobby, not a match');

-- RLS and RPC boundaries remain intact after completion.
select pg_temp.claim('b5000000-0000-4000-8000-000000000005'); set local role authenticated;
select is((select count(*) from public.championship_submissions where room_id='b6000000-0000-4000-8000-000000000002'),1::bigint,'a finalist can read only their own raw submission');
select throws_ok($$update public.match_results set winner_player_id='b6100000-0000-4000-8000-000000000006' where room_id='b6000000-0000-4000-8000-000000000002'$$,'42501',null,'participants cannot rewrite the winner'); reset role;
select pg_temp.claim('b5000000-0000-4000-8000-000000000008'); set local role authenticated;
select is((select count(*) from public.match_result_players where room_id='b6000000-0000-4000-8000-000000000002'),4::bigint,'every participant can read official rankings'); reset role;
select pg_temp.claim('b5000000-0000-4000-8000-000000000001'); set local role authenticated;
select throws_ok($$select public.get_match_snapshot('b6000000-0000-4000-8000-000000000002')$$,'P0001','NOT_MATCH_PARTICIPANT','unrelated users cannot read another result snapshot'); reset role;

select * from finish();
rollback;
