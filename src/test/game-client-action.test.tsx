// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function pointSnapshot() {
  return {
    ...matchFixture,
    room: { ...matchFixture.room, phaseDeadline: "2099-08-13T00:00:20Z" },
    round: {
      ...matchFixture.round,
      phaseDeadline: "2099-08-13T00:00:20Z",
      turnDeadline: "2099-08-13T00:00:20Z",
    },
    players: [
      { ...matchFixture.players[0], score: 2_000 },
      { ...matchFixture.players[1], score: 1_225 },
    ],
  };
}

function miniGameSnapshot(
  specification:
    | {
        type: "stop_bar";
        targetPosition: number;
        markerSpeed: number;
        initialDirection: 1;
        maximumDurationMs: number;
      }
    | {
        type: "memory_sequence";
        symbols: string[];
        sequence: string[];
        displayIntervalMs: number;
        maximumDurationMs: number;
      }
    | {
        type: "different_symbol";
        gridSize: number;
        cells: string[];
        incorrectTapPenaltyMs: number;
        maximumDurationMs: number;
      },
  ownSubmitted = false,
) {
  const base = pointSnapshot();
  return {
    ...base,
    room: {
      ...base.room,
      phase: "mini_game_resolution",
      currentTurnPlayerId: null,
    },
    round: {
      ...base.round,
      phase: "mini_game_resolution",
      currentTurnIndex: null,
      currentTurnPlayerId: null,
      turnDeadline: null,
    },
    miniGameState: {
      tokenAvailable: false,
      eligibleOpponentIds: [],
      roomQueueCount: 1,
      roomHasActiveChallenge: true,
      challenge: {
        id: "f6459f71-c29f-43d2-887c-a13f4d56a171",
        status: "active",
        queuePosition: 0,
        challengerPlayerId: base.players[0].id,
        opponentPlayerId: base.players[1].id,
        isChallenger: true,
        stakeType: "half",
        stakePerPlayer: 600,
        pot: 1_200,
        gameType: specification.type,
        attempt: 1,
        startsAt: "2026-08-13T00:00:01Z",
        submissionDeadline: "2099-08-13T00:00:20Z",
        specification,
        ownSubmitted,
        opponentSubmitted: false,
        winnerPlayerId: null,
        resolutionMethod: null,
        completedAt: null,
        cancellationReason: null,
      },
    },
  };
}

describe("GameClient action phase", () => {
  beforeEach(() => {
    testState.rpc.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => vi.restoreAllMocks());

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

describe("GameClient Mini-Game Challenges", () => {
  beforeEach(() => {
    testState.rpc.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => vi.restoreAllMocks());

  it("shows the Half stake preview and requests the selected opponent", async () => {
    const initial = pointSnapshot();
    testState.rpc.mockResolvedValue({ data: initial, error: null });
    const user = userEvent.setup();
    render(<GameClient roomId={matchFixture.room.id} />);
    await user.selectOptions(
      await screen.findByRole("combobox", { name: /challenge opponent/i }),
      initial.players[1].id,
    );
    expect(screen.getByText("600")).toBeVisible();
    expect(screen.getByText("1,200")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /queue challenge/i }));
    await waitFor(() =>
      expect(testState.rpc).toHaveBeenCalledWith(
        "request_mini_game_challenge",
        expect.objectContaining({
          p_opponent_player_id: initial.players[1].id,
          p_stake_type: "half",
        }),
      ),
    );
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("1,200 point pot"),
    );
  });

  it("submits a compact Different Symbol result", async () => {
    const active = miniGameSnapshot({
      type: "different_symbol",
      gridSize: 2,
      cells: ["circle", "circle", "diamond", "circle"],
      incorrectTapPenaltyMs: 350,
      maximumDurationMs: 15_000,
    });
    testState.rpc.mockResolvedValue({ data: active, error: null });
    const user = userEvent.setup();
    render(<GameClient roomId={matchFixture.room.id} />);
    await user.click(
      await screen.findByRole("button", {
        name: /diamond at row 2, column 1/i,
      }),
    );
    await waitFor(() =>
      expect(testState.rpc).toHaveBeenCalledWith(
        "submit_mini_game_result",
        expect.objectContaining({
          p_result_payload: expect.objectContaining({
            selectedCell: 2,
            incorrectTaps: 0,
          }),
        }),
      ),
    );
  });

  it("restores the locked-result waiting screen after reconnect", async () => {
    const submitted = miniGameSnapshot(
      {
        type: "different_symbol",
        gridSize: 2,
        cells: ["circle", "circle", "diamond", "circle"],
        incorrectTapPenaltyMs: 350,
        maximumDurationMs: 15_000,
      },
      true,
    );
    testState.rpc.mockResolvedValue({ data: submitted, error: null });
    render(<GameClient roomId={matchFixture.room.id} />);
    expect(
      await screen.findByRole("heading", { name: /waiting for jordan/i }),
    ).toBeVisible();
  });

  it("shows a settled result while another queued matchup resolves", async () => {
    const active = miniGameSnapshot({
      type: "stop_bar",
      targetPosition: 0.4,
      markerSpeed: 0.5,
      initialDirection: 1,
      maximumDurationMs: 10_000,
    });
    const settled = {
      ...active,
      miniGameState: {
        ...active.miniGameState,
        roomQueueCount: 1,
        challenge: {
          ...active.miniGameState.challenge,
          status: "resolved",
          specification: null,
          ownSubmitted: true,
          opponentSubmitted: true,
          winnerPlayerId: active.players[0].id,
          resolutionMethod: "game_result",
          completedAt: "2026-08-13T00:00:10Z",
        },
      },
    };
    testState.rpc.mockResolvedValue({ data: settled, error: null });
    render(<GameClient roomId={matchFixture.room.id} />);
    expect(
      await screen.findByRole("heading", { name: /you won the pot/i }),
    ).toBeVisible();
    expect(screen.getByText(/remaining room queue/i)).toBeVisible();
  });

  it("renders the Memory display with non-color symbols", async () => {
    testState.rpc.mockResolvedValue({
      data: miniGameSnapshot({
        type: "memory_sequence",
        symbols: ["star", "circle", "triangle", "diamond"],
        sequence: ["star", "circle", "diamond"],
        displayIntervalMs: 650,
        maximumDurationMs: 30_000,
      }),
      error: null,
    });
    render(<GameClient roomId={matchFixture.room.id} />);
    expect(
      await screen.findByRole("heading", { name: /remember the sequence/i }),
    ).toBeVisible();
    expect(screen.getByText("★")).toBeVisible();
  });

  it("supports keyboard activation of the Stop control", async () => {
    const active = miniGameSnapshot({
      type: "stop_bar",
      targetPosition: 0.4,
      markerSpeed: 0.5,
      initialDirection: 1,
      maximumDurationMs: 10_000,
    });
    testState.rpc.mockResolvedValue({ data: active, error: null });
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(
      () => undefined,
    );
    const user = userEvent.setup();
    render(<GameClient roomId={matchFixture.room.id} />);
    const stop = await screen.findByRole("button", { name: "STOP" });
    stop.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(testState.rpc).toHaveBeenCalledWith(
        "submit_mini_game_result",
        expect.objectContaining({
          p_result_payload: expect.objectContaining({
            position: expect.any(Number),
            elapsedMs: expect.any(Number),
          }),
        }),
      ),
    );
  });
});
