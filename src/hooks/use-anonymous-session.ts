"use client";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { ensureAnonymousSession } from "../lib/supabase/auth";
import {
  getSupabaseBrowserClient,
  SupabaseUnavailableError,
} from "../lib/supabase/client";

export type AnonymousSessionState =
  | {
      status: "disabled";
      client: null;
      user: null;
      error: null;
      retry: () => void;
    }
  | {
      status: "loading";
      client: SupabaseClient | null;
      user: null;
      error: null;
      retry: () => void;
    }
  | {
      status: "ready";
      client: SupabaseClient;
      user: User;
      error: null;
      retry: () => void;
    }
  | {
      status: "error" | "unconfigured";
      client: SupabaseClient | null;
      user: null;
      error: string;
      retry: () => void;
    };

export function useAnonymousSession({
  disabled = false,
}: { disabled?: boolean } = {}): AnonymousSessionState {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<AnonymousSessionState, "retry">>({
    status: "loading",
    client: null,
    user: null,
    error: null,
  });
  const retry = useCallback(() => {
    if (disabled) return;
    setState({ status: "loading", client: null, user: null, error: null });
    setAttempt((value) => value + 1);
  }, [disabled]);

  useEffect(() => {
    if (disabled) return;

    let active = true;
    void getSupabaseBrowserClient()
      .then((client) =>
        ensureAnonymousSession(client).then(({ user }) => ({ client, user })),
      )
      .then(({ client, user }) => {
        if (active) setState({ status: "ready", client, user, error: null });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof SupabaseUnavailableError) {
          setState({
            status: "unconfigured",
            client: null,
            user: null,
            error: error.message,
          });
        } else {
          setState({
            status: "error",
            client: null,
            user: null,
            error: "Could not establish your anonymous game session.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [attempt, disabled]);

  if (disabled) {
    return { status: "disabled", client: null, user: null, error: null, retry };
  }
  return { ...state, retry } as AnonymousSessionState;
}
