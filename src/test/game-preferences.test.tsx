// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { SiteHeader } from "../../app/components/site-header";

describe("local sound and motion preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.motion;
  });

  it("persists sound preference locally and exposes pressed state", async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);
    const sound = screen.getByRole("button", { name: /turn sound off/i });
    expect(sound).toHaveAttribute("aria-pressed", "true");
    await user.click(sound);
    expect(
      screen.getByRole("button", { name: /turn sound on/i }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem("scoreup.preferences.v1")).toContain(
      '"soundEnabled":false',
    );
  });

  it("persists an explicit reduced-motion override", async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);
    await user.click(
      screen.getByRole("button", { name: /reduce interface motion/i }),
    );
    expect(document.documentElement.dataset.motion).toBe("reduce");
    expect(window.localStorage.getItem("scoreup.preferences.v1")).toContain(
      '"reducedMotion":true',
    );
  });
});
