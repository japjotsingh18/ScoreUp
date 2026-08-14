// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CreateGameForm } from "../../app/create/create-game-form";

describe("CreateGameForm", () => {
  it("rejects an invalid display name", async () => {
    const user = userEvent.setup();
    render(<CreateGameForm onSuccess={vi.fn()} />);

    await user.type(screen.getByLabelText(/display name/i), "A");
    await user.click(screen.getByRole("button", { name: /create room/i }));

    expect(screen.getByRole("alert")).toHaveTextContent("between 2 and 20");
  });

  it("requires a usable password for a private room", async () => {
    const user = userEvent.setup();
    render(<CreateGameForm onSuccess={vi.fn()} />);

    await user.type(screen.getByLabelText(/display name/i), "Maya");
    await user.click(screen.getByRole("checkbox", { name: /private room/i }));
    await user.type(screen.getByLabelText(/room password/i), "123");
    await user.click(screen.getByRole("button", { name: /create room/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "at least 4 characters",
    );
  });

  it("submits a valid game configuration", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(<CreateGameForm onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText(/display name/i), "Captain Maya");
    await user.click(screen.getByLabelText(/10 rounds/i));
    await user.click(screen.getByRole("button", { name: /create room/i }));

    expect(onSuccess).toHaveBeenCalledWith("Captain Maya");
    expect(screen.getByLabelText(/10 rounds/i)).toBeChecked();
  });
});
