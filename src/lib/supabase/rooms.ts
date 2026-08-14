import type { SupabaseClient } from "@supabase/supabase-js";
import { lockInInputSchema } from "../../game/core/contracts";
import {
  createRoomInputSchema,
  joinRoomInputSchema,
  leaveRoomInputSchema,
  lobbySnapshotSchema,
  playerRemovalInputSchema,
  readyStateInputSchema,
  roomErrorCodes,
  startGameInputSchema,
  type CreateRoomInput,
  type JoinRoomInput,
  type LobbySnapshot,
  type RoomErrorCode,
} from "../../game/lobby/contracts";

const REQUEST_TIMEOUT_MS = 10_000;

export class RoomOperationError extends Error {
  constructor(
    public readonly code: RoomErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "RoomOperationError";
  }
}

function extractErrorCode(message: string): RoomErrorCode {
  return (
    roomErrorCodes.find((code) => message.includes(code)) ?? "UNKNOWN_ERROR"
  );
}

async function withTimeout<T>(operation: PromiseLike<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new RoomOperationError("OPERATION_TIMEOUT")),
          REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function runSnapshotRpc(
  client: SupabaseClient,
  functionName: string,
  parameters: Record<string, unknown>,
): Promise<LobbySnapshot> {
  const { data, error } = await withTimeout(
    client.rpc(functionName, parameters),
  );
  if (error)
    throw new RoomOperationError(
      extractErrorCode(error.message),
      error.message,
    );
  const parsed = lobbySnapshotSchema.safeParse(data);
  if (!parsed.success)
    throw new RoomOperationError(
      "UNKNOWN_ERROR",
      "The lobby response was invalid.",
    );
  return parsed.data;
}

export function createRoom(client: SupabaseClient, input: CreateRoomInput) {
  const parsed = createRoomInputSchema.parse(input);
  return runSnapshotRpc(client, "create_room", {
    p_display_name: parsed.displayName,
    p_max_players: parsed.maxPlayers,
    p_total_rounds: parsed.totalRounds,
    p_turn_timer_seconds: parsed.turnTimerSeconds,
    p_password: parsed.password,
    p_request_id: parsed.requestId,
  });
}

export function joinRoom(client: SupabaseClient, input: JoinRoomInput) {
  const parsed = joinRoomInputSchema.parse(input);
  return runSnapshotRpc(client, "join_room", {
    p_room_code: parsed.roomCode,
    p_display_name: parsed.displayName,
    p_password: parsed.password,
  });
}

export function fetchLobby(client: SupabaseClient, roomId: string) {
  const parsed = startGameInputSchema.parse({ roomId });
  return runSnapshotRpc(client, "get_lobby_snapshot", {
    p_room_id: parsed.roomId,
  });
}

export function setReadyState(
  client: SupabaseClient,
  roomId: string,
  ready: boolean,
) {
  const parsed = readyStateInputSchema.parse({ roomId, ready });
  return runSnapshotRpc(client, "set_ready_state", {
    p_room_id: parsed.roomId,
    p_ready: parsed.ready,
  });
}

export function startRoom(client: SupabaseClient, roomId: string) {
  const parsed = startGameInputSchema.parse({ roomId });
  return runSnapshotRpc(client, "start_room", { p_room_id: parsed.roomId });
}

export function leaveRoom(client: SupabaseClient, roomId: string) {
  const parsed = leaveRoomInputSchema.parse({ roomId });
  return withTimeout(
    client.rpc("leave_room", { p_room_id: parsed.roomId }),
  ).then(({ error }) => {
    if (error)
      throw new RoomOperationError(
        extractErrorCode(error.message),
        error.message,
      );
  });
}

export function removePlayer(
  client: SupabaseClient,
  roomId: string,
  playerId: string,
) {
  const parsed = playerRemovalInputSchema.parse({ roomId, playerId });
  return runSnapshotRpc(client, "remove_lobby_player", {
    p_room_id: parsed.roomId,
    p_player_id: parsed.playerId,
  });
}

export function heartbeatRoom(client: SupabaseClient, roomId: string) {
  const parsed = startGameInputSchema.parse({ roomId });
  return runSnapshotRpc(client, "heartbeat_room", {
    p_room_id: parsed.roomId,
  });
}

export function requestRematch(
  client: SupabaseClient,
  roomId: string,
  idempotencyKey: string,
) {
  const parsed = lockInInputSchema.parse({ roomId, idempotencyKey });
  return runSnapshotRpc(client, "request_rematch", {
    p_room_id: parsed.roomId,
    p_idempotency_key: parsed.idempotencyKey,
  });
}

export async function markRoomDisconnected(
  client: SupabaseClient,
  roomId: string,
) {
  const parsed = startGameInputSchema.parse({ roomId });
  const { error } = await client.rpc("mark_room_disconnected", {
    p_room_id: parsed.roomId,
  });
  if (error)
    throw new RoomOperationError(
      extractErrorCode(error.message),
      error.message,
    );
}
