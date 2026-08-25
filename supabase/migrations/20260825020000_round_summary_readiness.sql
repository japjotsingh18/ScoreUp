-- Give every round summary a 15-second ceiling while allowing all
-- participants to agree to continue sooner.

alter table public.players
  add column summary_ready_round smallint;

alter function private.build_match_snapshot(uuid, uuid)
  rename to build_pre_summary_readiness_snapshot;

create or replace function private.build_match_snapshot(
  p_room_id uuid,
  p_user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select private.build_pre_summary_readiness_snapshot(p_room_id, p_user_id) value
  ), room_state as (
    select room.current_round, room.current_phase
    from public.rooms room
    where room.id = p_room_id
  )
  select base.value || jsonb_build_object(
    'summaryReadyState', jsonb_build_object(
      'ownReady', coalesce((
        select player.summary_ready_round = room_state.current_round
        from public.players player, room_state
        where player.room_id = p_room_id
          and player.auth_user_id = p_user_id
          and player.match_participant
          and player.left_at is null
      ), false),
      'readyCount', (
        select count(*)
        from public.players player, room_state
        where player.room_id = p_room_id
          and player.match_participant
          and player.left_at is null
          and room_state.current_phase = 'round_summary'
          and player.summary_ready_round = room_state.current_round
      ),
      'participantCount', (
        select count(*)
        from public.players player
        where player.room_id = p_room_id
          and player.match_participant
          and player.left_at is null
      )
    )
  )
  from base;
$$;

revoke all on function private.build_match_snapshot(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.build_pre_summary_readiness_snapshot(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.set_round_summary_ready(
  p_room_id uuid,
  p_ready boolean,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_anonymous_user();
  v_room public.rooms%rowtype;
begin
  if p_ready is null or p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  select * into strict v_room
  from public.rooms
  where id = p_room_id
  for update;

  if not private.is_match_participant(p_room_id, v_user_id) then
    raise exception using errcode = 'P0001', message = 'NOT_MATCH_PARTICIPANT';
  end if;
  if v_room.status = 'completed' or v_room.current_phase <> 'round_summary' then
    return private.build_match_snapshot(p_room_id, v_user_id);
  end if;

  update public.players
  set summary_ready_round = case when p_ready then v_room.current_round else null end
  where room_id = p_room_id
    and auth_user_id = v_user_id
    and match_participant
    and left_at is null;

  if p_ready and not exists (
    select 1
    from public.players player
    where player.room_id = p_room_id
      and player.match_participant
      and player.left_at is null
      and player.summary_ready_round is distinct from v_room.current_round
  ) then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_room_id::text || ':summary-ready', 0)
    );
    perform private.begin_core_round(
      p_room_id,
      (v_room.current_round + 1)::smallint
    );
    insert into private.core_operation_receipts (
      room_id, operation, idempotency_key
    ) values (
      p_room_id, 'advance_round', p_idempotency_key
    ) on conflict do nothing;
  end if;

  return private.build_match_snapshot(p_room_id, v_user_id);
end;
$$;

revoke all on function public.set_round_summary_ready(uuid, boolean, uuid)
  from public, anon;
grant execute on function public.set_round_summary_ready(uuid, boolean, uuid)
  to authenticated;

-- Normalize every non-final round-summary deadline to 15 seconds. This runs
-- at the authoritative room phase transition, regardless of how the round
-- reached its summary.
create or replace function private.enforce_round_summary_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.current_phase = 'round_summary'
     and old.current_phase is distinct from 'round_summary' then
    new.phase_deadline := statement_timestamp() + interval '15 seconds';
  end if;
  return new;
end;
$$;

create trigger rooms_enforce_round_summary_deadline
before update on public.rooms
for each row execute function private.enforce_round_summary_deadline();
