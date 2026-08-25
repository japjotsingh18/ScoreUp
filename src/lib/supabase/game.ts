import type { SupabaseClient } from "@supabase/supabase-js";
import {
  actionChoiceInputSchema,
  actionTargetInputSchema,
  actionTimeoutInputSchema,
  challengeInputSchema,
  championshipSubmissionInputSchema,
  gameErrorCodes,
  lockInInputSchema,
  matchRoomInputSchema,
  matchSnapshotSchema,
  miniGameChallengeInputSchema,
  miniGameSubmissionInputSchema,
  timeoutInputSchema,
  type GameErrorCode,
  type MatchSnapshot,
  type MiniGameStakeType,
  type ActionChoiceType,
} from "../../game/core/contracts";

const REQUEST_TIMEOUT_MS = 10_000;

export class GameOperationError extends Error {
  constructor(
    public readonly code: GameErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "GameOperationError";
  }
}

function errorCode(message: string): GameErrorCode {
  return (
    gameErrorCodes.find((code) => message.includes(code)) ?? "UNKNOWN_ERROR"
  );
}

async function withTimeout<T>(operation: PromiseLike<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new GameOperationError("OPERATION_TIMEOUT")),
          REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function runGameRpc(
  client: SupabaseClient,
  functionName: string,
  parameters: Record<string, unknown>,
): Promise<MatchSnapshot> {
  const { data, error } = await withTimeout(
    client.rpc(functionName, parameters),
  );
  if (error)
    throw new GameOperationError(errorCode(error.message), error.message);
  const parsed = matchSnapshotSchema.safeParse(data);
  if (!parsed.success)
    throw new GameOperationError("UNKNOWN_ERROR", "Invalid match response.");
  return parsed.data;
}

export function startMatch(client: SupabaseClient, roomId: string) {
  const input = matchRoomInputSchema.parse({ roomId });
  return runGameRpc(client, "start_room", { p_room_id: input.roomId });
}

export function fetchMatch(client: SupabaseClient, roomId: string) {
  const input = matchRoomInputSchema.parse({ roomId });
  return runGameRpc(client, "get_match_snapshot", { p_room_id: input.roomId });
}

export function lockIn(
  client: SupabaseClient,
  roomId: string,
  idempotencyKey: string,
) {
  const input = lockInInputSchema.parse({ roomId, idempotencyKey });
  return runGameRpc(client, "lock_in_point_card", {
    p_room_id: input.roomId,
    p_idempotency_key: input.idempotencyKey,
  });
}

export function challenge(
  client: SupabaseClient,
  roomId: string,
  targetPlayerId: string,
  idempotencyKey: string,
) {
  const input = challengeInputSchema.parse({
    roomId,
    targetPlayerId,
    idempotencyKey,
  });
  return runGameRpc(client, "challenge_point_card", {
    p_room_id: input.roomId,
    p_target_player_id: input.targetPlayerId,
    p_idempotency_key: input.idempotencyKey,
  });
}

export function processTimeout(
  client: SupabaseClient,
  roomId: string,
  expectedTurnPlayerId: string,
  idempotencyKey: string,
) {
  const input = timeoutInputSchema.parse({
    roomId,
    expectedTurnPlayerId,
    idempotencyKey,
  });
  return runGameRpc(client, "process_expired_turn", {
    p_room_id: input.roomId,
    p_expected_turn_player_id: input.expectedTurnPlayerId,
    p_idempotency_key: input.idempotencyKey,
  });
}

export function advanceRound(
  client: SupabaseClient,
  roomId: string,
  idempotencyKey: string,
) {
  const input = lockInInputSchema.parse({ roomId, idempotencyKey });
  return runGameRpc(client, "advance_round_summary", {
    p_room_id: input.roomId,
    p_idempotency_key: input.idempotencyKey,
  });
}

export function setRoundSummaryReady(
  client: SupabaseClient,
  roomId: string,
  ready: boolean,
  idempotencyKey: string,
) {
  const input = lockInInputSchema.parse({ roomId, idempotencyKey });
  return runGameRpc(client, "set_round_summary_ready", {
    p_room_id: input.roomId,
    p_ready: ready,
    p_idempotency_key: input.idempotencyKey,
  });
}

export function submitActionChoice(
  client: SupabaseClient,
  roomId: string,
  choice: ActionChoiceType,
  idempotencyKey: string,
) {
  const input = actionChoiceInputSchema.parse({
    roomId,
    choice,
    idempotencyKey,
  });
  return runGameRpc(client, "submit_action_choice", {
    p_room_id: input.roomId,
    p_choice: input.choice,
    p_idempotency_key: input.idempotencyKey,
  });
}

export function submitActionTarget(
  client: SupabaseClient,
  roomId: string,
  actionDrawId: string,
  targetPlayerId: string,
  idempotencyKey: string,
) {
  const input = actionTargetInputSchema.parse({
    roomId,
    actionDrawId,
    targetPlayerId,
    idempotencyKey,
  });
  return runGameRpc(client, "submit_action_target", {
    p_room_id: input.roomId,
    p_action_draw_id: input.actionDrawId,
    p_target_player_id: input.targetPlayerId,
    p_idempotency_key: input.idempotencyKey,
  });
}

export function processActionPhaseTimeout(
  client: SupabaseClient,
  roomId: string,
  idempotencyKey: string,
) {
  const input = lockInInputSchema.parse({ roomId, idempotencyKey });
  return runGameRpc(client, "process_expired_action_phase", {
    p_room_id: input.roomId,
    p_idempotency_key: input.idempotencyKey,
  });
}

export function processActionTargetTimeout(
  client: SupabaseClient,
  roomId: string,
  actionDrawId: string,
  idempotencyKey: string,
) {
  const input = actionTimeoutInputSchema.parse({
    roomId,
    actionDrawId,
    idempotencyKey,
  });
  return runGameRpc(client, "process_expired_action_target", {
    p_room_id: input.roomId,
    p_action_draw_id: input.actionDrawId,
    p_idempotency_key: input.idempotencyKey,
  });
}

export function requestMiniGameChallenge(
  client: SupabaseClient,
  roomId: string,
  opponentPlayerId: string,
  stakeType: MiniGameStakeType,
  idempotencyKey: string,
) {
  const input = miniGameChallengeInputSchema.parse({
    roomId,
    opponentPlayerId,
    stakeType,
    idempotencyKey,
  });
  return runGameRpc(client, "request_mini_game_challenge", {
    p_room_id: input.roomId,
    p_opponent_player_id: input.opponentPlayerId,
    p_stake_type: input.stakeType,
    p_idempotency_key: input.idempotencyKey,
  });
}

export function submitMiniGameResult(
  client: SupabaseClient,
  roomId: string,
  challengeId: string,
  result: Record<string, unknown>,
  idempotencyKey: string,
) {
  const input = miniGameSubmissionInputSchema.parse({
    roomId,
    challengeId,
    result,
    idempotencyKey,
  });
  return runGameRpc(client, "submit_mini_game_result", {
    p_room_id: input.roomId,
    p_challenge_id: input.challengeId,
    p_result_payload: input.result,
    p_idempotency_key: input.idempotencyKey,
  });
}

export function processMiniGameQueue(
  client: SupabaseClient,
  roomId: string,
  idempotencyKey: string,
) {
  const input = lockInInputSchema.parse({ roomId, idempotencyKey });
  return runGameRpc(client, "process_mini_game_queue", {
    p_room_id: input.roomId,
    p_idempotency_key: input.idempotencyKey,
  });
}

export function processMiniGameTimeout(
  client: SupabaseClient,
  roomId: string,
  idempotencyKey: string,
) {
  const input = lockInInputSchema.parse({ roomId, idempotencyKey });
  return runGameRpc(client, "process_expired_mini_game", {
    p_room_id: input.roomId,
    p_idempotency_key: input.idempotencyKey,
  });
}

export function submitChampionshipResult(
  client: SupabaseClient,
  roomId: string,
  result: { position: number; elapsedMs: number },
  idempotencyKey: string,
) {
  const input = championshipSubmissionInputSchema.parse({
    roomId,
    result,
    idempotencyKey,
  });
  return runGameRpc(client, "submit_championship_result", {
    p_room_id: input.roomId,
    p_result_payload: input.result,
    p_idempotency_key: input.idempotencyKey,
  });
}

export function processChampionshipTimeout(
  client: SupabaseClient,
  roomId: string,
  idempotencyKey: string,
) {
  const input = lockInInputSchema.parse({ roomId, idempotencyKey });
  return runGameRpc(client, "process_expired_championship", {
    p_room_id: input.roomId,
    p_idempotency_key: input.idempotencyKey,
  });
}
