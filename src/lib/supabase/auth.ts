import type { Session, SupabaseClient, User } from "@supabase/supabase-js";

export type AnonymousAuthClient = {
  auth: Pick<SupabaseClient["auth"], "getSession" | "signInAnonymously">;
};

export type AnonymousSession = {
  session: Session;
  user: User;
  restored: boolean;
};

export async function ensureAnonymousSession(
  client: AnonymousAuthClient,
): Promise<AnonymousSession> {
  const { data: existing, error: existingError } =
    await client.auth.getSession();
  if (existingError) throw existingError;

  if (existing.session?.user?.is_anonymous) {
    return {
      session: existing.session,
      user: existing.session.user,
      restored: true,
    };
  }

  if (existing.session?.user) {
    throw new Error("ScoreUp multiplayer requires an anonymous session.");
  }

  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.session || !data.user) {
    throw (
      error ?? new Error("Anonymous authentication did not return a session.")
    );
  }

  return { session: data.session, user: data.user, restored: false };
}
