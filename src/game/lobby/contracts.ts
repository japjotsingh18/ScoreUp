type ValidationIssue = { message: string };

export class ContractValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(message: string) {
    super(message);
    this.name = "ContractValidationError";
    this.issues = [{ message }];
  }
}

export type ValidationSchema<T> = {
  parse(value: unknown): T;
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: ContractValidationError };
};

function schema<T>(parser: (value: unknown) => T): ValidationSchema<T> {
  return {
    parse: parser,
    safeParse(value) {
      try {
        return { success: true, data: parser(value) };
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof ContractValidationError
              ? error
              : new ContractValidationError("Invalid input."),
        };
      }
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ContractValidationError("Invalid input.");
  return value as Record<string, unknown>;
}

function string(value: unknown, message = "Invalid input."): string {
  if (typeof value !== "string") throw new ContractValidationError(message);
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw new ContractValidationError("Invalid input.");
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new ContractValidationError("Invalid input.");
  return value;
}

function uuid(value: unknown): string {
  const parsed = string(value);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      parsed,
    )
  )
    throw new ContractValidationError("Invalid input.");
  return parsed;
}

function isoDate(value: unknown): string {
  const parsed = string(value);
  if (Number.isNaN(Date.parse(parsed)))
    throw new ContractValidationError("Invalid input.");
  return parsed;
}

function displayName(value: unknown): string {
  const parsed = string(
    value,
    "Use a display name between 2 and 20 characters.",
  )
    .trim()
    .replace(/\s+/g, " ");
  if (parsed.length < 2 || parsed.length > 20)
    throw new ContractValidationError(
      "Use a display name between 2 and 20 characters.",
    );
  if (/[\u0000-\u001f\u007f]/.test(parsed))
    throw new ContractValidationError(
      "Display names cannot contain control characters.",
    );
  return parsed;
}

function roomCode(value: unknown): string {
  const parsed = string(value)
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/.test(parsed))
    throw new ContractValidationError(
      "Enter the 5-character room code from your host.",
    );
  return parsed;
}

function oneOf<T extends number | string>(
  value: unknown,
  values: readonly T[],
): T {
  if (!values.includes(value as T))
    throw new ContractValidationError("Invalid input.");
  return value as T;
}

export type CreateRoomInput = {
  displayName: string;
  maxPlayers: number;
  totalRounds: number;
  turnTimerSeconds: number;
  password?: string | null;
  requestId: string;
};

export type CreateRoomCommandInput = {
  displayName: string;
  maxPlayers: number;
  totalRounds: 6 | 8 | 10;
  turnTimerSeconds: 20 | 30 | 45 | 60;
  password: string | null;
  requestId: string;
};

export type JoinRoomInput = {
  roomCode: string;
  displayName: string;
  password?: string | null;
};
export type JoinRoomCommandInput = {
  roomCode: string;
  displayName: string;
  password: string | null;
};

export const createRoomInputSchema = schema<CreateRoomCommandInput>((value) => {
  const input = record(value);
  const password =
    input.password === undefined || input.password === null
      ? ""
      : string(input.password);
  if (password && (password.length < 4 || password.length > 64))
    throw new ContractValidationError(
      "Private room passwords need between 4 and 64 characters.",
    );
  const maxPlayers = integer(input.maxPlayers);
  if (maxPlayers < 2 || maxPlayers > 10)
    throw new ContractValidationError("Choose between 2 and 10 players.");
  return {
    displayName: displayName(input.displayName),
    maxPlayers,
    totalRounds: oneOf(input.totalRounds, [6, 8, 10] as const),
    turnTimerSeconds: oneOf(input.turnTimerSeconds, [20, 30, 45, 60] as const),
    password: password || null,
    requestId: uuid(input.requestId),
  };
});

export const joinRoomInputSchema = schema<JoinRoomCommandInput>((value) => {
  const input = record(value);
  const password =
    input.password === undefined || input.password === null
      ? ""
      : string(input.password);
  if (password.length > 64)
    throw new ContractValidationError(
      "Room passwords cannot exceed 64 characters.",
    );
  return {
    roomCode: roomCode(input.roomCode),
    displayName: displayName(input.displayName),
    password: password || null,
  };
});

export const roomCodeSchema = schema<string>(roomCode);
export const readyStateInputSchema = schema<{ roomId: string; ready: boolean }>(
  (value) => {
    const input = record(value);
    return { roomId: uuid(input.roomId), ready: boolean(input.ready) };
  },
);
export const startGameInputSchema = schema<{ roomId: string }>((value) => ({
  roomId: uuid(record(value).roomId),
}));
export const leaveRoomInputSchema = startGameInputSchema;
export const playerRemovalInputSchema = schema<{
  roomId: string;
  playerId: string;
}>((value) => {
  const input = record(value);
  return { roomId: uuid(input.roomId), playerId: uuid(input.playerId) };
});

export type LobbyPlayer = {
  id: string;
  displayName: string;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  isSelf: boolean;
  joinedAt: string;
  lastSeenAt: string;
  disconnectedAt: string | null;
};

export type LobbySnapshot = {
  room: {
    id: string;
    roomCode: string;
    status: "lobby" | "starting" | "in_progress" | "completed";
    maxPlayers: number;
    totalRounds: 6 | 8 | 10;
    turnTimerSeconds: 20 | 30 | 45 | 60;
    hasPassword: boolean;
    hostPlayerId: string;
  };
  players: LobbyPlayer[];
  selfPlayerId: string;
  serverTime: string;
};

export const lobbyPlayerSchema = schema<LobbyPlayer>((value) => {
  const player = record(value);
  return {
    id: uuid(player.id),
    displayName: displayName(player.displayName),
    ready: boolean(player.ready),
    connected: boolean(player.connected),
    isHost: boolean(player.isHost),
    isSelf: boolean(player.isSelf),
    joinedAt: isoDate(player.joinedAt),
    lastSeenAt: isoDate(player.lastSeenAt),
    disconnectedAt:
      player.disconnectedAt === null ? null : isoDate(player.disconnectedAt),
  };
});

export const lobbySnapshotSchema = schema<LobbySnapshot>((value) => {
  const snapshot = record(value);
  const room = record(snapshot.room);
  const players = snapshot.players;
  if (!Array.isArray(players))
    throw new ContractValidationError("Invalid lobby response.");
  const maxPlayers = integer(room.maxPlayers);
  if (maxPlayers < 2 || maxPlayers > 10)
    throw new ContractValidationError("Invalid lobby response.");
  return {
    room: {
      id: uuid(room.id),
      roomCode: roomCode(room.roomCode),
      status: oneOf(room.status, [
        "lobby",
        "starting",
        "in_progress",
        "completed",
      ] as const),
      maxPlayers,
      totalRounds: oneOf(room.totalRounds, [6, 8, 10] as const),
      turnTimerSeconds: oneOf(room.turnTimerSeconds, [20, 30, 45, 60] as const),
      hasPassword: boolean(room.hasPassword),
      hostPlayerId: uuid(room.hostPlayerId),
    },
    players: players.map((player) => lobbyPlayerSchema.parse(player)),
    selfPlayerId: uuid(snapshot.selfPlayerId),
    serverTime: isoDate(snapshot.serverTime),
  };
});

export const roomErrorCodes = [
  "AUTH_REQUIRED",
  "ANONYMOUS_AUTH_REQUIRED",
  "INVALID_INPUT",
  "ROOM_NOT_FOUND",
  "ROOM_ACCESS_DENIED",
  "ROOM_FULL",
  "ROOM_STARTED",
  "DUPLICATE_NAME",
  "NOT_ROOM_MEMBER",
  "HOST_ONLY",
  "MINIMUM_PLAYERS",
  "PLAYERS_NOT_READY",
  "RATE_LIMITED",
  "OPERATION_TIMEOUT",
  "SUPABASE_UNAVAILABLE",
  "UNKNOWN_ERROR",
] as const;

export type RoomErrorCode = (typeof roomErrorCodes)[number];

export const roomErrorMessages: Record<RoomErrorCode, string> = {
  AUTH_REQUIRED: "Your anonymous session expired. Retry to reconnect.",
  ANONYMOUS_AUTH_REQUIRED:
    "ScoreUp requires a temporary anonymous game session.",
  INVALID_INPUT: "Check the room details and try again.",
  ROOM_NOT_FOUND: "That room code does not exist or is no longer available.",
  ROOM_ACCESS_DENIED: "The room password is incorrect.",
  ROOM_FULL: "That room is already full.",
  ROOM_STARTED: "That match has already started.",
  DUPLICATE_NAME: "That display name is already taken in this room.",
  NOT_ROOM_MEMBER: "You no longer have access to this room.",
  HOST_ONLY: "Only the current host can do that.",
  MINIMUM_PLAYERS: "At least two connected players are required to start.",
  PLAYERS_NOT_READY:
    "Every connected player must be ready before the match begins.",
  RATE_LIMITED: "Too many attempts. Wait a minute and try again.",
  OPERATION_TIMEOUT:
    "The request took too long. Check your connection and retry.",
  SUPABASE_UNAVAILABLE:
    "Multiplayer is not configured for this environment yet.",
  UNKNOWN_ERROR: "Something went wrong. Please retry.",
};
