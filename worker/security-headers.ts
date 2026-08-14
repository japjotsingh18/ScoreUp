const DEFAULT_PERMISSIONS_POLICY = [
  "camera=()",
  "display-capture=()",
  "geolocation=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

function getSupabaseConnectSources(supabaseUrl?: string): string[] {
  if (!supabaseUrl) return [];

  try {
    const url = new URL(supabaseUrl);
    if (url.protocol === "https:") {
      return [url.origin, `wss://${url.host}`];
    }

    const isLoopback =
      url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol === "http:" && isLoopback) {
      return [url.origin, `ws://${url.host}`];
    }

    return [];
  } catch {
    return [];
  }
}

export function buildContentSecurityPolicy(supabaseUrl?: string): string {
  const connectSources = ["'self'", ...getSupabaseConnectSources(supabaseUrl)];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "img-src 'self' data: blob:",
    "manifest-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    // Vinext emits inline RSC bootstrap scripts and embedded font CSS. These
    // allowances are framework-specific; external scripts/styles remain self-only.
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function getSecurityHeaders(
  supabaseUrl?: string,
  includeHsts = false,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Security-Policy": buildContentSecurityPolicy(supabaseUrl),
    "Permissions-Policy": DEFAULT_PERMISSIONS_POLICY,
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };

  if (includeHsts) {
    headers["Strict-Transport-Security"] =
      "max-age=31536000; includeSubDomains";
  }

  return headers;
}

export function secureResponse(
  response: Response,
  options: { requestUrl: string; supabaseUrl?: string },
): Response {
  const headers = new Headers(response.headers);
  const isHttps = new URL(options.requestUrl).protocol === "https:";

  for (const [name, value] of Object.entries(
    getSecurityHeaders(options.supabaseUrl, isHttps),
  )) {
    headers.set(name, value);
  }

  const contentType = headers.get("content-type") ?? "";
  if (
    contentType.includes("text/html") ||
    contentType.includes("text/x-component")
  ) {
    headers.set("Cache-Control", "private, no-store");
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
