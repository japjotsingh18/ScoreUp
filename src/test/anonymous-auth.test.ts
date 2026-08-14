import type { Session, User } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  ensureAnonymousSession,
  type AnonymousAuthClient,
} from "../lib/supabase/auth";

const user = {
  id: "4c82778f-ef86-4fb9-8e0f-5d7df37e1f21",
  is_anonymous: true,
} as User;
const session = {
  access_token: "test",
  refresh_token: "test",
  expires_in: 3600,
  token_type: "bearer",
  user,
} as Session;

describe("anonymous authentication", () => {
  it("restores an existing session without creating another user", async () => {
    const signInAnonymously = vi.fn();
    const client = {
      auth: {
        getSession: vi
          .fn()
          .mockResolvedValue({ data: { session }, error: null }),
        signInAnonymously,
      },
    } as unknown as AnonymousAuthClient;
    await expect(ensureAnonymousSession(client)).resolves.toMatchObject({
      user,
      restored: true,
    });
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it("creates an anonymous session when none is stored", async () => {
    const client = {
      auth: {
        getSession: vi
          .fn()
          .mockResolvedValue({ data: { session: null }, error: null }),
        signInAnonymously: vi
          .fn()
          .mockResolvedValue({ data: { session, user }, error: null }),
      },
    } as unknown as AnonymousAuthClient;
    await expect(ensureAnonymousSession(client)).resolves.toMatchObject({
      user,
      restored: false,
    });
    expect(client.auth.signInAnonymously).toHaveBeenCalledOnce();
  });

  it("surfaces authentication failures for retry", async () => {
    const client = {
      auth: {
        getSession: vi
          .fn()
          .mockResolvedValue({ data: { session: null }, error: null }),
        signInAnonymously: vi.fn().mockResolvedValue({
          data: { session: null, user: null },
          error: new Error("offline"),
        }),
      },
    } as unknown as AnonymousAuthClient;
    await expect(ensureAnonymousSession(client)).rejects.toThrow("offline");
  });

  it("does not reuse or create a permanent account", async () => {
    const permanentSession = {
      ...session,
      user: { ...user, is_anonymous: false },
    } as Session;
    const signInAnonymously = vi.fn();
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: permanentSession },
          error: null,
        }),
        signInAnonymously,
      },
    } as unknown as AnonymousAuthClient;

    await expect(ensureAnonymousSession(client)).rejects.toThrow(
      "requires an anonymous session",
    );
    expect(signInAnonymously).not.toHaveBeenCalled();
  });
});
