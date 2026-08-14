import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  challenge,
  fetchMatch,
  lockIn,
  processTimeout,
} from "../lib/supabase/game";
import { matchFixture } from "./fixtures/match";

function clientWithRpc(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient;
}

describe("core game service", () => {
  it("validates every authoritative snapshot", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: matchFixture, error: null });
    const snapshot = await fetchMatch(clientWithRpc(rpc), matchFixture.room.id);
    expect(snapshot.room.matchVersion).toBe(2);
    expect(rpc).toHaveBeenCalledWith("get_match_snapshot", {
      p_room_id: matchFixture.room.id,
    });
  });

  it("sends Lock In with only the room and replay key", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: matchFixture, error: null });
    await lockIn(
      clientWithRpc(rpc),
      matchFixture.room.id,
      "f6459f71-c29f-43d2-887c-a13f4d56a171",
    );
    expect(rpc).toHaveBeenCalledWith("lock_in_point_card", {
      p_room_id: matchFixture.room.id,
      p_idempotency_key: "f6459f71-c29f-43d2-887c-a13f4d56a171",
    });
  });

  it("never sends a card value or score with a challenge", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: matchFixture, error: null });
    await challenge(
      clientWithRpc(rpc),
      matchFixture.room.id,
      matchFixture.players[1].id,
      "f6459f71-c29f-43d2-887c-a13f4d56a171",
    );
    const parameters = rpc.mock.calls[0]?.[1];
    expect(parameters).toEqual({
      p_room_id: matchFixture.room.id,
      p_target_player_id: matchFixture.players[1].id,
      p_idempotency_key: "f6459f71-c29f-43d2-887c-a13f4d56a171",
    });
    expect(parameters).not.toHaveProperty("score");
    expect(parameters).not.toHaveProperty("cardValue");
  });

  it("maps stable server rule errors", async () => {
    await expect(
      processTimeout(
        clientWithRpc(
          vi.fn().mockResolvedValue({
            data: null,
            error: { message: "DEADLINE_NOT_EXPIRED" },
          }),
        ),
        matchFixture.room.id,
        matchFixture.players[0].id,
        "f6459f71-c29f-43d2-887c-a13f4d56a171",
      ),
    ).rejects.toMatchObject({ code: "DEADLINE_NOT_EXPIRED" });
  });
});
