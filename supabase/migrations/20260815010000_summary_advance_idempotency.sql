-- Milestone 7: make multi-client summary advancement a quiet idempotent race.

create or replace function public.advance_round_summary(
  p_room_id uuid,
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
  if p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not private.is_match_participant(p_room_id, v_user_id) then
    raise exception using errcode = 'P0001', message = 'NOT_MATCH_PARTICIPANT';
  end if;
  if exists (
    select 1 from private.core_operation_receipts
    where room_id = p_room_id and operation = 'advance_round'
      and idempotency_key = p_idempotency_key
  ) then
    return private.build_match_snapshot(p_room_id, v_user_id);
  end if;
  if v_room.status = 'completed' then
    return private.build_match_snapshot(p_room_id, v_user_id);
  end if;
  if v_room.current_phase <> 'round_summary' then
    insert into private.core_operation_receipts (
      room_id, operation, idempotency_key
    ) values (
      p_room_id, 'advance_round', p_idempotency_key
    ) on conflict do nothing;
    return private.build_match_snapshot(p_room_id, v_user_id);
  end if;
  if v_room.phase_deadline > statement_timestamp() then
    raise exception using errcode = 'P0001', message = 'DEADLINE_NOT_EXPIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_room_id::text || ':' || p_idempotency_key::text, 0)
  );
  perform private.begin_core_round(
    p_room_id,
    (v_room.current_round + 1)::smallint
  );
  insert into private.core_operation_receipts (
    room_id, operation, idempotency_key
  ) values (
    p_room_id, 'advance_round', p_idempotency_key
  );
  return private.build_match_snapshot(p_room_id, v_user_id);
end;
$$;
