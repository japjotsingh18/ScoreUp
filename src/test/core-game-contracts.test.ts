import { describe, expect, it } from "vitest";
import {
  actionChoiceInputSchema,
  actionTargetInputSchema,
  challengeInputSchema,
  championshipSubmissionInputSchema,
  matchSnapshotSchema,
  miniGameChallengeInputSchema,
  miniGameSubmissionInputSchema,
} from "../game/core/contracts";
import { matchFixture } from "./fixtures/match";

describe("core game contracts", () => {
  it("parses an actor-authorized match snapshot", () => {
    const snapshot = matchSnapshotSchema.parse(matchFixture);
    expect(snapshot.privatePlayer.card?.currentValue).toBe(750);
    expect(snapshot.players[1]).not.toHaveProperty("currentValue");
  });

  it("rejects malformed private-card values", () => {
    const parsed = matchSnapshotSchema.safeParse({
      ...matchFixture,
      privatePlayer: {
        ...matchFixture.privatePlayer,
        card: { ...matchFixture.privatePlayer.card, currentValue: "750" },
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("validates challenge command identifiers", () => {
    expect(
      challengeInputSchema.parse({
        roomId: matchFixture.room.id,
        targetPlayerId: matchFixture.players[1].id,
        idempotencyKey: "f6459f71-c29f-43d2-887c-a13f4d56a171",
      }),
    ).toEqual({
      roomId: matchFixture.room.id,
      targetPlayerId: matchFixture.players[1].id,
      idempotencyKey: "f6459f71-c29f-43d2-887c-a13f4d56a171",
    });
  });

  it("strictly parses actor-private action state", () => {
    const snapshot = matchSnapshotSchema.parse({
      ...matchFixture,
      room: { ...matchFixture.room, phase: "action_choice" },
      round: { ...matchFixture.round, phase: "action_choice" },
      actionState: {
        ...matchFixture.actionState,
        choice: {
          choice: "draw",
          automatic: false,
          createdAt: "2026-08-13T00:00:01Z",
        },
        draw: {
          id: "f6459f71-c29f-43d2-887c-a13f4d56a171",
          cardCode: "point_swipe",
          displayName: "Point Swipe",
          category: "positive",
          description:
            "Choose a player and transfer up to 300 points from them.",
          status: "awaiting_target",
          targetPlayerId: null,
          targetDeadline: "2026-08-13T00:00:11Z",
          eligibleTargetIds: [matchFixture.players[1].id],
          privateResult: {},
          publicResult: {},
          drawnAt: "2026-08-13T00:00:01Z",
          resolvedAt: null,
        },
      },
    });
    expect(snapshot.actionState.draw?.cardCode).toBe("point_swipe");
    expect(snapshot.actionState.draw?.eligibleTargetIds).toEqual([
      matchFixture.players[1].id,
    ]);
  });

  it("rejects unknown server action cards", () => {
    const parsed = matchSnapshotSchema.safeParse({
      ...matchFixture,
      actionState: {
        ...matchFixture.actionState,
        draw: {
          id: "f6459f71-c29f-43d2-887c-a13f4d56a171",
          cardCode: "browser_chosen_card",
          displayName: "Invalid",
          category: "positive",
          description: "Invalid",
          status: "resolved",
          targetPlayerId: null,
          targetDeadline: null,
          eligibleTargetIds: [],
          privateResult: {},
          publicResult: {},
          drawnAt: "2026-08-13T00:00:01Z",
          resolvedAt: "2026-08-13T00:00:02Z",
        },
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("validates Draw, Skip, and target commands without effect parameters", () => {
    expect(
      actionChoiceInputSchema.parse({
        roomId: matchFixture.room.id,
        choice: "draw",
        idempotencyKey: "f6459f71-c29f-43d2-887c-a13f4d56a171",
      }),
    ).toEqual({
      roomId: matchFixture.room.id,
      choice: "draw",
      idempotencyKey: "f6459f71-c29f-43d2-887c-a13f4d56a171",
    });
    expect(
      actionTargetInputSchema.parse({
        roomId: matchFixture.room.id,
        actionDrawId: "f6459f71-c29f-43d2-887c-a13f4d56a171",
        targetPlayerId: matchFixture.players[1].id,
        idempotencyKey: "8db937ae-04cc-4d45-9b4d-746674cebc20",
      }).targetPlayerId,
    ).toBe(matchFixture.players[1].id);
  });

  it("strictly parses participant-safe Mini-Game state", () => {
    const parsed = matchSnapshotSchema.parse({
      ...matchFixture,
      room: { ...matchFixture.room, phase: "mini_game_resolution" },
      round: { ...matchFixture.round, phase: "mini_game_resolution" },
      miniGameState: {
        ...matchFixture.miniGameState,
        roomHasActiveChallenge: true,
        challenge: {
          id: "f6459f71-c29f-43d2-887c-a13f4d56a171",
          status: "active",
          queuePosition: 0,
          challengerPlayerId: matchFixture.players[0].id,
          opponentPlayerId: matchFixture.players[1].id,
          isChallenger: true,
          stakeType: "half",
          stakePerPlayer: 500,
          pot: 1_000,
          gameType: "stop_bar",
          attempt: 1,
          startsAt: "2026-08-13T00:00:03Z",
          submissionDeadline: "2026-08-13T00:00:18Z",
          specification: {
            type: "stop_bar",
            targetPosition: 0.4,
            markerSpeed: 0.7,
            initialDirection: 1,
            maximumDurationMs: 15_000,
          },
          ownSubmitted: false,
          opponentSubmitted: false,
          winnerPlayerId: null,
          resolutionMethod: null,
          completedAt: null,
          cancellationReason: null,
        },
      },
    });
    expect(parsed.miniGameState.challenge?.specification).toMatchObject({
      type: "stop_bar",
      targetPosition: 0.4,
    });
    expect(parsed.miniGameState.challenge).not.toHaveProperty("seed");
  });

  it("validates Mini-Game commands and rejects oversized result payloads", () => {
    expect(
      miniGameChallengeInputSchema.parse({
        roomId: matchFixture.room.id,
        opponentPlayerId: matchFixture.players[1].id,
        stakeType: "all",
        idempotencyKey: "f6459f71-c29f-43d2-887c-a13f4d56a171",
      }).stakeType,
    ).toBe("all");
    expect(
      miniGameSubmissionInputSchema.safeParse({
        roomId: matchFixture.room.id,
        challengeId: "8db937ae-04cc-4d45-9b4d-746674cebc20",
        result: { sequence: Array.from({ length: 100 }, () => "star") },
        idempotencyKey: "f6459f71-c29f-43d2-887c-a13f4d56a171",
      }).success,
    ).toBe(false);
  });

  it("strictly parses participant-safe championship and official result state", () => {
    const parsed = matchSnapshotSchema.parse({
      ...matchFixture,
      room: {
        ...matchFixture.room,
        status: "completed",
        phase: "completed",
        completedAt: "2026-08-13T00:01:00Z",
      },
      round: { ...matchFixture.round, status: "completed" },
      completionState: {
        phase: "completed",
        tiebreaker: {
          status: "resolved",
          isParticipant: true,
          participantIds: matchFixture.players.map((player) => player.id),
          startsAt: "2026-08-13T00:00:40Z",
          submissionDeadline: "2026-08-13T00:00:52Z",
          specification: null,
          ownSubmitted: true,
          submittedCount: 2,
          participantCount: 2,
          winnerPlayerId: matchFixture.players[0].id,
          resolutionMethod: "skill",
        },
        result: {
          winnerPlayerId: matchFixture.players[0].id,
          resolutionMethod: "skill",
          completedAt: "2026-08-13T00:01:00Z",
          rankings: matchFixture.players.map((player, index) => ({
            playerId: player.id,
            score: index ? 500 : 1_000,
            rank: index + 1,
            displayOrder: index + 1,
          })),
          statistics: [
            {
              category: "lock_in_points",
              playerId: matchFixture.players[0].id,
              value: 1_000,
            },
          ],
        },
        rematchRoomId: null,
      },
    });
    expect(parsed.completionState.result?.winnerPlayerId).toBe(
      matchFixture.players[0].id,
    );
    expect(parsed.completionState.tiebreaker).not.toHaveProperty("seed");
  });

  it("validates compact championship results and rejects out-of-range positions", () => {
    expect(
      championshipSubmissionInputSchema.parse({
        roomId: matchFixture.room.id,
        result: { position: 0.45, elapsedMs: 1_200 },
        idempotencyKey: "f6459f71-c29f-43d2-887c-a13f4d56a171",
      }).result,
    ).toEqual({ position: 0.45, elapsedMs: 1_200 });
    expect(
      championshipSubmissionInputSchema.safeParse({
        roomId: matchFixture.room.id,
        result: { position: 2, elapsedMs: 1_200 },
        idempotencyKey: "f6459f71-c29f-43d2-887c-a13f4d56a171",
      }).success,
    ).toBe(false);
  });
});
