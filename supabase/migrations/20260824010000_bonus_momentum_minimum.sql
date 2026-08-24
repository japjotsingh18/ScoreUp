update private.action_card_catalog
set public_description = 'Gain 15% of your current score, rounded to the nearest 50 (minimum 50 points).',
    effect_parameters = effect_parameters || '{"minimum":50}'::jsonb
where code = 'bonus_momentum';

create or replace function private.apply_action_score_delta(
  p_room_id uuid,
  p_round_id uuid,
  p_player_id uuid,
  p_action_draw_id uuid,
  p_requested_delta integer,
  p_reason_code text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before bigint;
  v_after bigint;
  v_actual integer;
  v_effective_delta integer := p_requested_delta;
begin
  select score into v_before from public.players
  where id = p_player_id and room_id = p_room_id and match_participant
  for update;
  if v_before is null then
    raise exception using errcode = 'P0001', message = 'INVALID_TARGET';
  end if;
  if p_reason_code = 'bonus_momentum' then
    v_effective_delta := greatest(50, v_effective_delta);
  end if;
  v_after := greatest(0, v_before + v_effective_delta);
  v_actual := (v_after - v_before)::integer;
  if v_actual <> 0 then
    update public.players set score = v_after where id = p_player_id;
    insert into public.score_ledger (
      room_id, round_id, player_id, decision_id, action_draw_id,
      delta, balance_after, source_key, reason_code
    ) values (
      p_room_id, p_round_id, p_player_id, null, p_action_draw_id,
      v_actual, v_after,
      'action:' || p_action_draw_id::text || ':' || p_player_id::text || ':' || p_reason_code,
      p_reason_code
    );
  end if;
  return v_actual;
end;
$$;
