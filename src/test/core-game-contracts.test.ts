import { describe, expect, it } from "vitest";
import {
  actionChoiceInputSchema,
  actionTargetInputSchema,
  challengeInputSchema,
  matchSnapshotSchema,
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
});
