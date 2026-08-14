type Issue = { message: string };

export class GameContractError extends Error {
  readonly issues: Issue[];

  constructor(message = "Invalid game response.") {
    super(message);
    this.name = "GameContractError";
    this.issues = [{ message }];
  }
}

export type GameSchema<T> = {
  parse(value: unknown): T;
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: GameContractError };
};

function schema<T>(parser: (value: unknown) => T): GameSchema<T> {
  return {
    parse: parser,
    safeParse(value) {
      try {
        return { success: true, data: parser(value) };
      } catch (cause) {
        return {
          success: false,
          error:
            cause instanceof GameContractError
              ? cause
              : new GameContractError(),
        };
      }
    },
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new GameContractError();
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new GameContractError();
  return value;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new GameContractError();
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new GameContractError();
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new GameContractError();
  return value;
}

function uuid(value: unknown): string {
  const parsed = string(value);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      parsed,
    )
  )
    throw new GameContractError();
  return parsed;
}

function date(value: unknown): string {
  const parsed = string(value);
  if (Number.isNaN(Date.parse(parsed))) throw new GameContractError();
  return parsed;
}

function nullable<T>(value: unknown, parser: (input: unknown) => T): T | null {
  return value === null ? null : parser(value);
}

function oneOf<T extends string | number>(
  value: unknown,
  values: readonly T[],
): T {
  if (!values.includes(value as T)) throw new GameContractError();
  return value as T;
}

export const gamePhases = [
  "dealing",
  "point_decisions",
  "round_summary",
  "completed",
] as const;
export type GamePhase = (typeof gamePhases)[number];

export const cardResolutionTypes = [
  "lock_in",
  "challenge_win",
  "challenge_loss",
  "challenge_tie",
  "auto_lock_in",
  "timeout",
] as const;
export type CardResolutionType = (typeof cardResolutionTypes)[number];
export type CardResolutionStatus = "unresolved" | "resolved";
export type PointDecisionType =
  "lock_in" | "challenge" | "auto_lock_in" | "timeout";

export const gameEventTypes = [
  "round_started",
  "turn_started",
  "player_locked_in",
  "challenge_started",
  "challenge_resolved",
  "timeout_occurred",
  "round_completed",
  "scores_updated",
  "match_completed",
] as const;
export type GameEventType = (typeof gameEventTypes)[number];

export type MatchPlayer = {
  id: string;
  displayName: string;
  score: number;
  rank: number;
  connected: boolean;
  isHost: boolean;
  isSelf: boolean;
  resolved: boolean;
  resolutionType: CardResolutionType | null;
};

export type PrivatePointCard = {
  originalValue: number;
  currentValue: number;
  resolutionStatus: CardResolutionStatus;
  resolutionType: CardResolutionType | null;
  pointsAwarded: number;
  resolvedAt: string | null;
};

export type PrivatePlayerState = {
  playerId: string;
  card: PrivatePointCard | null;
  actionDrawAllowance: number;
  actionDrawsUsed: number;
  miniGameTokenUsed: boolean;
};

export type PublicGameEvent = {
  sequence: number;
  roundNumber: number | null;
  type: GameEventType;
  actorPlayerId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type RoundSummary = {
  roundNumber: number;
  completedAt: string;
  cards: Array<{
    playerId: string;
    originalValue: number;
    currentValue: number;
    resolutionType: CardResolutionType;
    pointsAwarded: number;
  }>;
  decisions: Array<{
    actingPlayerId: string;
    targetPlayerId: string | null;
    decisionType: PointDecisionType;
    result: Record<string, unknown>;
    resolvedAt: string;
  }>;
};

export type MatchSnapshot = {
  room: {
    id: string;
    roomCode: string;
    status: "in_progress" | "completed";
    totalRounds: 6 | 8 | 10;
    turnTimerSeconds: 20 | 30 | 45 | 60;
    currentRound: number;
    phase: GamePhase;
    currentTurnPlayerId: string | null;
    phaseDeadline: string | null;
    matchVersion: number;
    startedAt: string;
    completedAt: string | null;
    tiebreakerRequired: boolean;
  };
  players: MatchPlayer[];
  round: {
    id: string;
    number: number;
    phase: GamePhase;
    status: "active" | "completed";
    decisionOrder: string[];
    currentTurnIndex: number | null;
    currentTurnPlayerId: string | null;
    phaseDeadline: string | null;
    turnDeadline: string | null;
    startedAt: string;
    completedAt: string | null;
  };
  privatePlayer: PrivatePlayerState;
  eligibleChallengeTargetIds: string[];
  roundSummaries: RoundSummary[];
  recentEvents: PublicGameEvent[];
  serverTime: string;
};

function parseCard(value: unknown): PrivatePointCard {
  const card = object(value);
  const status = oneOf(card.resolutionStatus, [
    "unresolved",
    "resolved",
  ] as const);
  return {
    originalValue: integer(card.originalValue),
    currentValue: integer(card.currentValue),
    resolutionStatus: status,
    resolutionType: nullable(card.resolutionType, (item) =>
      oneOf(item, cardResolutionTypes),
    ),
    pointsAwarded: integer(card.pointsAwarded),
    resolvedAt: nullable(card.resolvedAt, date),
  };
}

function parseEvent(value: unknown): PublicGameEvent {
  const event = object(value);
  return {
    sequence: integer(event.sequence),
    roundNumber: nullable(event.roundNumber, integer),
    type: oneOf(event.type, gameEventTypes),
    actorPlayerId: nullable(event.actorPlayerId, uuid),
    payload: object(event.payload),
    createdAt: date(event.createdAt),
  };
}

function parseSummary(value: unknown): RoundSummary {
  const summary = object(value);
  return {
    roundNumber: integer(summary.roundNumber),
    completedAt: date(summary.completedAt),
    cards: array(summary.cards).map((item) => {
      const card = object(item);
      return {
        playerId: uuid(card.playerId),
        originalValue: integer(card.originalValue),
        currentValue: integer(card.currentValue),
        resolutionType: oneOf(card.resolutionType, cardResolutionTypes),
        pointsAwarded: integer(card.pointsAwarded),
      };
    }),
    decisions: array(summary.decisions).map((item) => {
      const decision = object(item);
      return {
        actingPlayerId: uuid(decision.actingPlayerId),
        targetPlayerId: nullable(decision.targetPlayerId, uuid),
        decisionType: oneOf(decision.decisionType, [
          "lock_in",
          "challenge",
          "auto_lock_in",
          "timeout",
        ] as const),
        result: object(decision.result),
        resolvedAt: date(decision.resolvedAt),
      };
    }),
  };
}

export const matchSnapshotSchema = schema<MatchSnapshot>((value) => {
  const snapshot = object(value);
  const room = object(snapshot.room);
  const round = object(snapshot.round);
  const privatePlayer = object(snapshot.privatePlayer);
  return {
    room: {
      id: uuid(room.id),
      roomCode: string(room.roomCode),
      status: oneOf(room.status, ["in_progress", "completed"] as const),
      totalRounds: oneOf(room.totalRounds, [6, 8, 10] as const),
      turnTimerSeconds: oneOf(room.turnTimerSeconds, [20, 30, 45, 60] as const),
      currentRound: integer(room.currentRound),
      phase: oneOf(room.phase, gamePhases),
      currentTurnPlayerId: nullable(room.currentTurnPlayerId, uuid),
      phaseDeadline: nullable(room.phaseDeadline, date),
      matchVersion: integer(room.matchVersion),
      startedAt: date(room.startedAt),
      completedAt: nullable(room.completedAt, date),
      tiebreakerRequired: boolean(room.tiebreakerRequired),
    },
    players: array(snapshot.players).map((item) => {
      const player = object(item);
      return {
        id: uuid(player.id),
        displayName: string(player.displayName),
        score: integer(player.score),
        rank: integer(player.rank),
        connected: boolean(player.connected),
        isHost: boolean(player.isHost),
        isSelf: boolean(player.isSelf),
        resolved: boolean(player.resolved),
        resolutionType: nullable(player.resolutionType, (resolution) =>
          oneOf(resolution, cardResolutionTypes),
        ),
      };
    }),
    round: {
      id: uuid(round.id),
      number: integer(round.number),
      phase: oneOf(round.phase, gamePhases),
      status: oneOf(round.status, ["active", "completed"] as const),
      decisionOrder: array(round.decisionOrder).map(uuid),
      currentTurnIndex: nullable(round.currentTurnIndex, integer),
      currentTurnPlayerId: nullable(round.currentTurnPlayerId, uuid),
      phaseDeadline: nullable(round.phaseDeadline, date),
      turnDeadline: nullable(round.turnDeadline, date),
      startedAt: date(round.startedAt),
      completedAt: nullable(round.completedAt, date),
    },
    privatePlayer: {
      playerId: uuid(privatePlayer.playerId),
      card: privatePlayer.card === null ? null : parseCard(privatePlayer.card),
      actionDrawAllowance: integer(privatePlayer.actionDrawAllowance),
      actionDrawsUsed: integer(privatePlayer.actionDrawsUsed),
      miniGameTokenUsed: boolean(privatePlayer.miniGameTokenUsed),
    },
    eligibleChallengeTargetIds: array(snapshot.eligibleChallengeTargetIds).map(
      uuid,
    ),
    roundSummaries: array(snapshot.roundSummaries).map(parseSummary),
    recentEvents: array(snapshot.recentEvents).map(parseEvent),
    serverTime: date(snapshot.serverTime),
  };
});

export const matchRoomInputSchema = schema<{ roomId: string }>((value) => ({
  roomId: uuid(object(value).roomId),
}));
export const lockInInputSchema = schema<{
  roomId: string;
  idempotencyKey: string;
}>((value) => {
  const input = object(value);
  return {
    roomId: uuid(input.roomId),
    idempotencyKey: uuid(input.idempotencyKey),
  };
});
export const challengeInputSchema = schema<{
  roomId: string;
  targetPlayerId: string;
  idempotencyKey: string;
}>((value) => {
  const input = object(value);
  return {
    roomId: uuid(input.roomId),
    targetPlayerId: uuid(input.targetPlayerId),
    idempotencyKey: uuid(input.idempotencyKey),
  };
});
export const timeoutInputSchema = schema<{
  roomId: string;
  expectedTurnPlayerId: string;
  idempotencyKey: string;
}>((value) => {
  const input = object(value);
  return {
    roomId: uuid(input.roomId),
    expectedTurnPlayerId: uuid(input.expectedTurnPlayerId),
    idempotencyKey: uuid(input.idempotencyKey),
  };
});

export const gameErrorCodes = [
  "NOT_MATCH_PARTICIPANT",
  "MATCH_NOT_FOUND",
  "WRONG_PHASE",
  "WRONG_TURN",
  "TURN_EXPIRED",
  "ALREADY_RESOLVED",
  "TARGET_RESOLVED",
  "SELF_CHALLENGE",
  "INVALID_TARGET",
  "IDEMPOTENCY_CONFLICT",
  "DEADLINE_NOT_EXPIRED",
  "STALE_TURN",
  "OPERATION_TIMEOUT",
  "UNKNOWN_ERROR",
] as const;
export type GameErrorCode = (typeof gameErrorCodes)[number];

export const gameErrorMessages: Record<GameErrorCode, string> = {
  NOT_MATCH_PARTICIPANT: "You are no longer a participant in this match.",
  MATCH_NOT_FOUND: "This match is no longer available.",
  WRONG_PHASE: "That action is not available in the current phase.",
  WRONG_TURN: "Wait for your turn before choosing an action.",
  TURN_EXPIRED: "Your turn expired. Processing the automatic Lock In…",
  ALREADY_RESOLVED: "Your point card has already been resolved.",
  TARGET_RESOLVED: "That player’s point card is already resolved.",
  SELF_CHALLENGE: "Choose another unresolved player to challenge.",
  INVALID_TARGET: "That player is not an eligible challenge target.",
  IDEMPOTENCY_CONFLICT: "That request identifier was already used.",
  DEADLINE_NOT_EXPIRED: "The server deadline has not expired yet.",
  STALE_TURN: "The turn already advanced. Refreshing the match…",
  OPERATION_TIMEOUT: "The request took too long. Check your connection.",
  UNKNOWN_ERROR: "The game could not process that action. Please retry.",
};
