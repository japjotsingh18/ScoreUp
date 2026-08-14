import { cleanup } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, vi } from "vitest";

type MockLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ children, href, ...props }: MockLinkProps) =>
      createElement("a", { ...props, href }, children),
  };
});

vi.mock("next/navigation", () => {
  const router = {
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  };
  return { useRouter: () => router };
});

afterEach(() => cleanup());
