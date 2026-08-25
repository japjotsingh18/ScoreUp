begin;
set local search_path = public, extensions;

select plan(34);

select has_table('public', 'rounds', 'rounds table exists');
select has_table('public', 'round_cards_private', 'private round-card table exists');
select has_table('public', 'point_decisions', 'point decisions table exists');
select has_table('public', 'score_ledger', 'score ledger table exists');
select has_table('public', 'game_events', 'public-safe game events table exists');
select has_table('private', 'point_card_deck', 'server-side point-card deck exists');

select has_column('public', 'rooms', 'current_round', 'rooms track the current round');
select has_column('public', 'rooms', 'current_phase', 'rooms track the authoritative phase');
select has_column('public', 'rooms', 'current_turn_player_id', 'rooms track the active player');
select has_column('public', 'rooms', 'phase_deadline', 'rooms track the server deadline');
select has_column('public', 'rooms', 'match_version', 'rooms have a monotonic match version');
select has_column('public', 'rooms', 'tiebreaker_required', 'rooms record unresolved first-place ties');
select has_column('public', 'players', 'score', 'players have an authoritative score');
select has_column('public', 'players', 'match_participant', 'players have frozen-roster membership');
select has_column('public', 'players', 'action_draw_allowance', 'future action allowance is stored');
select has_column('public', 'players', 'mini_game_token_used', 'future Mini-Game token state is stored');
select has_column('public', 'players', 'summary_ready_round', 'per-round result readiness is stored');

select col_is_pk('public', 'rounds', 'id', 'rounds use UUID primary keys');
select col_is_fk('public', 'rounds', 'room_id', 'rounds belong to rooms');
select col_is_fk('public', 'round_cards_private', array['room_id', 'player_id'], 'cards belong to match players');
select col_is_fk('public', 'point_decisions', array['room_id', 'acting_player_id'], 'decisions bind their actor');
select col_is_fk('public', 'score_ledger', 'decision_id', 'score awards bind to a decision');
select col_is_fk('public', 'game_events', 'room_id', 'events belong to rooms');

select has_index('public', 'rounds', 'rounds_room_number_unique', 'one row exists per room round');
select has_index('public', 'round_cards_private', 'round_cards_player_unique', 'one card exists per player round');
select has_index('public', 'point_decisions', 'point_decisions_actor_once', 'one acting decision exists per player round');
select has_index('public', 'point_decisions', 'point_decisions_idempotency', 'decision requests are idempotent per room');
select has_index('public', 'score_ledger', 'score_ledger_source_unique', 'score sources cannot be awarded twice');

select ok((select relrowsecurity from pg_class where oid = 'public.rounds'::regclass), 'rounds has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.round_cards_private'::regclass), 'private cards have RLS enabled');
select has_function('public', 'lock_in_point_card', array['uuid', 'uuid'], 'Lock In RPC exists');
select has_function('public', 'challenge_point_card', array['uuid', 'uuid', 'uuid'], 'challenge RPC exists');
select has_function('public', 'process_expired_turn', array['uuid', 'uuid', 'uuid'], 'timeout RPC exists');
select has_function('public', 'set_round_summary_ready', array['uuid', 'boolean', 'uuid'], 'result readiness RPC exists');

select * from finish();
rollback;
