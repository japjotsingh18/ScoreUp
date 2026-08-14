import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { subscribeToGame, subscribeToLobby } from "../lib/supabase/realtime";

describe("lobby Realtime subscription", () => {
  it("uses one private room channel and removes it during cleanup", async () => {
    const subscribe = vi
      .fn()
      .mockImplementation((callback: (status: string) => void) => {
        callback("SUBSCRIBED");
        return channel;
      });
    const on = vi.fn().mockReturnThis();
    const channel = { on, subscribe } as unknown as RealtimeChannel;
    const removeChannel = vi.fn().mockResolvedValue("ok");
    const client = {
      realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
      channel: vi.fn().mockReturnValue(channel),
      removeChannel,
    } as unknown as SupabaseClient;
    const status = vi.fn();
    const invalidate = vi.fn();

    const cleanup = subscribeToLobby(
      client,
      "683a8944-b7c8-460d-834e-c4ff84bcc862",
      invalidate,
      status,
    );
    await Promise.resolve();
    await Promise.resolve();
    cleanup();

    expect(client.channel).toHaveBeenCalledWith(
      "room:683a8944-b7c8-460d-834e-c4ff84bcc862:lobby",
      { config: { private: true } },
    );
    expect(status).toHaveBeenCalledWith("connected");
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });
});

describe("game Realtime subscription", () => {
  it("uses a private game channel and removes it during cleanup", async () => {
    const subscribe = vi
      .fn()
      .mockImplementation((callback: (status: string) => void) => {
        callback("SUBSCRIBED");
        return channel;
      });
    const on = vi.fn().mockReturnThis();
    const channel = { on, subscribe } as unknown as RealtimeChannel;
    const removeChannel = vi.fn().mockResolvedValue("ok");
    const client = {
      realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
      channel: vi.fn().mockReturnValue(channel),
      removeChannel,
    } as unknown as SupabaseClient;

    const cleanup = subscribeToGame(
      client,
      "683a8944-b7c8-460d-834e-c4ff84bcc862",
      vi.fn(),
      vi.fn(),
    );
    await Promise.resolve();
    await Promise.resolve();
    cleanup();

    expect(client.channel).toHaveBeenCalledWith(
      "room:683a8944-b7c8-460d-834e-c4ff84bcc862:game",
      { config: { private: true } },
    );
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });
});
