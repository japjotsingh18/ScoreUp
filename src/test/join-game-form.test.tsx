// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { JoinGameForm } from "../../app/join/join-game-form";

describe("JoinGameForm", () => {
  it("normalizes and submits a valid room code", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(<JoinGameForm onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText(/room code/i), "up7k9");
    await user.type(screen.getByLabelText(/display name/i), "Jordan");
    await user.click(screen.getByRole("button", { name: /enter room/i }));

    expect(onSuccess).toHaveBeenCalledWith("UP7K9", "Jordan");
  });

  it("rejects malformed room codes", async () => {
    const user = userEvent.setup();
    render(<JoinGameForm onSuccess={vi.fn()} />);

    await user.type(screen.getByLabelText(/room code/i), "x!");
    await user.type(screen.getByLabelText(/display name/i), "Jordan");
    await user.click(screen.getByRole("button", { name: /enter room/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "5-character room code",
    );
  });
});
