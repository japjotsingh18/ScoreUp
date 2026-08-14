begin;
set local search_path = public, extensions;

select plan(14);

select has_table('public', 'rooms', 'rooms table exists');
select has_table('public', 'players', 'players table exists');
select has_column('public', 'rooms', 'password_hash', 'room hashes are stored server-side');
select has_column('public', 'players', 'auth_user_id', 'players bind to Supabase Auth users');
select col_is_pk('public', 'rooms', 'id', 'rooms use UUID primary keys');
select col_is_pk('public', 'players', 'id', 'players use UUID primary keys');
select col_is_fk('public', 'players', 'room_id', 'players reference rooms');
select col_is_fk('public', 'players', 'auth_user_id', 'players reference auth users');
select ok((select relrowsecurity from pg_class where oid = 'public.rooms'::regclass), 'rooms has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.players'::regclass), 'players has RLS enabled');
select has_index('public', 'rooms', 'rooms_room_code_key', 'room codes are unique');
select has_index('public', 'players', 'players_active_display_name_key', 'active display names are case-insensitively unique');
select has_function('public', 'create_room', array['text', 'integer', 'integer', 'integer', 'text', 'uuid'], 'atomic create RPC exists');
select has_function('public', 'join_room', array['text', 'text', 'text'], 'atomic join RPC exists');

select * from finish();
rollback;

