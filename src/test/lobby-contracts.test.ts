import { describe, expect, it } from "vitest";
import {
  createRoomInputSchema,
  joinRoomInputSchema,
} from "../game/lobby/contracts";

describe("lobby command contracts", () => {
  it("enforces player, round, timer, password, and name allowlists", () => {
    const valid = {
      displayName: "  Captain   Maya  ",
      maxPlayers: 10,
      totalRounds: 10,
      turnTimerSeconds: 60,
      password: "secret",
      requestId: "c13a0e94-8af4-40fb-8772-65826225accd",
    };
    expect(createRoomInputSchema.parse(valid).displayName).toBe("Captain Maya");
    expect(
      createRoomInputSchema.safeParse({ ...valid, totalRounds: 7 }).success,
    ).toBe(false);
    expect(
      createRoomInputSchema.safeParse({ ...valid, maxPlayers: 11 }).success,
    ).toBe(false);
    expect(
      createRoomInputSchema.safeParse({ ...valid, turnTimerSeconds: 25 })
        .success,
    ).toBe(false);
  });

  it("normalizes room codes and names", () => {
    expect(
      joinRoomInputSchema.parse({
        roomCode: "up7k9",
        displayName: " Jordan ",
        password: "",
      }),
    ).toEqual({
      roomCode: "UP7K9",
      displayName: "Jordan",
      password: null,
    });
  });
});
