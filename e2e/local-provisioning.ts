import { execFileSync } from "node:child_process";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DB_CONTAINER = "supabase_db_scoreup";

function assertLocal(roomId: string) {
  const target = new URL(
    process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173",
  );
  if (!["127.0.0.1", "localhost", "::1"].includes(target.hostname))
    throw new Error(
      "E2E provisioning is restricted to a loopback application URL.",
    );
  if (!UUID.test(roomId)) throw new Error("Invalid local room identifier.");
}

function sql(roomId: string, body: string) {
  assertLocal(roomId);
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      DB_CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input: `begin;\n${body}\ncommit;\n`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}

export function provisionFinalTie(roomId: string) {
  sql(
    roomId,
    `do $provision$
declare v_round uuid; v_round_number smallint;
begin
  select id, round_number into strict v_round, v_round_number from public.rounds
    where room_id = '${roomId}'::uuid order by round_number desc limit 1;
  update public.round_cards_private set round_number = 6, resolution_status = 'resolved',
    resolution_type = 'auto_lock_in', points_awarded = current_value,
    resolved_at = statement_timestamp() where round_id = v_round;
  update public.action_choices set round_number = 6 where round_id = v_round;
  update public.action_draws set round_number = 6 where round_id = v_round;
  update public.point_decisions set round_number = 6 where round_id = v_round;
  update public.mini_game_challenges set round_number = 6 where round_id = v_round;
  update public.game_events set round_number = 6 where room_id = '${roomId}'::uuid
    and round_number = v_round_number;
  update public.rounds set round_number = 6, phase = 'round_summary', status = 'completed',
    current_turn_index = null, current_turn_player_id = null, phase_deadline = null,
    turn_deadline = null, completed_at = statement_timestamp() where id = v_round;
  update public.players set score = 1000 where room_id = '${roomId}'::uuid and match_participant;
  update public.rooms set current_round = 6, current_phase = 'finalizing',
    current_turn_player_id = null, phase_deadline = null where id = '${roomId}'::uuid;
  perform private.finalize_match('${roomId}'::uuid);
  update public.championship_tiebreakers set starts_at = statement_timestamp() - interval '1 second',
    submission_deadline = statement_timestamp() + interval '12 seconds' where room_id = '${roomId}'::uuid;
  update public.rooms set phase_deadline = statement_timestamp() + interval '12 seconds' where id = '${roomId}'::uuid;
end;
$provision$;`,
  );
}

export function expireChampionship(roomId: string) {
  sql(
    roomId,
    `update public.championship_tiebreakers set submission_deadline = statement_timestamp() - interval '1 second'
      where room_id = '${roomId}'::uuid and status = 'active';
     update public.rooms set phase_deadline = statement_timestamp() - interval '1 second'
      where id = '${roomId}'::uuid;`,
  );
}

export function provisionVisiblePointCards(roomId: string) {
  sql(
    roomId,
    `update public.players set score = 100 where room_id = '${roomId}'::uuid and match_participant;
     update public.round_cards_private c set
       original_value = case when p.is_host then 100 else 1000 end,
       current_value = case when p.is_host then 100 else 1000 end
     from public.players p
     where c.room_id = '${roomId}'::uuid and c.player_id = p.id
       and c.resolution_status = 'unresolved';`,
  );
}

export function forceActiveMiniGameToStopBar(roomId: string) {
  sql(
    roomId,
    `do $provision$
declare
  v_challenge public.mini_game_challenges%rowtype;
  v_spec record;
  v_seed bytea := decode(repeat('2a', 32), 'hex');
begin
  select * into strict v_challenge from public.mini_game_challenges
  where room_id = '${roomId}'::uuid and status = 'active';
  select * into strict v_spec from private.generate_mini_game_spec('stop_bar', v_seed);
  update private.mini_game_specs set game_type = 'stop_bar', seed = v_seed,
    participant_spec = v_spec.participant_spec, expected_result = v_spec.expected_result
  where challenge_id = v_challenge.id and attempt = v_challenge.current_attempt;
  update public.mini_game_challenges set game_type = 'stop_bar',
    starts_at = statement_timestamp() - interval '1 second',
    submission_deadline = statement_timestamp() + interval '12 seconds'
  where id = v_challenge.id;
  update public.rooms set phase_deadline = statement_timestamp() + interval '12 seconds'
  where id = '${roomId}'::uuid;
end;
$provision$;`,
  );
}
