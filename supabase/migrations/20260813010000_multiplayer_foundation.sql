create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.room_status as enum ('lobby', 'starting', 'in_progress', 'completed');

create table public.rooms (
  id uuid primary key default extensions.gen_random_uuid(),
  room_code text not null,
  host_player_id uuid not null,
  status public.room_status not null default 'lobby',
  max_players smallint not null check (max_players between 2 and 10),
  total_rounds smallint not null check (total_rounds in (6, 8, 10)),
  turn_timer_seconds smallint not null check (turn_timer_seconds in (20, 30, 45, 60)),
  password_hash text,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  creation_request_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  constraint rooms_code_format check (room_code ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$'),
  constraint rooms_password_hash_shape check (password_hash is null or password_hash like '$2%'),
  constraint rooms_creation_idempotency unique (created_by_user_id, creation_request_id)
);

create unique index rooms_room_code_key on public.rooms (room_code);
create index rooms_status_created_at_idx on public.rooms (status, created_at);

create table public.players (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  display_name text not null,
  ready boolean not null default false,
  connected boolean not null default true,
  is_host boolean not null default false,
  join_order bigint generated always as identity,
  joined_at timestamptz not null default statement_timestamp(),
  last_seen_at timestamptz not null default statement_timestamp(),
  disconnected_at timestamptz,
  left_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  constraint players_display_name_length check (char_length(display_name) between 2 and 20),
  constraint players_display_name_controls check (display_name !~ '[[:cntrl:]]'),
  constraint players_room_auth_unique unique (room_id, auth_user_id),
  constraint players_room_id_id_unique unique (room_id, id)
);

create unique index players_active_display_name_key
  on public.players (room_id, lower(display_name))
  where left_at is null;
create unique index players_one_active_host_key
  on public.players (room_id)
  where is_host and left_at is null;
create index players_active_room_idx on public.players (room_id, join_order) where left_at is null;
create index players_auth_user_idx on public.players (auth_user_id, room_id);

alter table public.rooms
  add constraint rooms_host_belongs_to_room
  foreign key (id, host_player_id)
  references public.players(room_id, id)
  deferrable initially deferred;

create table private.join_attempts (
  auth_user_id uuid not null,
  room_code text not null,
  window_started_at timestamptz not null default statement_timestamp(),
  attempt_count integer not null default 1 check (attempt_count > 0),
  primary key (auth_user_id, room_code)
);

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

create trigger rooms_touch_updated_at
before update on public.rooms
for each row execute function private.touch_updated_at();

create trigger players_touch_updated_at
before update on public.players
for each row execute function private.touch_updated_at();

create or replace function private.require_anonymous_user()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true then
    raise exception using errcode = 'P0001', message = 'ANONYMOUS_AUTH_REQUIRED';
  end if;
  return v_user_id;
end;
$$;

create or replace function private.normalize_display_name(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g');
$$;

create or replace function private.generate_room_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(5);
  v_code text := '';
begin
  for v_index in 0..4 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_index) % length(v_alphabet)) + 1, 1);
  end loop;
  return v_code;
end;
$$;

create or replace function private.is_room_member(p_room_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.players p
    where p.room_id = p_room_id
      and p.auth_user_id = p_user_id
      and p.left_at is null
  );
$$;

create or replace function private.enforce_join_rate_limit(p_user_id uuid, p_room_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  insert into private.join_attempts (auth_user_id, room_code)
  values (p_user_id, p_room_code)
  on conflict (auth_user_id, room_code) do update
  set
    window_started_at = case
      when private.join_attempts.window_started_at < statement_timestamp() - interval '60 seconds'
        then statement_timestamp()
      else private.join_attempts.window_started_at
    end,
    attempt_count = case
      when private.join_attempts.window_started_at < statement_timestamp() - interval '60 seconds'
        then 1
      else private.join_attempts.attempt_count + 1
    end
  returning attempt_count into v_attempts;

  if v_attempts > 8 then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED';
  end if;
end;
$$;

create or replace function private.transfer_host_if_needed(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host public.players%rowtype;
  v_next_host_id uuid;
begin
  select p.* into v_host
  from public.players p
  join public.rooms r on r.host_player_id = p.id and r.id = p.room_id
  where p.room_id = p_room_id
  for update of p;

  if v_host.id is null then
    return;
  end if;

  if v_host.left_at is null
     and (v_host.connected or v_host.disconnected_at is null or v_host.disconnected_at > statement_timestamp() - interval '60 seconds') then
    return;
  end if;

  select p.id into v_next_host_id
  from public.players p
  where p.room_id = p_room_id
    and p.left_at is null
    and p.connected
  order by p.join_order
  limit 1
  for update;

  if v_next_host_id is null then
    return;
  end if;

  update public.players
  set is_host = (id = v_next_host_id)
  where room_id = p_room_id and (is_host or id = v_next_host_id);

  update public.rooms set host_player_id = v_next_host_id where id = p_room_id;
end;
$$;

create or replace function private.maintain_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.players
  set connected = false,
      disconnected_at = coalesce(disconnected_at, statement_timestamp())
  where room_id = p_room_id
    and left_at is null
    and connected
    and last_seen_at < statement_timestamp() - interval '35 seconds';

  perform private.transfer_host_if_needed(p_room_id);
end;
$$;

create or replace function private.build_lobby_snapshot(p_room_id uuid, p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'room', jsonb_build_object(
      'id', r.id,
      'roomCode', r.room_code,
      'status', r.status,
      'maxPlayers', r.max_players,
      'totalRounds', r.total_rounds,
      'turnTimerSeconds', r.turn_timer_seconds,
      'hasPassword', r.password_hash is not null,
      'hostPlayerId', r.host_player_id
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'displayName', p.display_name,
        'ready', p.ready,
        'connected', p.connected,
        'isHost', p.is_host,
        'isSelf', p.auth_user_id = p_user_id,
        'joinedAt', p.joined_at,
        'lastSeenAt', p.last_seen_at,
        'disconnectedAt', p.disconnected_at
      ) order by p.join_order)
      from public.players p
      where p.room_id = r.id and p.left_at is null
    ), '[]'::jsonb),
    'selfPlayerId', (
      select p.id from public.players p
      where p.room_id = r.id and p.auth_user_id = p_user_id and p.left_at is null
    ),
    'serverTime', statement_timestamp()
  )
  from public.rooms r
  where r.id = p_room_id
    and private.is_room_member(r.id, p_user_id);
$$;

create or replace function private.broadcast_lobby_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
begin
  -- Heartbeats update timestamps frequently, but those timestamps do not alter
  -- visible lobby state. Suppress their broadcasts to avoid an N² refetch loop.
  if tg_op = 'UPDATE' and tg_table_name = 'players' then
    if (old.display_name, old.ready, old.connected, old.is_host, old.left_at)
         is not distinct from
       (new.display_name, new.ready, new.connected, new.is_host, new.left_at) then
      return null;
    end if;
  end if;

  if tg_table_name = 'rooms' then
    v_room_id := coalesce(new.id, old.id);
  else
    v_room_id := coalesce(new.room_id, old.room_id);
  end if;
  perform realtime.send(
    jsonb_build_object('changed', true),
    'lobby_changed',
    'room:' || v_room_id::text || ':lobby',
    true
  );
  return null;
end;
$$;

create trigger rooms_broadcast_lobby_change
after insert or update or delete on public.rooms
for each row execute function private.broadcast_lobby_change();

create trigger players_broadcast_lobby_change
after insert or update or delete on public.players
for each row execute function private.broadcast_lobby_change();

create or replace function public.create_room(
  p_display_name text,
  p_max_players integer,
  p_total_rounds integer,
  p_turn_timer_seconds integer,
  p_password text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_anonymous_user();
  v_name text := private.normalize_display_name(p_display_name);
  v_room_id uuid := extensions.gen_random_uuid();
  v_player_id uuid := extensions.gen_random_uuid();
  v_room_code text;
  v_existing_room_id uuid;
begin
  if char_length(v_name) not between 2 and 20 or v_name ~ '[[:cntrl:]]'
     or p_max_players not between 2 and 10
     or p_total_rounds not in (6, 8, 10)
     or p_turn_timer_seconds not in (20, 30, 45, 60)
     or p_request_id is null
     or (p_password is not null and char_length(p_password) not between 4 and 64) then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  -- Serialize retries for the same client command so concurrent double-clicks
  -- observe the first committed room instead of racing the unique constraint.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || p_request_id::text, 0)
  );

  select id into v_existing_room_id
  from public.rooms
  where created_by_user_id = v_user_id and creation_request_id = p_request_id;

  if v_existing_room_id is not null then
    return private.build_lobby_snapshot(v_existing_room_id, v_user_id);
  end if;

  -- Reuse the short server-only bucket for unique create commands as well as
  -- joins. Idempotent retries return above and do not consume this allowance.
  perform private.enforce_join_rate_limit(v_user_id, '__CREATE__');

  for v_attempt in 1..12 loop
    v_room_code := private.generate_room_code();
    begin
      insert into public.rooms (
        id, room_code, host_player_id, max_players, total_rounds,
        turn_timer_seconds, password_hash, created_by_user_id, creation_request_id
      ) values (
        v_room_id, v_room_code, v_player_id, p_max_players, p_total_rounds,
        p_turn_timer_seconds,
        case when p_password is null then null else extensions.crypt(p_password, extensions.gen_salt('bf', 10)) end,
        v_user_id, p_request_id
      );
      exit;
    exception when unique_violation then
      if v_attempt = 12 then raise; end if;
    end;
  end loop;

  insert into public.players (id, room_id, auth_user_id, display_name, ready, connected, is_host)
  values (v_player_id, v_room_id, v_user_id, v_name, true, true, true);

  return private.build_lobby_snapshot(v_room_id, v_user_id);
end;
$$;

create or replace function public.join_room(p_room_code text, p_display_name text, p_password text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_anonymous_user();
  v_code text := upper(regexp_replace(coalesce(p_room_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_name text := private.normalize_display_name(p_display_name);
  v_room public.rooms%rowtype;
  v_player public.players%rowtype;
  v_player_count integer;
begin
  if v_code !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$'
     or char_length(v_name) not between 2 and 20
     or v_name ~ '[[:cntrl:]]'
     or (p_password is not null and char_length(p_password) > 64) then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  perform private.enforce_join_rate_limit(v_user_id, v_code);

  select * into v_room from public.rooms where room_code = v_code for update;
  if v_room.id is null then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;
  if v_room.status <> 'lobby' then
    raise exception using errcode = 'P0001', message = 'ROOM_STARTED';
  end if;

  select * into v_player
  from public.players
  where room_id = v_room.id and auth_user_id = v_user_id
  for update;

  if v_player.id is not null and v_player.left_at is null then
    update public.players
    set connected = true, disconnected_at = null, last_seen_at = statement_timestamp()
    where id = v_player.id;
    perform private.maintain_room(v_room.id);
    return private.build_lobby_snapshot(v_room.id, v_user_id);
  end if;

  if v_room.password_hash is not null
     and (p_password is null or extensions.crypt(p_password, v_room.password_hash) <> v_room.password_hash) then
    raise exception using errcode = 'P0001', message = 'ROOM_ACCESS_DENIED';
  end if;

  select count(*) into v_player_count
  from public.players
  where room_id = v_room.id and left_at is null;
  if v_player_count >= v_room.max_players then
    raise exception using errcode = 'P0001', message = 'ROOM_FULL';
  end if;
  if exists (
    select 1 from public.players
    where room_id = v_room.id and left_at is null and lower(display_name) = lower(v_name)
  ) then
    raise exception using errcode = 'P0001', message = 'DUPLICATE_NAME';
  end if;

  if v_player.id is null then
    insert into public.players (room_id, auth_user_id, display_name)
    values (v_room.id, v_user_id, v_name);
  else
    update public.players
    set display_name = v_name,
        ready = false,
        connected = true,
        disconnected_at = null,
        left_at = null,
        last_seen_at = statement_timestamp()
    where id = v_player.id;
  end if;

  perform private.maintain_room(v_room.id);
  return private.build_lobby_snapshot(v_room.id, v_user_id);
end;
$$;

create or replace function public.get_lobby_snapshot(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_anonymous_user();
  v_result jsonb;
begin
  if not private.is_room_member(p_room_id, v_user_id) then
    raise exception using errcode = 'P0001', message = 'NOT_ROOM_MEMBER';
  end if;
  update public.players
  set connected = true, disconnected_at = null, last_seen_at = statement_timestamp()
  where room_id = p_room_id and auth_user_id = v_user_id and left_at is null;
  perform private.maintain_room(p_room_id);
  v_result := private.build_lobby_snapshot(p_room_id, v_user_id);
  if v_result is null then raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND'; end if;
  return v_result;
end;
$$;

create or replace function public.set_ready_state(p_room_id uuid, p_ready boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := private.require_anonymous_user();
begin
  if not exists (select 1 from public.rooms where id = p_room_id and status = 'lobby') then
    raise exception using errcode = 'P0001', message = 'ROOM_STARTED';
  end if;
  update public.players
  set ready = p_ready, connected = true, disconnected_at = null, last_seen_at = statement_timestamp()
  where room_id = p_room_id and auth_user_id = v_user_id and left_at is null;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_ROOM_MEMBER'; end if;
  perform private.maintain_room(p_room_id);
  return private.build_lobby_snapshot(p_room_id, v_user_id);
end;
$$;

create or replace function public.heartbeat_room(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := private.require_anonymous_user();
begin
  update public.players
  set connected = true, disconnected_at = null, last_seen_at = statement_timestamp()
  where room_id = p_room_id and auth_user_id = v_user_id and left_at is null;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_ROOM_MEMBER'; end if;
  perform private.maintain_room(p_room_id);
  return private.build_lobby_snapshot(p_room_id, v_user_id);
end;
$$;

create or replace function public.mark_room_disconnected(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := private.require_anonymous_user();
begin
  update public.players
  set connected = false, disconnected_at = statement_timestamp(), last_seen_at = statement_timestamp()
  where room_id = p_room_id and auth_user_id = v_user_id and left_at is null;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_ROOM_MEMBER'; end if;
end;
$$;

create or replace function public.start_room(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_anonymous_user();
  v_connected_count integer;
begin
  perform 1 from public.rooms where id = p_room_id and status = 'lobby' for update;
  if not found then raise exception using errcode = 'P0001', message = 'ROOM_STARTED'; end if;
  perform private.maintain_room(p_room_id);
  if not exists (
    select 1 from public.players
    where room_id = p_room_id and auth_user_id = v_user_id and is_host and left_at is null
  ) then raise exception using errcode = 'P0001', message = 'HOST_ONLY'; end if;

  select count(*) into v_connected_count from public.players
  where room_id = p_room_id and left_at is null and connected;
  if v_connected_count < 2 then raise exception using errcode = 'P0001', message = 'MINIMUM_PLAYERS'; end if;
  if exists (
    select 1 from public.players
    where room_id = p_room_id and left_at is null and connected and not ready
  ) then raise exception using errcode = 'P0001', message = 'PLAYERS_NOT_READY'; end if;

  update public.rooms set status = 'starting', started_at = statement_timestamp() where id = p_room_id;
  return private.build_lobby_snapshot(p_room_id, v_user_id);
end;
$$;

create or replace function public.remove_lobby_player(p_room_id uuid, p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := private.require_anonymous_user();
begin
  perform 1 from public.rooms where id = p_room_id and status = 'lobby' for update;
  if not found then raise exception using errcode = 'P0001', message = 'ROOM_STARTED'; end if;
  if not exists (
    select 1 from public.players
    where room_id = p_room_id and auth_user_id = v_user_id and is_host and left_at is null
  ) then raise exception using errcode = 'P0001', message = 'HOST_ONLY'; end if;
  if exists (
    select 1 from public.players where id = p_player_id and room_id = p_room_id and is_host
  ) then raise exception using errcode = 'P0001', message = 'INVALID_INPUT'; end if;

  update public.players
  set left_at = statement_timestamp(), connected = false, ready = false, disconnected_at = statement_timestamp()
  where id = p_player_id and room_id = p_room_id and left_at is null;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_ROOM_MEMBER'; end if;
  return private.build_lobby_snapshot(p_room_id, v_user_id);
end;
$$;

create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_anonymous_user();
  v_was_host boolean;
begin
  perform 1 from public.rooms where id = p_room_id for update;
  select is_host into v_was_host
  from public.players
  where room_id = p_room_id and auth_user_id = v_user_id and left_at is null
  for update;
  if v_was_host is null then raise exception using errcode = 'P0001', message = 'NOT_ROOM_MEMBER'; end if;

  update public.players
  set left_at = statement_timestamp(), connected = false, ready = false, disconnected_at = statement_timestamp()
  where room_id = p_room_id and auth_user_id = v_user_id and left_at is null;
  if v_was_host then perform private.transfer_host_if_needed(p_room_id); end if;
end;
$$;

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.rooms force row level security;
alter table public.players force row level security;

create policy rooms_member_select on public.rooms
for select to authenticated
using (private.is_room_member(id));

create policy players_room_member_select on public.players
for select to authenticated
using (private.is_room_member(room_id));

-- RLS policy expressions need access to this helper. The private schema is not
-- exposed by PostgREST, and all other private functions remain non-executable.
revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_room_member(uuid, uuid) to authenticated;

revoke all on table public.rooms, public.players from public, anon, authenticated;
grant select (id, room_code, host_player_id, status, max_players, total_rounds, turn_timer_seconds, created_at, updated_at, started_at, completed_at)
  on public.rooms to authenticated;
grant select (id, room_id, display_name, ready, connected, is_host, joined_at, last_seen_at, disconnected_at, updated_at)
  on public.players to authenticated;

revoke all on function public.create_room(text, integer, integer, integer, text, uuid) from public, anon;
revoke all on function public.join_room(text, text, text) from public, anon;
revoke all on function public.get_lobby_snapshot(uuid) from public, anon;
revoke all on function public.set_ready_state(uuid, boolean) from public, anon;
revoke all on function public.heartbeat_room(uuid) from public, anon;
revoke all on function public.mark_room_disconnected(uuid) from public, anon;
revoke all on function public.start_room(uuid) from public, anon;
revoke all on function public.remove_lobby_player(uuid, uuid) from public, anon;
revoke all on function public.leave_room(uuid) from public, anon;
grant execute on function public.create_room(text, integer, integer, integer, text, uuid) to authenticated;
grant execute on function public.join_room(text, text, text) to authenticated;
grant execute on function public.get_lobby_snapshot(uuid) to authenticated;
grant execute on function public.set_ready_state(uuid, boolean) to authenticated;
grant execute on function public.heartbeat_room(uuid) to authenticated;
grant execute on function public.mark_room_disconnected(uuid) to authenticated;
grant execute on function public.start_room(uuid) to authenticated;
grant execute on function public.remove_lobby_player(uuid, uuid) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;

create policy scoreup_lobby_broadcast_read
on realtime.messages for select to authenticated
using (
  realtime.topic() ~ '^room:[0-9a-f-]{36}:lobby$'
  and private.is_room_member(split_part(realtime.topic(), ':', 2)::uuid)
);

comment on column public.rooms.password_hash is
  'bcrypt-compatible pgcrypto hash containing its own salt; never granted or returned to clients';
comment on function public.create_room is
  'Atomic authenticated room + host creation. The request UUID makes retries idempotent.';
comment on function public.join_room is
  'Locks the room row to serialize capacity checks, password verification, and seat restoration.';
