import { describe, expect, it } from "vitest";
import {
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
});
