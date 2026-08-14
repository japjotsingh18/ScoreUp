/** Cloudflare Worker entry point for ScoreUp's Vinext application shell. */
import {
  handleImageOptimization,
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { secureResponse } from "./security-headers";

interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
  VITE_SUPABASE_URL?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Vite inlines this value for the browser build and local Worker runtime. Sites
// also supplies the same key as a runtime binding for production revisions.
const buildSupabaseUrl = import.meta.env.VITE_SUPABASE_URL as
  string | undefined;

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    let response: Response;

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      response = await handleImageOptimization(
        request,
        {
          fetchAsset: (path) =>
            env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    } else {
      response = await handler.fetch(request, env, ctx);
    }

    return secureResponse(response, {
      requestUrl: request.url,
      supabaseUrl:
        env.VITE_SUPABASE_URL ??
        buildSupabaseUrl ??
        (url.hostname === "localhost" || url.hostname === "127.0.0.1"
          ? "http://127.0.0.1:54321"
          : undefined),
    });
  },
};

export default worker;
