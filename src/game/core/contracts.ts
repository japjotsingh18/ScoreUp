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
  "action_choice",
  "point_decisions",
  "mini_game_resolution",
  "round_summary",
  "finalizing",
  "championship_tiebreaker",
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
  "action_phase_started",
  "action_target_required",
  "action_card_resolved",
  "action_skipped",
  "action_auto_skipped",
  "action_phase_completed",
  "mini_game_requested",
  "mini_game_started",
  "mini_game_submission_received",
  "mini_game_tiebreaker_started",
  "mini_game_resolved",
  "mini_game_queue_advanced",
  "mini_game_phase_completed",
  "match_finalizing",
  "championship_tiebreaker_started",
  "championship_submission_received",
  "championship_resolved",
  "rematch_created",
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

export const actionCardCategories = [
  "positive",
  "negative",
  "unpredictable",
] as const;
export type ActionCardCategory = (typeof actionCardCategories)[number];

export const actionCardCodes = [
  "score_boost",
  "double_up",
  "point_swipe",
  "shield",
  "fresh_draw",
  "bonus_momentum",
  "point_penalty",
  "bad_move",
  "forced_share",
  "score_drop",
  "empty_round",
  "leader_bonus",
  "double_or_zero",
  "random_card_swap",
  "shared_fate",
  "comeback_card",
  "mystery_multiplier",
  "reverse_swipe",
] as const;
export type ActionCardCode = (typeof actionCardCodes)[number];
export type ActionChoiceType = "draw" | "skip";
export type ActionDrawStatus = "selected" | "awaiting_target" | "resolved";

export type ActionDrawSnapshot = {
  id: string;
  cardCode: ActionCardCode;
  displayName: string;
  category: ActionCardCategory;
  description: string;
  status: ActionDrawStatus;
  targetPlayerId: string | null;
  targetDeadline: string | null;
  eligibleTargetIds: string[];
  privateResult: Record<string, unknown>;
  publicResult: Record<string, unknown>;
  drawnAt: string;
  resolvedAt: string | null;
};

export type ActionState = {
  phaseDeadline: string | null;
  respondedCount: number;
  participantCount: number;
  drawsRemaining: number;
  shieldActive: boolean;
  choice: {
    choice: ActionChoiceType;
    automatic: boolean;
    createdAt: string;
  } | null;
  draw: ActionDrawSnapshot | null;
};

export const miniGameTypes = [
  "stop_bar",
  "memory_sequence",
  "different_symbol",
] as const;
export type MiniGameType = (typeof miniGameTypes)[number];
export type MiniGameStakeType = "half" | "all";
export type MiniGameValidationStatus = "accepted" | "rejected";
export type MiniGameChallengeStatus =
  | "queued"
  | "active"
  | "tiebreaker_active"
  | "resolved"
  | "cancelled"
  | "refunded";
export type MiniGameResolutionMethod =
  | "game_result"
  | "opponent_timeout"
  | "opponent_invalid"
  | "tiebreaker_result"
  | "random_fallback"
  | "server_refund";

export type StopBarSpecification = {
  type: "stop_bar";
  targetPosition: number;
  markerSpeed: number;
  initialDirection: 1 | -1;
  maximumDurationMs: number;
};
export type MemorySequenceSpecification = {
  type: "memory_sequence";
  symbols: Array<"star" | "circle" | "triangle" | "diamond">;
  sequence: Array<"star" | "circle" | "triangle" | "diamond">;
  displayIntervalMs: number;
  maximumDurationMs: number;
};
export type DifferentSymbolSpecification = {
  type: "different_symbol";
  gridSize: number;
  cells: Array<"circle" | "diamond">;
  incorrectTapPenaltyMs: number;
  maximumDurationMs: number;
};
export type MiniGameSpecification =
  | StopBarSpecification
  | MemorySequenceSpecification
  | DifferentSymbolSpecification;

export type MiniGameChallengeSnapshot = {
  id: string;
  status: MiniGameChallengeStatus;
  queuePosition: number;
  challengerPlayerId: string;
  opponentPlayerId: string;
  isChallenger: boolean;
  stakeType: MiniGameStakeType;
  stakePerPlayer: number | null;
  pot: number | null;
  gameType: MiniGameType | null;
  attempt: 1 | 2;
  startsAt: string | null;
  submissionDeadline: string | null;
  specification: MiniGameSpecification | null;
  ownSubmitted: boolean;
  opponentSubmitted: boolean;
  winnerPlayerId: string | null;
  resolutionMethod: MiniGameResolutionMethod | null;
  completedAt: string | null;
  cancellationReason: string | null;
};

export type PublicMiniGameChallengeSnapshot = {
  id: string;
  status: "active" | "tiebreaker_active";
  challengerPlayerId: string;
  opponentPlayerId: string;
  stakeType: MiniGameStakeType;
  stakePerPlayer: number;
  pot: number;
  gameType: MiniGameType;
  attempt: 1 | 2;
};

export type MiniGameState = {
  tokenAvailable: boolean;
  eligibleOpponentIds: string[];
  roomQueueCount: number;
  roomHasActiveChallenge: boolean;
  challenge: MiniGameChallengeSnapshot | null;
  publicChallenge: PublicMiniGameChallengeSnapshot | null;
};

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
  scoreChanges: Array<{
    playerId: string;
    pointsChanged: number;
  }>;
  miniGames: Array<{
    id: string;
    challengerPlayerId: string;
    opponentPlayerId: string;
    stakeType: MiniGameStakeType;
    stakePerPlayer: number | null;
    pot: number | null;
    gameType: MiniGameType | null;
    attempt: 1 | 2;
    status: MiniGameChallengeStatus;
    winnerPlayerId: string | null;
    resolutionMethod: MiniGameResolutionMethod | null;
    challengerScoreChange: number;
    opponentScoreChange: number;
    results: Array<{
      playerId: string;
      validationStatus: MiniGameValidationStatus;
      elapsedMs: number | null;
      primaryScore: number | null;
      secondaryScore: number | null;
    }>;
  }>;
};

export type ChampionshipResolutionMethod =
  "skill" | "timing" | "timeout" | "secure_fallback";

export type ChampionshipSnapshot = {
  status: "active" | "resolved";
  isParticipant: boolean;
  participantIds: string[];
  startsAt: string;
  submissionDeadline: string;
  specification: StopBarSpecification | null;
  ownSubmitted: boolean;
  submittedCount: number;
  participantCount: number;
  winnerPlayerId: string | null;
  resolutionMethod: ChampionshipResolutionMethod | null;
};

export const matchStatCategories = [
  "lock_in_points",
  "biggest_point_challenge",
  "action_draws",
  "mini_game_wins",
  "biggest_comeback",
] as const;
export type MatchStatCategory = (typeof matchStatCategories)[number];

export type MatchResultSnapshot = {
  winnerPlayerId: string;
  resolutionMethod: ChampionshipResolutionMethod;
  completedAt: string;
  rankings: Array<{
    playerId: string;
    score: number;
    rank: number;
    displayOrder: number;
  }>;
  statistics: Array<{
    category: MatchStatCategory;
    playerId: string;
    value: number;
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
  actionState: ActionState;
  miniGameState: MiniGameState;
  completionState: {
    phase: GamePhase;
    tiebreaker: ChampionshipSnapshot | null;
    result: MatchResultSnapshot | null;
    rematchRoomId: string | null;
  };
  summaryReadyState: {
    ownReady: boolean;
    readyCount: number;
    participantCount: number;
  };
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

function parseActionState(value: unknown): ActionState {
  const state = object(value);
  const choice = state.choice === null ? null : object(state.choice);
  const draw = state.draw === null ? null : object(state.draw);
  return {
    phaseDeadline: nullable(state.phaseDeadline, date),
    respondedCount: integer(state.respondedCount),
    participantCount: integer(state.participantCount),
    drawsRemaining: integer(state.drawsRemaining),
    shieldActive: boolean(state.shieldActive),
    choice: choice
      ? {
          choice: oneOf(choice.choice, ["draw", "skip"] as const),
          automatic: boolean(choice.automatic),
          createdAt: date(choice.createdAt),
        }
      : null,
    draw: draw
      ? {
          id: uuid(draw.id),
          cardCode: oneOf(draw.cardCode, actionCardCodes),
          displayName: string(draw.displayName),
          category: oneOf(draw.category, actionCardCategories),
          description: string(draw.description),
          status: oneOf(draw.status, [
            "selected",
            "awaiting_target",
            "resolved",
          ] as const),
          targetPlayerId: nullable(draw.targetPlayerId, uuid),
          targetDeadline: nullable(draw.targetDeadline, date),
          eligibleTargetIds: array(draw.eligibleTargetIds).map(uuid),
          privateResult: object(draw.privateResult),
          publicResult: object(draw.publicResult),
          drawnAt: date(draw.drawnAt),
          resolvedAt: nullable(draw.resolvedAt, date),
        }
      : null,
  };
}

const miniSymbols = ["star", "circle", "triangle", "diamond"] as const;

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new GameContractError();
  return value;
}

function parseMiniGameSpecification(value: unknown): MiniGameSpecification {
  const specification = object(value);
  const type = oneOf(specification.type, miniGameTypes);
  if (type === "stop_bar") {
    return {
      type,
      targetPosition: number(specification.targetPosition),
      markerSpeed: number(specification.markerSpeed),
      initialDirection: oneOf(specification.initialDirection, [1, -1] as const),
      maximumDurationMs: integer(specification.maximumDurationMs),
    };
  }
  if (type === "memory_sequence") {
    return {
      type,
      symbols: array(specification.symbols).map((item) =>
        oneOf(item, miniSymbols),
      ),
      sequence: array(specification.sequence).map((item) =>
        oneOf(item, miniSymbols),
      ),
      displayIntervalMs: integer(specification.displayIntervalMs),
      maximumDurationMs: integer(specification.maximumDurationMs),
    };
  }
  return {
    type,
    gridSize: integer(specification.gridSize),
    cells: array(specification.cells).map((item) =>
      oneOf(item, ["circle", "diamond"] as const),
    ),
    incorrectTapPenaltyMs: integer(specification.incorrectTapPenaltyMs),
    maximumDurationMs: integer(specification.maximumDurationMs),
  };
}

function parseMiniGameState(value: unknown): MiniGameState {
  const state = object(value);
  const challenge = state.challenge === null ? null : object(state.challenge);
  const publicChallenge =
    state.publicChallenge === null ? null : object(state.publicChallenge);
  return {
    tokenAvailable: boolean(state.tokenAvailable),
    eligibleOpponentIds: array(state.eligibleOpponentIds).map(uuid),
    roomQueueCount: integer(state.roomQueueCount),
    roomHasActiveChallenge: boolean(state.roomHasActiveChallenge),
    challenge: challenge
      ? {
          id: uuid(challenge.id),
          status: oneOf(challenge.status, [
            "queued",
            "active",
            "tiebreaker_active",
            "resolved",
            "cancelled",
            "refunded",
          ] as const),
          queuePosition: integer(challenge.queuePosition),
          challengerPlayerId: uuid(challenge.challengerPlayerId),
          opponentPlayerId: uuid(challenge.opponentPlayerId),
          isChallenger: boolean(challenge.isChallenger),
          stakeType: oneOf(challenge.stakeType, ["half", "all"] as const),
          stakePerPlayer: nullable(challenge.stakePerPlayer, integer),
          pot: nullable(challenge.pot, integer),
          gameType: nullable(challenge.gameType, (item) =>
            oneOf(item, miniGameTypes),
          ),
          attempt: oneOf(challenge.attempt, [1, 2] as const),
          startsAt: nullable(challenge.startsAt, date),
          submissionDeadline: nullable(challenge.submissionDeadline, date),
          specification:
            challenge.specification === null
              ? null
              : parseMiniGameSpecification(challenge.specification),
          ownSubmitted: boolean(challenge.ownSubmitted),
          opponentSubmitted: boolean(challenge.opponentSubmitted),
          winnerPlayerId: nullable(challenge.winnerPlayerId, uuid),
          resolutionMethod: nullable(challenge.resolutionMethod, (item) =>
            oneOf(item, [
              "game_result",
              "opponent_timeout",
              "opponent_invalid",
              "tiebreaker_result",
              "random_fallback",
              "server_refund",
            ] as const),
          ),
          completedAt: nullable(challenge.completedAt, date),
          cancellationReason: nullable(challenge.cancellationReason, string),
        }
      : null,
    publicChallenge: publicChallenge
      ? {
          id: uuid(publicChallenge.id),
          status: oneOf(publicChallenge.status, [
            "active",
            "tiebreaker_active",
          ] as const),
          challengerPlayerId: uuid(publicChallenge.challengerPlayerId),
          opponentPlayerId: uuid(publicChallenge.opponentPlayerId),
          stakeType: oneOf(publicChallenge.stakeType, ["half", "all"] as const),
          stakePerPlayer: integer(publicChallenge.stakePerPlayer),
          pot: integer(publicChallenge.pot),
          gameType: oneOf(publicChallenge.gameType, miniGameTypes),
          attempt: oneOf(publicChallenge.attempt, [1, 2] as const),
        }
      : null,
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
    scoreChanges: array(summary.scoreChanges).map((item) => {
      const change = object(item);
      return {
        playerId: uuid(change.playerId),
        pointsChanged: integer(change.pointsChanged),
      };
    }),
    miniGames: array(summary.miniGames).map((item) => {
      const miniGame = object(item);
      return {
        id: uuid(miniGame.id),
        challengerPlayerId: uuid(miniGame.challengerPlayerId),
        opponentPlayerId: uuid(miniGame.opponentPlayerId),
        stakeType: oneOf(miniGame.stakeType, ["half", "all"] as const),
        stakePerPlayer: nullable(miniGame.stakePerPlayer, integer),
        pot: nullable(miniGame.pot, integer),
        gameType: nullable(miniGame.gameType, (game) =>
          oneOf(game, miniGameTypes),
        ),
        attempt: oneOf(miniGame.attempt, [1, 2] as const),
        status: oneOf(miniGame.status, [
          "queued",
          "active",
          "tiebreaker_active",
          "resolved",
          "cancelled",
          "refunded",
        ] as const),
        winnerPlayerId: nullable(miniGame.winnerPlayerId, uuid),
        resolutionMethod: nullable(miniGame.resolutionMethod, (method) =>
          oneOf(method, [
            "game_result",
            "opponent_timeout",
            "opponent_invalid",
            "tiebreaker_result",
            "random_fallback",
            "server_refund",
          ] as const),
        ),
        challengerScoreChange: integer(miniGame.challengerScoreChange),
        opponentScoreChange: integer(miniGame.opponentScoreChange),
        results: array(miniGame.results).map((item) => {
          const result = object(item);
          return {
            playerId: uuid(result.playerId),
            validationStatus: oneOf(result.validationStatus, [
              "accepted",
              "rejected",
            ] as const),
            elapsedMs: nullable(result.elapsedMs, integer),
            primaryScore: nullable(result.primaryScore, integer),
            secondaryScore: nullable(result.secondaryScore, integer),
          };
        }),
      };
    }),
  };
}

const championshipResolutionMethods = [
  "skill",
  "timing",
  "timeout",
  "secure_fallback",
] as const;

function parseCompletionState(
  value: unknown,
): MatchSnapshot["completionState"] {
  const state = object(value);
  const tiebreaker =
    state.tiebreaker === null ? null : object(state.tiebreaker);
  const result = state.result === null ? null : object(state.result);
  return {
    phase: oneOf(state.phase, gamePhases),
    tiebreaker: tiebreaker
      ? {
          status: oneOf(tiebreaker.status, ["active", "resolved"] as const),
          isParticipant: boolean(tiebreaker.isParticipant),
          participantIds: array(tiebreaker.participantIds).map(uuid),
          startsAt: date(tiebreaker.startsAt),
          submissionDeadline: date(tiebreaker.submissionDeadline),
          specification:
            tiebreaker.specification === null
              ? null
              : (() => {
                  const parsed = parseMiniGameSpecification(
                    tiebreaker.specification,
                  );
                  if (parsed.type !== "stop_bar") throw new GameContractError();
                  return parsed;
                })(),
          ownSubmitted: boolean(tiebreaker.ownSubmitted),
          submittedCount: integer(tiebreaker.submittedCount),
          participantCount: integer(tiebreaker.participantCount),
          winnerPlayerId: nullable(tiebreaker.winnerPlayerId, uuid),
          resolutionMethod: nullable(tiebreaker.resolutionMethod, (item) =>
            oneOf(item, championshipResolutionMethods),
          ),
        }
      : null,
    result: result
      ? {
          winnerPlayerId: uuid(result.winnerPlayerId),
          resolutionMethod: oneOf(
            result.resolutionMethod,
            championshipResolutionMethods,
          ),
          completedAt: date(result.completedAt),
          rankings: array(result.rankings).map((item) => {
            const ranking = object(item);
            return {
              playerId: uuid(ranking.playerId),
              score: integer(ranking.score),
              rank: integer(ranking.rank),
              displayOrder: integer(ranking.displayOrder),
            };
          }),
          statistics: array(result.statistics).map((item) => {
            const statistic = object(item);
            return {
              category: oneOf(statistic.category, matchStatCategories),
              playerId: uuid(statistic.playerId),
              value: integer(statistic.value),
            };
          }),
        }
      : null,
    rematchRoomId: nullable(state.rematchRoomId, uuid),
  };
}

export const matchSnapshotSchema = schema<MatchSnapshot>((value) => {
  const snapshot = object(value);
  const room = object(snapshot.room);
  const round = object(snapshot.round);
  const privatePlayer = object(snapshot.privatePlayer);
  const summaryReadyState = object(snapshot.summaryReadyState);
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
    actionState: parseActionState(snapshot.actionState),
    miniGameState: parseMiniGameState(snapshot.miniGameState),
    completionState: parseCompletionState(snapshot.completionState),
    summaryReadyState: {
      ownReady: boolean(summaryReadyState.ownReady),
      readyCount: integer(summaryReadyState.readyCount),
      participantCount: integer(summaryReadyState.participantCount),
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

export const actionChoiceInputSchema = schema<{
  roomId: string;
  choice: ActionChoiceType;
  idempotencyKey: string;
}>((value) => {
  const input = object(value);
  return {
    roomId: uuid(input.roomId),
    choice: oneOf(input.choice, ["draw", "skip"] as const),
    idempotencyKey: uuid(input.idempotencyKey),
  };
});

export const actionTargetInputSchema = schema<{
  roomId: string;
  actionDrawId: string;
  targetPlayerId: string;
  idempotencyKey: string;
}>((value) => {
  const input = object(value);
  return {
    roomId: uuid(input.roomId),
    actionDrawId: uuid(input.actionDrawId),
    targetPlayerId: uuid(input.targetPlayerId),
    idempotencyKey: uuid(input.idempotencyKey),
  };
});

export const actionTimeoutInputSchema = schema<{
  roomId: string;
  actionDrawId: string;
  idempotencyKey: string;
}>((value) => {
  const input = object(value);
  return {
    roomId: uuid(input.roomId),
    actionDrawId: uuid(input.actionDrawId),
    idempotencyKey: uuid(input.idempotencyKey),
  };
});

export const miniGameChallengeInputSchema = schema<{
  roomId: string;
  opponentPlayerId: string;
  stakeType: MiniGameStakeType;
  idempotencyKey: string;
}>((value) => {
  const input = object(value);
  return {
    roomId: uuid(input.roomId),
    opponentPlayerId: uuid(input.opponentPlayerId),
    stakeType: oneOf(input.stakeType, ["half", "all"] as const),
    idempotencyKey: uuid(input.idempotencyKey),
  };
});

export const miniGameSubmissionInputSchema = schema<{
  roomId: string;
  challengeId: string;
  result: Record<string, unknown>;
  idempotencyKey: string;
}>((value) => {
  const input = object(value);
  const result = object(input.result);
  if (JSON.stringify(result).length > 512) throw new GameContractError();
  return {
    roomId: uuid(input.roomId),
    challengeId: uuid(input.challengeId),
    result,
    idempotencyKey: uuid(input.idempotencyKey),
  };
});

export const championshipSubmissionInputSchema = schema<{
  roomId: string;
  result: { position: number; elapsedMs: number };
  idempotencyKey: string;
}>((value) => {
  const input = object(value);
  const result = object(input.result);
  const position = number(result.position);
  const elapsedMs = integer(result.elapsedMs);
  if (position < 0 || position > 1 || elapsedMs < 0 || elapsedMs > 10000)
    throw new GameContractError();
  return {
    roomId: uuid(input.roomId),
    result: { position, elapsedMs },
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
  "ACTION_ALLOWANCE_EXHAUSTED",
  "ACTION_DEADLINE_EXPIRED",
  "ACTION_DRAW_NOT_FOUND",
  "ACTION_ALREADY_RESOLVED",
  "TARGET_DEADLINE_EXPIRED",
  "NO_ELIGIBLE_TARGET",
  "MINI_GAME_TOKEN_USED",
  "SELF_MINI_GAME_CHALLENGE",
  "ZERO_STAKE",
  "MINI_GAME_PARTICIPANT_BUSY",
  "MINI_GAME_NOT_FOUND",
  "NOT_MINI_GAME_PARTICIPANT",
  "CHALLENGE_NOT_ACTIVE",
  "MINI_GAME_NOT_STARTED",
  "MINI_GAME_DEADLINE_EXPIRED",
  "MINI_GAME_ALREADY_SUBMITTED",
  "INSUFFICIENT_SCORE",
  "CHAMPIONSHIP_NOT_STARTED",
  "NOT_CHAMPIONSHIP_PARTICIPANT",
  "CHAMPIONSHIP_ALREADY_SUBMITTED",
  "DEADLINE_EXPIRED",
  "MATCH_NOT_COMPLETED",
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
  ACTION_ALLOWANCE_EXHAUSTED:
    "You have no Mystery Action Card draws remaining.",
  ACTION_DEADLINE_EXPIRED:
    "The action phase ended. Processing automatic skips…",
  ACTION_DRAW_NOT_FOUND: "That action-card draw is no longer available.",
  ACTION_ALREADY_RESOLVED: "That action card has already resolved.",
  TARGET_DEADLINE_EXPIRED:
    "Target selection expired. The server is choosing securely…",
  NO_ELIGIBLE_TARGET: "No eligible target remains for this action card.",
  MINI_GAME_TOKEN_USED:
    "Your one Mini-Game Challenge token has already been used.",
  SELF_MINI_GAME_CHALLENGE:
    "Choose another player for the Mini-Game Challenge.",
  ZERO_STAKE: "Both players need available score for a matched stake.",
  MINI_GAME_PARTICIPANT_BUSY:
    "One of those players is already in this round’s Mini-Game queue.",
  MINI_GAME_NOT_FOUND: "That Mini-Game Challenge is no longer available.",
  NOT_MINI_GAME_PARTICIPANT:
    "Only the two challenged players can submit this result.",
  CHALLENGE_NOT_ACTIVE: "That Mini-Game Challenge is not active.",
  MINI_GAME_NOT_STARTED: "Wait for the synchronized Mini-Game start.",
  MINI_GAME_DEADLINE_EXPIRED:
    "The Mini-Game deadline expired. Processing the result…",
  MINI_GAME_ALREADY_SUBMITTED:
    "Your result for this attempt is already locked.",
  INSUFFICIENT_SCORE: "The matched stake is no longer available.",
  CHAMPIONSHIP_NOT_STARTED: "Wait for the synchronized championship start.",
  NOT_CHAMPIONSHIP_PARTICIPANT:
    "Only tied first-place finalists can submit this championship result.",
  CHAMPIONSHIP_ALREADY_SUBMITTED: "Your championship result is already locked.",
  DEADLINE_EXPIRED: "The championship deadline has expired.",
  MATCH_NOT_COMPLETED: "The final result is not ready for a rematch.",
  OPERATION_TIMEOUT: "The request took too long. Check your connection.",
  UNKNOWN_ERROR: "The game could not process that action. Please retry.",
};
