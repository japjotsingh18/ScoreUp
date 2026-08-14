import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createRoom, joinRoom, requestRematch } from "../lib/supabase/rooms";

const lobby = {
  room: {
    id: "683a8944-b7c8-460d-834e-c4ff84bcc862",
    roomCode: "UP7K9",
    status: "lobby",
    maxPlayers: 6,
    totalRounds: 8,
    turnTimerSeconds: 30,
    hasPassword: false,
    hostPlayerId: "9e82b605-b3ef-437d-91ea-9060f0a2fc85",
  },
  players: [
    {
      id: "9e82b605-b3ef-437d-91ea-9060f0a2fc85",
      displayName: "Maya",
      ready: true,
      connected: true,
      isHost: true,
      isSelf: true,
      joinedAt: "2026-08-13T00:00:00Z",
      lastSeenAt: "2026-08-13T00:00:00Z",
      disconnectedAt: null,
    },
  ],
  selfPlayerId: "9e82b605-b3ef-437d-91ea-9060f0a2fc85",
  serverTime: "2026-08-13T00:00:00Z",
};

function clientWithRpc(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient;
}

describe("room service", () => {
  it("sends a validated, idempotent create command", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: lobby, error: null });
    const result = await createRoom(clientWithRpc(rpc), {
      displayName: "Maya",
      maxPlayers: 6,
      totalRounds: 8,
      turnTimerSeconds: 30,
      password: null,
      requestId: "c13a0e94-8af4-40fb-8772-65826225accd",
    });
    expect(result.room.roomCode).toBe("UP7K9");
    expect(rpc).toHaveBeenCalledWith(
      "create_room",
      expect.objectContaining({ p_request_id: expect.any(String) }),
    );
  });

  it.each([
    ["ROOM_NOT_FOUND", "ROOM_NOT_FOUND"],
    ["ROOM_ACCESS_DENIED", "ROOM_ACCESS_DENIED"],
    ["ROOM_FULL", "ROOM_FULL"],
    ["ROOM_STARTED", "ROOM_STARTED"],
    ["DUPLICATE_NAME", "DUPLICATE_NAME"],
  ] as const)(
    "maps %s database failures to stable client errors",
    async (message, code) => {
      const client = clientWithRpc(
        vi.fn().mockResolvedValue({ data: null, error: { message } }),
      );
      await expect(
        joinRoom(client, { roomCode: "UP7K9", displayName: "Jordan" }),
      ).rejects.toMatchObject({ code });
    },
  );

  it("never returns password fields from a lobby response", async () => {
    const client = clientWithRpc(
      vi.fn().mockResolvedValue({
        data: { ...lobby, room: { ...lobby.room, passwordHash: "secret" } },
        error: null,
      }),
    );
    const result = await joinRoom(client, {
      roomCode: "UP7K9",
      displayName: "Jordan",
      password: null,
    });
    expect(result.room).not.toHaveProperty("passwordHash");
  });

  it("requests a rematch with only the completed room and replay key", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: lobby, error: null });
    await requestRematch(
      clientWithRpc(rpc),
      lobby.room.id,
      "c13a0e94-8af4-40fb-8772-65826225accd",
    );
    expect(rpc).toHaveBeenCalledWith("request_rematch", {
      p_room_id: lobby.room.id,
      p_idempotency_key: "c13a0e94-8af4-40fb-8772-65826225accd",
    });
  });
});
