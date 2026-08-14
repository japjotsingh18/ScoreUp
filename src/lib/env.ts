export type PublicEnvironment = {
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_PUBLISHABLE_KEY: string;
};

export type EnvironmentResult =
  | { configured: true; values: PublicEnvironment }
  | { configured: false; message: string };

export function readPublicEnvironment(
  source: Record<string, unknown>,
): EnvironmentResult {
  const url = source.VITE_SUPABASE_URL;
  const key = source.VITE_SUPABASE_PUBLISHABLE_KEY;
  let validUrl = false;
  if (typeof url === "string") {
    try {
      const parsedUrl = new URL(url);
      const isLocalDevelopment =
        parsedUrl.hostname === "127.0.0.1" ||
        parsedUrl.hostname === "localhost";
      validUrl =
        (parsedUrl.protocol === "https:" ||
          (isLocalDevelopment && parsedUrl.protocol === "http:")) &&
        !url.includes("your-project");
    } catch {
      validUrl = false;
    }
  }
  if (
    !validUrl ||
    typeof url !== "string" ||
    typeof key !== "string" ||
    key.length < 20 ||
    key.includes("your-public")
  ) {
    return {
      configured: false,
      message:
        "Supabase is not configured. Add the public project URL and publishable key to .env.local.",
    };
  }
  return {
    configured: true,
    values: { VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key },
  };
}

export function getBrowserEnvironment(): EnvironmentResult {
  return readPublicEnvironment(import.meta.env as Record<string, unknown>);
}
