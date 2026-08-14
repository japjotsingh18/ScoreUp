import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  getSecurityHeaders,
} from "../../worker/security-headers";

describe("production security headers", () => {
  it("allows only the configured Supabase HTTPS and WSS origins", () => {
    const policy = buildContentSecurityPolicy(
      "https://project-ref.supabase.co/path",
    );

    expect(policy).toContain(
      "connect-src 'self' https://project-ref.supabase.co wss://project-ref.supabase.co",
    );
    expect(policy).not.toContain("connect-src *");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
  });

  it("does not broaden connect-src for an invalid or insecure URL", () => {
    expect(
      buildContentSecurityPolicy("http://project-ref.supabase.co"),
    ).toContain("connect-src 'self'");
    expect(buildContentSecurityPolicy("not a url")).not.toContain(
      "supabase.co",
    );
  });

  it("allows the fixed loopback Supabase origin for local verification", () => {
    expect(buildContentSecurityPolicy("http://127.0.0.1:54321")).toContain(
      "connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321",
    );
  });

  it("adds HSTS only when the caller identifies an HTTPS response", () => {
    expect(getSecurityHeaders(undefined, true)).toMatchObject({
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    expect(getSecurityHeaders(undefined, false)).not.toHaveProperty(
      "Strict-Transport-Security",
    );
  });
});
