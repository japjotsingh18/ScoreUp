import type { SupabaseClient } from "@supabase/supabase-js";
import { getBrowserEnvironment } from "../env";

let browserClient: SupabaseClient | null = null;

export class SupabaseUnavailableError extends Error {
  constructor(message = "Supabase is unavailable.") {
    super(message);
    this.name = "SupabaseUnavailableError";
  }
}

export async function getSupabaseBrowserClient(): Promise<SupabaseClient> {
  if (browserClient) return browserClient;
  const environment = getBrowserEnvironment();
  if (!environment.configured)
    throw new SupabaseUnavailableError(environment.message);

  const { createClient } = await import("@supabase/supabase-js");
  browserClient = createClient(
    environment.values.VITE_SUPABASE_URL,
    environment.values.VITE_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "scoreup-anonymous-session",
      },
    },
  );
  return browserClient;
}

export function resetSupabaseBrowserClientForTests() {
  browserClient = null;
}
