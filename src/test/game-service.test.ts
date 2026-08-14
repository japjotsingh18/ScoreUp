import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  challenge,
  fetchMatch,
  lockIn,
  processTimeout,
  processActionPhaseTimeout,
  processActionTargetTimeout,
  processMiniGameQueue,
  processMiniGameTimeout,
  requestMiniGameChallenge,
  submitMiniGameResult,
  submitActionChoice,
  submitActionTarget,
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

  it("submits Draw without a browser-selected card or effect", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: matchFixture, error: null });
    await submitActionChoice(
      clientWithRpc(rpc),
      matchFixture.room.id,
      "draw",
      "f6459f71-c29f-43d2-887c-a13f4d56a171",
    );
    expect(rpc).toHaveBeenCalledWith("submit_action_choice", {
      p_room_id: matchFixture.room.id,
      p_choice: "draw",
      p_idempotency_key: "f6459f71-c29f-43d2-887c-a13f4d56a171",
    });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_card_code");
  });

  it("submits only persisted draw and eligible target identifiers", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: matchFixture, error: null });
    await submitActionTarget(
      clientWithRpc(rpc),
      matchFixture.room.id,
      "f6459f71-c29f-43d2-887c-a13f4d56a171",
      matchFixture.players[1].id,
      "8db937ae-04cc-4d45-9b4d-746674cebc20",
    );
    expect(rpc).toHaveBeenCalledWith("submit_action_target", {
      p_room_id: matchFixture.room.id,
      p_action_draw_id: "f6459f71-c29f-43d2-887c-a13f4d56a171",
      p_target_player_id: matchFixture.players[1].id,
      p_idempotency_key: "8db937ae-04cc-4d45-9b4d-746674cebc20",
    });
  });

  it("uses separate shared-phase and target deadline processors", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: matchFixture, error: null });
    const client = clientWithRpc(rpc);
    await processActionPhaseTimeout(
      client,
      matchFixture.room.id,
      "f6459f71-c29f-43d2-887c-a13f4d56a171",
    );
    await processActionTargetTimeout(
      client,
      matchFixture.room.id,
      "8db937ae-04cc-4d45-9b4d-746674cebc20",
      "7f0028d2-6ec5-4e4e-b81a-6eea056e34fd",
    );
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "process_expired_action_phase",
      "process_expired_action_target",
    ]);
  });

  it("sends only opponent, stake type, and replay key when queueing a Mini-Game", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: matchFixture, error: null });
    await requestMiniGameChallenge(
      clientWithRpc(rpc),
      matchFixture.room.id,
      matchFixture.players[1].id,
      "half",
      "f6459f71-c29f-43d2-887c-a13f4d56a171",
    );
    expect(rpc).toHaveBeenCalledWith("request_mini_game_challenge", {
      p_room_id: matchFixture.room.id,
      p_opponent_player_id: matchFixture.players[1].id,
      p_stake_type: "half",
      p_idempotency_key: "f6459f71-c29f-43d2-887c-a13f4d56a171",
    });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("seed");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("score");
  });

  it("submits a compact result and uses server-side queue and timeout selection", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: matchFixture, error: null });
    const client = clientWithRpc(rpc);
    await submitMiniGameResult(
      client,
      matchFixture.room.id,
      "8db937ae-04cc-4d45-9b4d-746674cebc20",
      { position: 0.4, elapsedMs: 900 },
      "7f0028d2-6ec5-4e4e-b81a-6eea056e34fd",
    );
    await processMiniGameQueue(
      client,
      matchFixture.room.id,
      "fa403be2-77e5-43d7-9169-f4fae5aa9fc9",
    );
    await processMiniGameTimeout(
      client,
      matchFixture.room.id,
      "704c61e7-206d-44ab-a2f6-4e6a99b1d531",
    );
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "submit_mini_game_result",
      "process_mini_game_queue",
      "process_expired_mini_game",
    ]);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_challenge_id: "8db937ae-04cc-4d45-9b4d-746674cebc20",
      p_result_payload: { position: 0.4, elapsedMs: 900 },
    });
    expect(rpc.mock.calls[2]?.[1]).not.toHaveProperty("p_challenge_id");
  });
});
