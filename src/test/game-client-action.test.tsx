// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameClient } from "../../app/game/game-client";
import type { MatchSnapshot } from "../game/core/contracts";
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

function roundSummarySnapshot() {
  const base = pointSnapshot();
  return {
    ...base,
    room: {
      ...base.room,
      phase: "round_summary",
      currentTurnPlayerId: null,
      phaseDeadline: "2099-08-13T00:00:20Z",
    },
    round: {
      ...base.round,
      phase: "round_summary",
      status: "completed",
      currentTurnIndex: null,
      currentTurnPlayerId: null,
      turnDeadline: null,
      completedAt: "2026-08-13T00:00:18Z",
    },
    players: [
      { ...base.players[0], score: 2_000, resolved: true },
      { ...base.players[1], score: 2_225, rank: 1, resolved: true },
    ],
    roundSummaries: [
      {
        roundNumber: 1,
        completedAt: "2026-08-13T00:00:18Z",
        cards: [
          {
            playerId: base.players[0].id,
            originalValue: 750,
            currentValue: 750,
            resolutionType: "challenge_loss",
            pointsAwarded: 0,
          },
          {
            playerId: base.players[1].id,
            originalValue: 500,
            currentValue: 500,
            resolutionType: "challenge_win",
            pointsAwarded: 1_250,
          },
        ],
        decisions: [],
        scoreChanges: [
          { playerId: base.players[0].id, pointsChanged: 0 },
          { playerId: base.players[1].id, pointsChanged: 1_250 },
        ],
        miniGames: [],
      },
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
      publicChallenge: null,
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

function championshipSnapshot(isParticipant = true) {
  const start = new Date(Date.now() - 1_000).toISOString();
  const deadline = new Date(Date.now() + 9_000).toISOString();
  return {
    ...pointSnapshot(),
    serverTime: new Date().toISOString(),
    room: {
      ...pointSnapshot().room,
      phase: "championship_tiebreaker",
      currentTurnPlayerId: null,
      phaseDeadline: deadline,
      tiebreakerRequired: true,
    },
    round: {
      ...pointSnapshot().round,
      phase: "round_summary",
      status: "completed",
      currentTurnIndex: null,
      currentTurnPlayerId: null,
      turnDeadline: null,
      completedAt: "2026-08-13T00:00:30Z",
    },
    completionState: {
      phase: "championship_tiebreaker",
      tiebreaker: {
        status: "active",
        isParticipant,
        participantIds: matchFixture.players.map((player) => player.id),
        startsAt: start,
        submissionDeadline: deadline,
        specification: isParticipant
          ? {
              type: "stop_bar",
              targetPosition: 0.4,
              markerSpeed: 0.5,
              initialDirection: 1,
              maximumDurationMs: 10_000,
            }
          : null,
        ownSubmitted: false,
        submittedCount: 0,
        participantCount: 2,
        winnerPlayerId: null,
        resolutionMethod: null,
      },
      result: null,
      rematchRoomId: null,
    },
  };
}

function completedSnapshot() {
  const base = pointSnapshot();
  return {
    ...base,
    room: {
      ...base.room,
      status: "completed",
      phase: "completed",
      currentTurnPlayerId: null,
      phaseDeadline: null,
      completedAt: "2026-08-13T00:01:00Z",
    },
    round: {
      ...base.round,
      phase: "round_summary",
      status: "completed",
      currentTurnIndex: null,
      currentTurnPlayerId: null,
      phaseDeadline: null,
      turnDeadline: null,
      completedAt: "2026-08-13T00:00:50Z",
    },
    players: [
      { ...base.players[0], score: 2_000, rank: 1, resolved: true },
      { ...base.players[1], score: 1_225, rank: 2, resolved: true },
    ],
    completionState: {
      phase: "completed",
      tiebreaker: null,
      result: {
        winnerPlayerId: base.players[0].id,
        resolutionMethod: "skill",
        completedAt: "2026-08-13T00:01:00Z",
        rankings: [
          {
            playerId: base.players[0].id,
            score: 2_000,
            rank: 1,
            displayOrder: 1,
          },
          {
            playerId: base.players[1].id,
            score: 1_225,
            rank: 2,
            displayOrder: 2,
          },
        ],
        statistics: [
          {
            category: "lock_in_points",
            playerId: base.players[0].id,
            value: 1_500,
          },
        ],
      },
      rematchRoomId: null,
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
    let submitted = false;
    testState.rpc.mockImplementation((name: string) => {
      if (name === "submit_action_choice") submitted = true;
      return Promise.resolve({
        data: submitted ? resolved : initial,
        error: null,
      });
    });

    const user = userEvent.setup();
    render(<GameClient roomId={matchFixture.room.id} />);
    await user.click(
      await screen.findByRole("button", { name: /draw mystery card/i }),
    );

    expect(window.confirm).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(
        testState.rpc.mock.calls.some(
          ([name]) => name === "submit_action_choice",
        ),
      ).toBe(true),
    );
    expect(
      await screen.findByText("Score Boost worked: You gained 500 points."),
    ).toBeVisible();
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

describe("GameClient round results", () => {
  beforeEach(() => testState.rpc.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("names the round winner and separates card value, net change, and new total", async () => {
    const summary = roundSummarySnapshot() as MatchSnapshot;
    testState.rpc.mockResolvedValue({ data: summary, error: null });
    render(<GameClient roomId={matchFixture.room.id} />);

    expect(
      await screen.findByRole("heading", { name: "JORDAN WINS THE ROUND." }),
    ).toBeVisible();
    expect(
      screen.getByRole("status", { name: "Round result" }),
    ).toHaveTextContent("Jordan");
    expect(
      screen.getByRole("status", { name: "Round result" }),
    ).toHaveTextContent("+1,250");
    const winningCard = screen.getByText("Challenge winner").closest("article");
    expect(winningCard).not.toBeNull();
    expect(within(winningCard!).getByText("Point-card award")).toBeVisible();
    expect(
      within(winningCard!).getByText("Complete round change"),
    ).toBeVisible();
    expect(within(winningCard!).getByText("2,225")).toBeVisible();
  });

  it("includes the Mini-Game winner and net score movement in the round result", async () => {
    const summary = roundSummarySnapshot() as MatchSnapshot;
    summary.players = [
      { ...summary.players[0], score: 1_950 },
      { ...summary.players[1], score: 2_525 },
    ];
    summary.roundSummaries[0].scoreChanges = [
      { playerId: summary.players[0].id, pointsChanged: -50 },
      { playerId: summary.players[1].id, pointsChanged: 1_300 },
    ];
    summary.roundSummaries[0].miniGames = [
      {
        id: "8db937ae-04cc-4d45-9b4d-746674cebc20",
        challengerPlayerId: summary.players[0].id,
        opponentPlayerId: summary.players[1].id,
        stakeType: "half",
        stakePerPlayer: 50,
        pot: 100,
        gameType: "stop_bar",
        attempt: 1,
        status: "resolved",
        winnerPlayerId: summary.players[1].id,
        resolutionMethod: "game_result",
        challengerScoreChange: -50,
        opponentScoreChange: 50,
        results: [
          {
            playerId: summary.players[0].id,
            validationStatus: "accepted",
            elapsedMs: 1_100,
            primaryScore: 25_000,
            secondaryScore: 1_100,
          },
          {
            playerId: summary.players[1].id,
            validationStatus: "accepted",
            elapsedMs: 1_300,
            primaryScore: 10_000,
            secondaryScore: 1_300,
          },
        ],
      },
    ];
    testState.rpc.mockResolvedValue({ data: summary, error: null });

    render(<GameClient roomId={matchFixture.room.id} />);

    expect(
      await screen.findByRole("heading", { name: "JORDAN WINS THE ROUND." }),
    ).toBeVisible();
    expect(screen.getByText(/Jordan won the 100 point pot/i)).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Mini-Game results" }),
    ).toHaveTextContent("Maya −50 points · Jordan +50 points");
    expect(
      screen.getByRole("region", { name: "Mini-Game results" }),
    ).toHaveTextContent(
      "Jordan stopped closer to the target: 1.00% away versus 2.50%",
    );
  });

  it("explains a Different Symbol win by correctness and adjusted time", async () => {
    const summary = roundSummarySnapshot() as MatchSnapshot;
    summary.roundSummaries[0].miniGames = [
      {
        id: "8db937ae-04cc-4d45-9b4d-746674cebc21",
        challengerPlayerId: summary.players[0].id,
        opponentPlayerId: summary.players[1].id,
        stakeType: "half",
        stakePerPlayer: 50,
        pot: 100,
        gameType: "different_symbol",
        attempt: 1,
        status: "resolved",
        winnerPlayerId: summary.players[0].id,
        resolutionMethod: "game_result",
        challengerScoreChange: 50,
        opponentScoreChange: -50,
        results: [
          {
            playerId: summary.players[0].id,
            validationStatus: "accepted",
            elapsedMs: 900,
            primaryScore: 900,
            secondaryScore: 900,
          },
          {
            playerId: summary.players[1].id,
            validationStatus: "accepted",
            elapsedMs: 1_250,
            primaryScore: 1_250,
            secondaryScore: 1_250,
          },
        ],
      },
    ];
    testState.rpc.mockResolvedValue({ data: summary, error: null });

    render(<GameClient roomId={matchFixture.room.id} />);

    expect(
      await screen.findByText(
        "Both players found the different symbol correctly. Maya won on the lower adjusted time: 0.90s versus 1.25s.",
      ),
    ).toBeVisible();
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

  it("shows non-participants who is playing, the game, and the locked stakes", async () => {
    const active = miniGameSnapshot({
      type: "stop_bar",
      targetPosition: 0.4,
      markerSpeed: 0.5,
      initialDirection: 1,
      maximumDurationMs: 10_000,
    });
    const spectator = {
      ...active,
      miniGameState: {
        ...active.miniGameState,
        challenge: null,
        publicChallenge: {
          id: active.miniGameState.challenge.id,
          challengerPlayerId: active.players[0].id,
          opponentPlayerId: active.players[1].id,
          stakeType: "half",
          stakePerPlayer: 50,
          pot: 100,
          gameType: "stop_bar",
          attempt: 1,
          status: "active",
        },
      },
    };
    testState.rpc.mockResolvedValue({ data: spectator, error: null });

    render(<GameClient roomId={matchFixture.room.id} />);

    expect(
      await screen.findByRole("heading", {
        name: /Maya challenged Jordan/i,
      }),
    ).toBeVisible();
    expect(screen.getAllByText("STOP BAR")).toHaveLength(2);
    expect(screen.getByText("100")).toBeVisible();
    expect(screen.getByText(/complete net change/i)).toBeVisible();
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

describe("GameClient completion and championship", () => {
  beforeEach(() => {
    testState.rpc.mockReset();
    window.localStorage.clear();
  });

  afterEach(() => vi.restoreAllMocks());

  it("renders the official winner, full ranking, zero-qualifier stats, and completion actions", async () => {
    const completed = completedSnapshot();
    testState.rpc.mockResolvedValue({ data: completed, error: null });
    render(<GameClient roomId={matchFixture.room.id} />);
    expect(
      await screen.findByRole("heading", { name: /maya wins/i }),
    ).toBeVisible();
    expect(screen.getByText("2,000 points")).toBeVisible();
    expect(screen.getByText(/Maya · 1,500/)).toBeVisible();
    expect(screen.getAllByText("No qualifying play")).toHaveLength(4);
    expect(screen.getByRole("button", { name: /rematch/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /share result/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /return home/i })).toBeVisible();
  });

  it("copies a result-specific share summary without exposing credentials", async () => {
    testState.rpc.mockResolvedValue({ data: completedSnapshot(), error: null });
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    render(<GameClient roomId={matchFixture.room.id} />);
    await user.click(
      await screen.findByRole("button", { name: /share result/i }),
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("ScoreUp champion: Maya with 2,000 points"),
    );
    expect(writeText.mock.calls[0]?.[0]).not.toContain("service_role");
  });

  it("offers an accessible manual summary when clipboard sharing fails", async () => {
    testState.rpc.mockResolvedValue({ data: completedSnapshot(), error: null });
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("Clipboard blocked"),
    );
    const user = userEvent.setup();
    render(<GameClient roomId={matchFixture.room.id} />);
    await user.click(
      await screen.findByRole("button", { name: /share result/i }),
    );
    expect(screen.getByText(/sharing is unavailable here/i)).toBeVisible();
    expect(
      (
        screen.getByLabelText(
          /copy this result summary/i,
        ) as HTMLTextAreaElement
      ).value,
    ).toContain("ScoreUp champion: Maya");
  });

  it("offers the same server-timed keyboard control in reduced-motion mode", async () => {
    window.localStorage.setItem(
      "scoreup.preferences.v1",
      JSON.stringify({ soundEnabled: false, reducedMotion: true }),
    );
    const active = championshipSnapshot();
    testState.rpc.mockResolvedValue({ data: active, error: null });
    const user = userEvent.setup();
    render(<GameClient roomId={matchFixture.room.id} />);
    expect(await screen.findByText(/marker at .* target at/i)).toBeVisible();
    const stop = screen.getByRole("button", { name: "STOP" });
    stop.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(testState.rpc).toHaveBeenCalledWith(
        "submit_championship_result",
        expect.objectContaining({
          p_result_payload: expect.objectContaining({
            position: expect.any(Number),
            elapsedMs: expect.any(Number),
          }),
        }),
      ),
    );
  });

  it("shows non-finalists a safe waiting state without the private specification", async () => {
    const waiting = championshipSnapshot(false);
    testState.rpc.mockResolvedValue({ data: waiting, error: null });
    render(<GameClient roomId={matchFixture.room.id} />);
    expect(
      await screen.findByRole("heading", { name: /championship in progress/i }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "STOP" }),
    ).not.toBeInTheDocument();
  });
});
