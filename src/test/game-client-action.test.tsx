// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GameClient } from "../../app/game/game-client";
import { matchFixture } from "./fixtures/match";

const testState = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../hooks/use-anonymous-session", () => ({
  useAnonymousSession: () => ({
    status: "ready" as const,
    client: { rpc: testState.rpc },
    error: "",
    retry: vi.fn(),
  }),
}));

vi.mock("../lib/supabase/realtime", () => ({
  subscribeToGame: () => () => undefined,
}));

function actionSnapshot(draw: Record<string, unknown> | null = null) {
  return {
    ...matchFixture,
    room: {
      ...matchFixture.room,
      phase: "action_choice",
      currentTurnPlayerId: null,
      phaseDeadline: "2099-08-13T00:00:20Z",
    },
    round: {
      ...matchFixture.round,
      phase: "action_choice",
      decisionOrder: [],
      currentTurnIndex: null,
      currentTurnPlayerId: null,
      phaseDeadline: "2099-08-13T00:00:20Z",
      turnDeadline: null,
    },
    actionState: {
      phaseDeadline: "2099-08-13T00:00:20Z",
      respondedCount: draw ? 1 : 0,
      participantCount: 2,
      drawsRemaining: draw ? 1 : 2,
      shieldActive: false,
      choice: draw
        ? {
            choice: "draw",
            automatic: false,
            createdAt: "2026-08-13T00:00:01Z",
          }
        : null,
      draw,
    },
  };
}

describe("GameClient action phase", () => {
  beforeEach(() => {
    testState.rpc.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("offers Draw or Skip and sends no card selection", async () => {
    const initial = actionSnapshot();
    const resolved = actionSnapshot({
      id: "f6459f71-c29f-43d2-887c-a13f4d56a171",
      cardCode: "score_boost",
      displayName: "Score Boost",
      category: "positive",
      description: "Gain 500 score points immediately.",
      status: "resolved",
      targetPlayerId: null,
      targetDeadline: null,
      eligibleTargetIds: [],
      privateResult: {},
      publicResult: { pointsChanged: 500, blocked: false },
      drawnAt: "2026-08-13T00:00:01Z",
      resolvedAt: "2026-08-13T00:00:02Z",
    });
    testState.rpc.mockImplementation((name: string) =>
      Promise.resolve({
        data: name === "submit_action_choice" ? resolved : initial,
        error: null,
      }),
    );

    const user = userEvent.setup();
    render(<GameClient roomId={matchFixture.room.id} />);
    await user.click(
      await screen.findByRole("button", { name: /draw mystery card/i }),
    );

    await waitFor(() =>
      expect(
        testState.rpc.mock.calls.some(
          ([name]) => name === "submit_action_choice",
        ),
      ).toBe(true),
    );
    const submit = testState.rpc.mock.calls.find(
      ([name]) => name === "submit_action_choice",
    );
    expect(submit?.[1]).toMatchObject({ p_choice: "draw" });
    expect(submit?.[1]).not.toHaveProperty("p_card_code");
  });

  it("renders an owner-only target selector for a persisted targeted draw", async () => {
    testState.rpc.mockResolvedValue({
      data: actionSnapshot({
        id: "f6459f71-c29f-43d2-887c-a13f4d56a171",
        cardCode: "point_swipe",
        displayName: "Point Swipe",
        category: "positive",
        description: "Choose a player and transfer up to 300 points from them.",
        status: "awaiting_target",
        targetPlayerId: null,
        targetDeadline: "2099-08-13T00:00:10Z",
        eligibleTargetIds: [matchFixture.players[1].id],
        privateResult: {},
        publicResult: {},
        drawnAt: "2026-08-13T00:00:01Z",
        resolvedAt: null,
      }),
      error: null,
    });

    render(<GameClient roomId={matchFixture.room.id} />);
    expect(
      await screen.findByRole("heading", { name: "Point Swipe" }),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: /choose an eligible player/i }),
    ).toHaveTextContent("Jordan");
    expect(
      screen.queryByText(/cannot be rejected or exchanged/i),
    ).not.toBeInTheDocument();
  });

  it("shows automatic-skip feedback from a reconnected snapshot", async () => {
    const snapshot = actionSnapshot();
    snapshot.actionState.choice = {
      choice: "skip",
      automatic: true,
      createdAt: "2026-08-13T00:00:20Z",
    };
    snapshot.actionState.respondedCount = 1;
    testState.rpc.mockResolvedValue({ data: snapshot, error: null });

    render(<GameClient roomId={matchFixture.room.id} />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /automatically skipped/i }),
      ).toBeVisible(),
    );
  });
});
