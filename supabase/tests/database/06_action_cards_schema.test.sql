begin;
set local search_path = public, extensions;

select plan(36);

select has_table('public', 'action_choices', 'action choices table exists');
select has_table('public', 'action_draws', 'action draws table exists');
select has_table('private', 'action_card_catalog', 'server-owned action catalog exists');
select has_table('private', 'action_shields', 'private round shield state exists');
select has_table('private', 'point_card_mutations', 'private point-card mutation audit exists');

select has_column('public', 'rounds', 'action_deadline', 'rounds store the shared action deadline');
select has_column('public', 'round_cards_private', 'current_value_source_player_id', 'current card ownership remains traceable');
select has_column('public', 'score_ledger', 'action_draw_id', 'ledger entries can reference action draws');
select has_column('public', 'score_ledger', 'reason_code', 'ledger entries identify their action reason');
select has_column('public', 'action_draws', 'private_effect_result', 'draws store actor-private results');
select has_column('public', 'action_draws', 'public_safe_result', 'draws store public-safe results');
select has_column('public', 'action_draws', 'target_deadline', 'targeted draws store a server deadline');

select col_is_fk('public', 'action_draws', array['room_id', 'round_id'], 'draws bind to their room and round');
select col_is_fk('public', 'action_draws', array['room_id', 'player_id'], 'draws bind to their actor');
select col_is_fk('public', 'score_ledger', 'action_draw_id', 'action ledger rows bind to a draw');
select col_is_fk('private', 'point_card_mutations', 'action_draw_id', 'card mutations bind to a draw');

select has_index('public', 'action_choices', 'action_choices_player_round_unique', 'one choice is allowed per player and round');
select has_index('public', 'action_choices', 'action_choices_idempotency_unique', 'choice replay keys are unique per room');
select has_index('public', 'action_draws', 'action_draws_player_round_unique', 'one draw is allowed per player and round');
select has_index('public', 'action_draws', 'action_draws_idempotency_unique', 'draw replay keys are unique per room');
select has_index('public', 'score_ledger', 'score_ledger_action_draw_player_reason_key', 'action score mutations cannot apply twice');

select ok((select relrowsecurity from pg_class where oid = 'public.action_choices'::regclass), 'action choices have RLS enabled');
select ok((select relforcerowsecurity from pg_class where oid = 'public.action_choices'::regclass), 'action choices force RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.action_draws'::regclass), 'action draws have RLS enabled');
select ok((select relforcerowsecurity from pg_class where oid = 'public.action_draws'::regclass), 'action draws force RLS');

select is((select count(*) from private.action_card_catalog where enabled), 18::bigint, 'all 18 initial cards are enabled');
select is((select sum(weight) from private.action_card_catalog where category = 'positive'), 40::bigint, 'positive card weight totals 40');
select is((select sum(weight) from private.action_card_catalog where category = 'negative'), 30::bigint, 'negative card weight totals 30');
select is((select sum(weight) from private.action_card_catalog where category = 'unpredictable'), 30::bigint, 'unpredictable card weight totals 30');

select has_function('public', 'submit_action_choice', array['uuid', 'action_choice_type', 'uuid'], 'Draw or Skip RPC exists');
select has_function('public', 'submit_action_target', array['uuid', 'uuid', 'uuid', 'uuid'], 'target submission RPC exists');
select has_function('public', 'process_expired_action_phase', array['uuid', 'uuid'], 'action deadline RPC exists');
select has_function('public', 'process_expired_action_target', array['uuid', 'uuid', 'uuid'], 'target deadline RPC exists');
select has_function('public', 'get_action_state_snapshot', array['uuid'], 'private action snapshot RPC exists');
select ok(not has_function_privilege('authenticated', 'private.select_action_card()', 'execute'), 'authenticated clients cannot invoke deterministic card selection');
select ok(not has_table_privilege('authenticated', 'private.action_card_catalog', 'update'), 'authenticated clients cannot alter the deck catalog');

select * from finish();
rollback;
