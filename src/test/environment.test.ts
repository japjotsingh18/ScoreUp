import { describe, expect, it } from "vitest";
import { readPublicEnvironment } from "../lib/env";

describe("public Supabase environment", () => {
  it("reports a recoverable unconfigured state for placeholders", () => {
    expect(
      readPublicEnvironment({
        VITE_SUPABASE_URL: "https://your-project.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_your-public-key",
      }),
    ).toMatchObject({ configured: false });
  });

  it("accepts a project URL and publishable key", () => {
    expect(
      readPublicEnvironment({
        VITE_SUPABASE_URL: "https://scoreup-example.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY:
          "sb_publishable_abcdefghijklmnopqrstuvwxyz",
      }),
    ).toMatchObject({ configured: true });
  });

  it("accepts the local Supabase HTTP endpoint only on loopback", () => {
    const key = "sb_publishable_abcdefghijklmnopqrstuvwxyz";
    expect(
      readPublicEnvironment({
        VITE_SUPABASE_URL: "http://127.0.0.1:54321",
        VITE_SUPABASE_PUBLISHABLE_KEY: key,
      }),
    ).toMatchObject({ configured: true });
    expect(
      readPublicEnvironment({
        VITE_SUPABASE_URL: "http://example.com",
        VITE_SUPABASE_PUBLISHABLE_KEY: key,
      }),
    ).toMatchObject({ configured: false });
  });
});
