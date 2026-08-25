"use client";

import {
  Brain,
  Check,
  Clock3,
  Copy,
  Crown,
  Gamepad2,
  Radio,
  RefreshCcw,
  RotateCcw,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  UserRound,
  WifiOff,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  gameErrorMessages,
  type MatchSnapshot,
  type MiniGameSpecification,
  type MiniGameStakeType,
  type PublicGameEvent,
  type RoundSummary,
} from "../../src/game/core/contracts";
import { actionResultMessages } from "../../src/game/core/action-results";
import {
  correctConsecutiveSymbols,
  previewMatchedStake,
  stopBarPosition,
} from "../../src/game/minigames/domain";
import { useAnonymousSession } from "../../src/hooks/use-anonymous-session";
import {
  advanceRound,
  challenge,
  fetchMatch,
  GameOperationError,
  lockIn,
  processTimeout,
  processActionPhaseTimeout,
  processActionTargetTimeout,
  processMiniGameTimeout,
  processChampionshipTimeout,
  requestMiniGameChallenge,
  submitMiniGameResult,
  submitChampionshipResult,
  submitActionChoice,
  submitActionTarget,
} from "../../src/lib/supabase/game";
import {
  markRoomDisconnected,
  requestRematch,
} from "../../src/lib/supabase/rooms";
import {
  subscribeToGame,
  type RealtimeConnectionState,
} from "../../src/lib/supabase/realtime";
import { Brand } from "../components/brand";
import {
  playGameCue,
  useGamePreferences,
} from "../../src/hooks/use-game-preferences";

function messageFor(cause: unknown) {
  return cause instanceof GameOperationError
    ? gameErrorMessages[cause.code]
    : gameErrorMessages.UNKNOWN_ERROR;
}

function secondsUntil(deadline: string | null) {
  return deadline
    ? Math.max(0, Math.ceil((Date.parse(deadline) - Date.now()) / 1000))
    : 0;
}

function interactionNow() {
  return performance.now();
}

function eventCopy(event: PublicGameEvent, snapshot: MatchSnapshot) {
  const actor = snapshot.players.find(
    (player) => player.id === event.actorPlayerId,
  )?.displayName;
  const target = snapshot.players.find(
    (player) => player.id === event.payload.targetPlayerId,
  )?.displayName;
  switch (event.type) {
    case "round_started":
      return `Round ${event.roundNumber} started.`;
    case "action_phase_started":
      return "Mystery Action Card choices are open.";
    case "action_target_required":
      return `${actor ?? "A player"} is choosing an action-card target.`;
    case "action_card_resolved":
      return `${actor ?? "A player"} resolved ${String(event.payload.cardCode).replaceAll("_", " ")}.`;
    case "action_skipped":
      return `${actor ?? "A player"} skipped their action draw.`;
    case "action_auto_skipped":
      return `${actor ?? "A player"} was automatically skipped.`;
    case "action_phase_completed":
      return "Action cards resolved. Point decisions are starting.";
    case "turn_started":
      return `${actor ?? "A player"} is choosing.`;
    case "player_locked_in":
      return `${actor ?? "A player"} locked in.`;
    case "challenge_started":
      return `${actor ?? "A player"} challenged ${target ?? "an opponent"}.`;
    case "challenge_resolved":
      return `Challenge resolved: ${String(event.payload.actorCardValue)} vs ${String(event.payload.targetCardValue)}.`;
    case "timeout_occurred":
      return `${actor ?? "A player"} timed out and locked in automatically.`;
    case "round_completed":
      return `Round ${event.roundNumber} is complete.`;
    case "scores_updated":
      return "Leaderboard updated.";
    case "match_completed":
      return "The final result is official.";
    case "mini_game_requested":
      return `${actor ?? "A player"} queued a Mini-Game Challenge.`;
    case "mini_game_started":
      return "A Mini-Game Challenge started.";
    case "mini_game_submission_received":
      return `${actor ?? "A player"} submitted a Mini-Game result.`;
    case "mini_game_tiebreaker_started":
      return "A tied Mini-Game moved to Stop the Bar.";
    case "mini_game_resolved":
      return "A Mini-Game Challenge was settled.";
    case "mini_game_queue_advanced":
      return "The Mini-Game queue advanced.";
    case "mini_game_phase_completed":
      return "All queued Mini-Game Challenges are complete.";
    case "match_finalizing":
      return "The server is calculating the final standings.";
    case "championship_tiebreaker_started":
      return "The tied leaders entered the championship Stop Bar.";
    case "championship_submission_received":
      return `${actor ?? "A finalist"} locked their championship result.`;
    case "championship_resolved":
      return `${actor ?? "A finalist"} won the championship tiebreaker.`;
    case "rematch_created":
      return "A new rematch lobby is ready.";
  }
}

export function GameClient({ roomId }: { roomId: string | null }) {
  const router = useRouter();
  const preferences = useGamePreferences();
  const auth = useAnonymousSession();
  const authClient = auth.status === "ready" ? auth.client : null;
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(roomId));
  const [pending, setPending] = useState<string | null>(null);
  const [targetId, setTargetId] = useState("");
  const [miniOpponentId, setMiniOpponentId] = useState("");
  const [miniStake, setMiniStake] = useState<MiniGameStakeType>("half");
  const [error, setError] = useState(
    roomId
      ? ""
      : "This game link is incomplete. Return to your room and try again.",
  );
  const [notice, setNotice] = useState("");
  const [remaining, setRemaining] = useState(0);
  const [connection, setConnection] =
    useState<RealtimeConnectionState>("connecting");
  const requestSequence = useRef(0);
  const timeoutAttempt = useRef("");
  const summaryAttempt = useRef("");
  const actionTimeoutAttempt = useRef("");
  const miniTimeoutAttempt = useRef("");
  const championshipTimeoutAttempt = useRef("");
  const previousPhase = useRef<string | null>(null);
  const [shareFallback, setShareFallback] = useState("");

  const applySnapshot = useCallback((next: MatchSnapshot) => {
    setSnapshot(next);
    setError("");
    setRemaining(
      secondsUntil(
        next.actionState.draw?.status === "awaiting_target"
          ? next.actionState.draw.targetDeadline
          : next.room.phaseDeadline,
      ),
    );
    setTargetId((current) =>
      (next.room.phase === "action_choice"
        ? next.actionState.draw?.eligibleTargetIds
        : next.eligibleChallengeTargetIds
      )?.includes(current)
        ? current
        : "",
    );
    setMiniOpponentId((current) =>
      next.miniGameState.eligibleOpponentIds.includes(current) ? current : "",
    );
  }, []);

  const refresh = useCallback(async () => {
    if (!authClient || !roomId) return;
    const sequence = ++requestSequence.current;
    try {
      const next = await fetchMatch(authClient, roomId);
      if (sequence === requestSequence.current) applySnapshot(next);
    } catch (cause) {
      if (sequence === requestSequence.current) setError(messageFor(cause));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [applySnapshot, authClient, roomId]);

  useEffect(() => {
    if (auth.status !== "ready" || !roomId) return;
    const timeout = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timeout);
  }, [auth.status, refresh, roomId]);

  useEffect(() => {
    if (!authClient || !roomId) return;
    return subscribeToGame(
      authClient,
      roomId,
      () => void refresh(),
      setConnection,
    );
  }, [authClient, refresh, roomId]);

  useEffect(() => {
    if (!authClient || !roomId) return;
    const heartbeat = window.setInterval(() => void refresh(), 15_000);
    const pageHide = () => {
      void markRoomDisconnected(authClient, roomId).catch(() => undefined);
    };
    window.addEventListener("pagehide", pageHide);
    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("pagehide", pageHide);
    };
  }, [authClient, refresh, roomId]);

  useEffect(() => {
    const deadline =
      snapshot?.actionState.draw?.status === "awaiting_target"
        ? snapshot.actionState.draw.targetDeadline
        : snapshot?.room.phaseDeadline;
    if (!deadline) return;
    const tick = () => setRemaining(secondsUntil(deadline));
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [snapshot?.actionState.draw, snapshot?.room.phaseDeadline]);

  useEffect(() => {
    const phase = snapshot?.room.phase ?? null;
    if (phase && phase !== previousPhase.current) {
      if (phase === "completed")
        playGameCue(preferences.soundEnabled, "complete");
      else if (
        phase === "point_decisions" &&
        snapshot?.room.currentTurnPlayerId ===
          snapshot?.players.find((player) => player.isSelf)?.id
      )
        playGameCue(preferences.soundEnabled, "turn");
      previousPhase.current = phase;
    }
  }, [preferences.soundEnabled, snapshot]);

  useEffect(() => {
    if (!authClient || !snapshot || remaining > 0 || pending) return;
    if (snapshot.room.phase === "action_choice") {
      const awaiting = snapshot.actionState.draw?.status === "awaiting_target";
      const attempt = `${snapshot.room.currentRound}:${awaiting ? snapshot.actionState.draw?.id : "phase"}`;
      if (actionTimeoutAttempt.current === attempt) return;
      actionTimeoutAttempt.current = attempt;
      const timer = window.setTimeout(() => {
        setPending(awaiting ? "action-target-timeout" : "action-timeout");
        const operation =
          awaiting && snapshot.actionState.draw
            ? processActionTargetTimeout(
                authClient,
                snapshot.room.id,
                snapshot.actionState.draw.id,
                crypto.randomUUID(),
              )
            : processActionPhaseTimeout(
                authClient,
                snapshot.room.id,
                crypto.randomUUID(),
              );
        void operation
          .then(applySnapshot)
          .catch((cause) => {
            setError(messageFor(cause));
            void refresh();
          })
          .finally(() => setPending(null));
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (
      snapshot.room.phase === "point_decisions" &&
      snapshot.room.currentTurnPlayerId
    ) {
      const attempt = `${snapshot.room.currentRound}:${snapshot.room.currentTurnPlayerId}`;
      if (timeoutAttempt.current === attempt) return;
      timeoutAttempt.current = attempt;
      const timer = window.setTimeout(() => {
        setPending("timeout");
        void processTimeout(
          authClient,
          snapshot.room.id,
          snapshot.room.currentTurnPlayerId!,
          crypto.randomUUID(),
        )
          .then((next) => {
            applySnapshot(next);
            setNotice("The expired turn was locked in by the server.");
          })
          .catch((cause) => {
            setError(messageFor(cause));
            void refresh();
          })
          .finally(() => setPending(null));
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (snapshot.room.phase === "mini_game_resolution") {
      const challenge = snapshot.miniGameState.challenge;
      const attempt = `${snapshot.room.currentRound}:${challenge?.id ?? "room"}:${challenge?.attempt ?? 0}`;
      if (miniTimeoutAttempt.current === attempt) return;
      miniTimeoutAttempt.current = attempt;
      const timer = window.setTimeout(() => {
        setPending("mini-timeout");
        void processMiniGameTimeout(
          authClient,
          snapshot.room.id,
          crypto.randomUUID(),
        )
          .then(applySnapshot)
          .catch((cause) => {
            setError(messageFor(cause));
            void refresh();
          })
          .finally(() => setPending(null));
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (snapshot.room.phase === "championship_tiebreaker") {
      const attempt = `${snapshot.room.id}:${snapshot.completionState.tiebreaker?.submissionDeadline ?? "pending"}`;
      if (championshipTimeoutAttempt.current === attempt) return;
      championshipTimeoutAttempt.current = attempt;
      const timer = window.setTimeout(() => {
        setPending("championship-timeout");
        void processChampionshipTimeout(
          authClient,
          snapshot.room.id,
          crypto.randomUUID(),
        )
          .then(applySnapshot)
          .catch((cause) => {
            setError(messageFor(cause));
            void refresh();
          })
          .finally(() => setPending(null));
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (snapshot.room.phase === "round_summary") {
      const attempt = String(snapshot.room.currentRound);
      if (summaryAttempt.current === attempt) return;
      summaryAttempt.current = attempt;
      const timer = window.setTimeout(() => {
        setPending("advance");
        void advanceRound(authClient, snapshot.room.id, crypto.randomUUID())
          .then(applySnapshot)
          .catch((cause) => {
            setError(messageFor(cause));
            void refresh();
          })
          .finally(() => setPending(null));
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [applySnapshot, authClient, pending, refresh, remaining, snapshot]);

  const self = useMemo(
    () => snapshot?.players.find((player) => player.isSelf) ?? null,
    [snapshot],
  );
  const activePlayer = snapshot?.players.find(
    (player) => player.id === snapshot.room.currentTurnPlayerId,
  );
  const eligibleTargets =
    snapshot?.players.filter((player) =>
      snapshot.eligibleChallengeTargetIds.includes(player.id),
    ) ?? [];
  const isMyTurn = Boolean(
    self && snapshot?.room.currentTurnPlayerId === self.id && !self.resolved,
  );
  const latestSummary = snapshot?.roundSummaries.at(-1);
  const latestChallenge = [...(snapshot?.recentEvents ?? [])]
    .reverse()
    .find((event) => event.type === "challenge_resolved");

  async function chooseAction(choice: "draw" | "skip") {
    if (auth.status !== "ready" || !snapshot) return;
    setPending(`action-${choice}`);
    setNotice("");
    try {
      applySnapshot(
        await submitActionChoice(
          auth.client,
          snapshot.room.id,
          choice,
          crypto.randomUUID(),
        ),
      );
    } catch (cause) {
      setError(messageFor(cause));
      void refresh();
    } finally {
      setPending(null);
    }
  }

  async function chooseActionTarget() {
    const draw = snapshot?.actionState.draw;
    if (auth.status !== "ready" || !snapshot || !draw || !targetId) return;
    setPending("action-target");
    setNotice("");
    try {
      applySnapshot(
        await submitActionTarget(
          auth.client,
          snapshot.room.id,
          draw.id,
          targetId,
          crypto.randomUUID(),
        ),
      );
    } catch (cause) {
      setError(messageFor(cause));
      void refresh();
    } finally {
      setPending(null);
    }
  }

  async function chooseLockIn() {
    if (auth.status !== "ready" || !snapshot) return;
    setPending("lock");
    setNotice("");
    try {
      applySnapshot(
        await lockIn(auth.client, snapshot.room.id, crypto.randomUUID()),
      );
    } catch (cause) {
      setError(messageFor(cause));
      void refresh();
    } finally {
      setPending(null);
    }
  }

  async function chooseChallenge() {
    if (auth.status !== "ready" || !snapshot || !targetId) return;
    const target = snapshot.players.find((player) => player.id === targetId);
    if (!target) return;
    setPending("challenge");
    setNotice("");
    try {
      applySnapshot(
        await challenge(
          auth.client,
          snapshot.room.id,
          target.id,
          crypto.randomUUID(),
        ),
      );
    } catch (cause) {
      setError(messageFor(cause));
      void refresh();
    } finally {
      setPending(null);
    }
  }

  async function chooseMiniGameChallenge() {
    if (auth.status !== "ready" || !snapshot || !miniOpponentId) return;
    const opponent = snapshot.players.find(
      (player) => player.id === miniOpponentId,
    );
    if (!opponent) return;
    const preview = previewMatchedStake(
      self?.score ?? 0,
      opponent.score,
      miniStake,
    );
    if (
      preview.stakePerPlayer <= 0 ||
      !window.confirm(
        `Queue a ${miniStake === "half" ? "Half" : "All"} Mini-Game against ${opponent.displayName}? If it starts, ${preview.stakePerPlayer.toLocaleString()} points from each player will be locked into a ${preview.pot.toLocaleString()} point pot. The challenge cannot be rejected and the stake is recalculated from live scores at start.`,
      )
    )
      return;
    setPending("mini-request");
    setNotice("");
    try {
      applySnapshot(
        await requestMiniGameChallenge(
          auth.client,
          snapshot.room.id,
          opponent.id,
          miniStake,
          crypto.randomUUID(),
        ),
      );
      setNotice(
        "Mini-Game Challenge queued. Your token is used only if it starts.",
      );
    } catch (cause) {
      setError(messageFor(cause));
      void refresh();
    } finally {
      setPending(null);
    }
  }

  async function submitMiniGame(result: Record<string, unknown>) {
    const challenge = snapshot?.miniGameState.challenge;
    if (auth.status !== "ready" || !snapshot || !challenge) return;
    setPending("mini-submit");
    setNotice("");
    try {
      applySnapshot(
        await submitMiniGameResult(
          auth.client,
          snapshot.room.id,
          challenge.id,
          result,
          crypto.randomUUID(),
        ),
      );
      setNotice("Result received by the server.");
    } catch (cause) {
      setError(messageFor(cause));
      void refresh();
    } finally {
      setPending(null);
    }
  }

  async function submitChampionship(result: Record<string, unknown>) {
    if (auth.status !== "ready" || !snapshot) return;
    setPending("championship-submit");
    setNotice("");
    try {
      applySnapshot(
        await submitChampionshipResult(
          auth.client,
          snapshot.room.id,
          {
            position: Number(result.position),
            elapsedMs: Number(result.elapsedMs),
          },
          crypto.randomUUID(),
        ),
      );
      setNotice("Your championship result is locked.");
    } catch (cause) {
      setError(messageFor(cause));
      void refresh();
    } finally {
      setPending(null);
    }
  }

  async function createRematch() {
    if (auth.status !== "ready" || !snapshot) return;
    const existing = snapshot.completionState.rematchRoomId;
    if (existing) {
      router.push(`/lobby?room=${existing}`);
      return;
    }
    setPending("rematch");
    try {
      const lobby = await requestRematch(
        auth.client,
        snapshot.room.id,
        crypto.randomUUID(),
      );
      router.push(`/lobby?room=${lobby.room.id}`);
    } catch (cause) {
      setError(messageFor(cause));
      setPending(null);
    }
  }

  async function copyResult() {
    if (!snapshot?.completionState.result) return;
    const result = snapshot.completionState.result;
    const winner = snapshot.players.find(
      (player) => player.id === result.winnerPlayerId,
    );
    const summary = `ScoreUp champion: ${winner?.displayName ?? "Winner"} with ${winner?.score.toLocaleString() ?? "0"} points. ${snapshot.players.map((player) => `#${player.rank} ${player.displayName} ${player.score.toLocaleString()}`).join(" · ")}`;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(summary);
      setNotice("Share summary copied to your clipboard.");
    } catch {
      setShareFallback(summary);
      setNotice("Sharing is unavailable here. Copy the public summary below.");
    }
  }

  async function returnHome() {
    if (auth.status === "ready" && snapshot) {
      await markRoomDisconnected(auth.client, snapshot.room.id).catch(
        () => undefined,
      );
    }
    router.push("/");
  }

  if (auth.status === "unconfigured" || auth.status === "error") {
    return (
      <GameState
        title="GAME SESSION UNAVAILABLE"
        copy={auth.error}
        onRetry={auth.retry}
      />
    );
  }
  if (loading || auth.status === "loading") {
    return (
      <GameState
        title="RESTORING THE MATCH"
        copy="Loading the authoritative round, private card, and turn state…"
        busy
      />
    );
  }
  if (!snapshot || !self) {
    return (
      <GameState
        title="MATCH UNAVAILABLE"
        copy={error || "Your seat is no longer part of this match."}
      />
    );
  }

  if (snapshot.room.status === "completed") {
    return (
      <main className="game-page game-complete-page">
        <header className="game-topbar">
          <Brand />
          <Connection state={connection} />
        </header>
        <FinalResultsPanel
          snapshot={snapshot}
          pending={pending}
          shareFallback={shareFallback}
          onRematch={createRematch}
          onShare={copyResult}
          onReturnHome={returnHome}
        />
        {(error || notice) && (
          <div className="game-announcement" role="status">
            {error || notice}
          </div>
        )}
      </main>
    );
  }

  if (snapshot.room.phase === "championship_tiebreaker") {
    return (
      <main className="game-page game-championship-page">
        <header className="game-topbar">
          <Brand />
          <Connection state={connection} />
        </header>
        <ChampionshipPanel
          snapshot={snapshot}
          pending={pending}
          reducedMotion={preferences.reducedMotion}
          onSubmit={submitChampionship}
        />
        {(error || notice) && (
          <div className="game-announcement" role="status">
            {error || notice}
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="game-page">
      <header className="game-topbar">
        <Brand />
        <div className="game-round-label">
          ROUND <strong>{snapshot.room.currentRound}</strong> /{" "}
          {snapshot.room.totalRounds}
        </div>
        <Connection state={connection} />
      </header>

      <section className="game-status-strip" aria-live="polite">
        <div>
          <Radio size={16} />{" "}
          {snapshot.room.phase === "round_summary"
            ? "ROUND SUMMARY"
            : snapshot.room.phase === "action_choice"
              ? `ACTION CHOICE · ${snapshot.actionState.respondedCount}/${snapshot.actionState.participantCount} READY`
              : snapshot.room.phase === "mini_game_resolution"
                ? "MINI-GAME RESOLUTION"
                : isMyTurn
                  ? "YOUR TURN"
                  : `${activePlayer?.displayName ?? "Player"} IS CHOOSING`}
        </div>
        <div className={remaining <= 5 ? "game-timer is-urgent" : "game-timer"}>
          <Clock3 size={17} /> {remaining}s
        </div>
      </section>

      {snapshot.room.phase === "round_summary" && latestSummary ? (
        <RoundSummaryPanel snapshot={snapshot} remaining={remaining} />
      ) : snapshot.room.phase === "action_choice" ? (
        <ActionChoicePanel
          snapshot={snapshot}
          pending={pending}
          targetId={targetId}
          onTargetChange={setTargetId}
          onChoice={chooseAction}
          onTarget={chooseActionTarget}
        />
      ) : snapshot.room.phase === "mini_game_resolution" ? (
        <MiniGameResolutionPanel
          snapshot={snapshot}
          pending={pending}
          remaining={remaining}
          onSubmit={submitMiniGame}
        />
      ) : (
        <section className="game-grid">
          <div className="game-main-column">
            <div className="private-card-panel">
              <div className="point-card-wrap">
                <p className="eyebrow">YOUR PRIVATE POINT CARD</p>
                <div
                  className="point-card"
                  aria-label={`${snapshot.privatePlayer.card?.currentValue.toLocaleString() ?? "Unknown"} point card`}
                >
                  <span className="point-card-corner point-card-corner-top">
                    SU
                  </span>
                  <div className="point-card-value">
                    <small>POINT CARD</small>
                    <strong>
                      {snapshot.privatePlayer.card?.currentValue.toLocaleString() ??
                        "—"}
                    </strong>
                    <span>POINTS</span>
                  </div>
                  <span className="point-card-corner point-card-corner-bottom">
                    SU
                  </span>
                </div>
              </div>
              <div
                className={self.resolved ? "card-state resolved" : "card-state"}
              >
                {self.resolved ? (
                  <>
                    <Check /> RESOLVED
                  </>
                ) : (
                  <>
                    <ShieldAlert /> ONLY YOU CAN SEE THIS
                  </>
                )}
              </div>
            </div>

            {latestChallenge && (
              <div className="challenge-reveal" role="status">
                <Swords aria-hidden="true" />
                <strong>
                  {String(latestChallenge.payload.actorCardValue)} vs{" "}
                  {String(latestChallenge.payload.targetCardValue)}
                </strong>
                <span>Challenge resolved</span>
              </div>
            )}

            <div className="decision-panel">
              {isMyTurn ? (
                <>
                  <div className="decision-copy">
                    <p className="eyebrow">MAKE YOUR MOVE</p>
                    <h2>Bank it or battle for both.</h2>
                  </div>
                  <div className="decision-actions">
                    <button
                      className="button button-lime"
                      type="button"
                      aria-label={`Lock In — bank this card for ${snapshot.privatePlayer.card?.currentValue.toLocaleString() ?? 0} points`}
                      disabled={pending !== null}
                      onClick={() => void chooseLockIn()}
                    >
                      {pending === "lock" ? (
                        "Locking…"
                      ) : (
                        <span className="bank-card-label">
                          <small>BANK THIS CARD</small>
                          <strong>
                            +
                            {snapshot.privatePlayer.card?.currentValue.toLocaleString() ??
                              0}
                          </strong>
                        </span>
                      )}
                    </button>
                    <div className="challenge-control">
                      <label htmlFor="challenge-target">
                        Challenge an unresolved player
                      </label>
                      <select
                        id="challenge-target"
                        value={targetId}
                        onChange={(event) => setTargetId(event.target.value)}
                        disabled={pending !== null}
                      >
                        <option value="">Choose opponent</option>
                        {eligibleTargets.map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.displayName}
                          </option>
                        ))}
                      </select>
                      <button
                        className="button button-secondary"
                        type="button"
                        disabled={!targetId || pending !== null}
                        onClick={() => void chooseChallenge()}
                      >
                        <Swords size={18} />{" "}
                        {pending === "challenge" ? "Resolving…" : "Challenge"}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="waiting-card">
                  <RefreshCcw
                    className={
                      connection === "connected" ? "" : "state-spinner"
                    }
                  />
                  <div>
                    <p className="eyebrow">AUTHORITATIVE TURN ORDER</p>
                    <h2>
                      {self.resolved
                        ? "Your card is resolved."
                        : `Waiting for ${activePlayer?.displayName ?? "the active player"}.`}
                    </h2>
                    <p>
                      The game will update after their server-validated
                      decision.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <aside className="game-sidebar">
            <div className="self-score-card">
              <span>Your score</span>
              <strong>{self.score.toLocaleString()}</strong>
              <small>RANK #{self.rank}</small>
            </div>
            <MiniGameTokenPanel
              snapshot={snapshot}
              opponentId={miniOpponentId}
              stake={miniStake}
              pending={pending}
              onOpponentChange={setMiniOpponentId}
              onStakeChange={setMiniStake}
              onRequest={chooseMiniGameChallenge}
            />
            <Leaderboard snapshot={snapshot} />
            <div className="event-card">
              <h2>Live match feed</h2>
              <ol>
                {snapshot.recentEvents
                  .slice(-7)
                  .reverse()
                  .map((event) => (
                    <li key={event.sequence}>
                      <span />
                      <p>{eventCopy(event, snapshot)}</p>
                    </li>
                  ))}
              </ol>
            </div>
          </aside>
        </section>
      )}

      {(error || notice) && (
        <div className="game-announcement" role="status">
          {error || notice}
        </div>
      )}
    </main>
  );
}

function MiniGameTokenPanel({
  snapshot,
  opponentId,
  stake,
  pending,
  onOpponentChange,
  onStakeChange,
  onRequest,
}: {
  snapshot: MatchSnapshot;
  opponentId: string;
  stake: MiniGameStakeType;
  pending: string | null;
  onOpponentChange: (value: string) => void;
  onStakeChange: (value: MiniGameStakeType) => void;
  onRequest: () => Promise<void>;
}) {
  const self = snapshot.players.find((player) => player.isSelf)!;
  const opponents = snapshot.players.filter((player) =>
    snapshot.miniGameState.eligibleOpponentIds.includes(player.id),
  );
  const opponent = opponents.find((player) => player.id === opponentId);
  const preview = opponent
    ? previewMatchedStake(self.score, opponent.score, stake)
    : null;
  const ownChallenge = snapshot.miniGameState.challenge;

  return (
    <div className="mini-token-card">
      <div className="mini-token-heading">
        <Gamepad2 aria-hidden="true" />
        <div>
          <span>Mini-Game token</span>
          <strong>
            {snapshot.miniGameState.tokenAvailable ? "Available" : "Used"}
          </strong>
        </div>
      </div>
      {ownChallenge?.status === "queued" ? (
        <p>
          Your challenge is #{ownChallenge.queuePosition} in the FIFO queue.
          Your token remains available until it starts.
        </p>
      ) : snapshot.miniGameState.tokenAvailable && opponents.length ? (
        <>
          <label htmlFor="mini-opponent">Challenge opponent</label>
          <select
            id="mini-opponent"
            value={opponentId}
            onChange={(event) => onOpponentChange(event.target.value)}
            disabled={pending !== null}
          >
            <option value="">Choose opponent</option>
            {opponents.map((player) => (
              <option key={player.id} value={player.id}>
                {player.displayName} · {player.score.toLocaleString()} pts
              </option>
            ))}
          </select>
          <fieldset className="mini-stake-options">
            <legend>Matched stake</legend>
            {(["half", "all"] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="mini-stake"
                  value={value}
                  checked={stake === value}
                  onChange={() => onStakeChange(value)}
                  disabled={pending !== null}
                />
                {value === "half" ? "Half" : "All"}
              </label>
            ))}
          </fieldset>
          <div className="mini-stake-preview" aria-live="polite">
            <span>Each player</span>
            <strong>{preview?.stakePerPlayer.toLocaleString() ?? "—"}</strong>
            <span>Potential pot</span>
            <strong>{preview?.pot.toLocaleString() ?? "—"}</strong>
          </div>
          <button
            className="button button-secondary"
            type="button"
            disabled={
              !opponentId || !preview?.stakePerPlayer || pending !== null
            }
            onClick={() => void onRequest()}
          >
            <Zap size={17} aria-hidden="true" />
            {pending === "mini-request" ? "Queueing…" : "Queue challenge"}
          </button>
          <small>
            One token per match. Stakes lock after point scoring and cannot be
            rejected.
          </small>
        </>
      ) : (
        <p>
          {snapshot.miniGameState.tokenAvailable
            ? "No eligible opponent is currently available."
            : "Your one challenge token has been consumed."}
        </p>
      )}
    </div>
  );
}

function MiniGameResolutionPanel({
  snapshot,
  pending,
  remaining,
  onSubmit,
}: {
  snapshot: MatchSnapshot;
  pending: string | null;
  remaining: number;
  onSubmit: (result: Record<string, unknown>) => Promise<void>;
}) {
  const challenge = snapshot.miniGameState.challenge;
  const publicChallenge = snapshot.miniGameState.publicChallenge;
  const self = snapshot.players.find((player) => player.isSelf)!;
  const opponent = challenge
    ? snapshot.players.find(
        (player) =>
          player.id ===
          (challenge.challengerPlayerId === self.id
            ? challenge.opponentPlayerId
            : challenge.challengerPlayerId),
      )
    : null;
  const [untilStart, setUntilStart] = useState(
    secondsUntil(challenge?.startsAt ?? null),
  );

  useEffect(() => {
    const tick = () => setUntilStart(secondsUntil(challenge?.startsAt ?? null));
    tick();
    const interval = window.setInterval(tick, 100);
    return () => window.clearInterval(interval);
  }, [challenge?.startsAt]);

  if (!challenge) {
    const challenger = snapshot.players.find(
      (player) => player.id === publicChallenge?.challengerPlayerId,
    );
    const challenged = snapshot.players.find(
      (player) => player.id === publicChallenge?.opponentPlayerId,
    );
    const publicGameName = publicChallenge?.gameType
      .replaceAll("_", " ")
      .toUpperCase();
    return (
      <section className="mini-resolution-shell">
        <div className="mini-wait-card" role="status">
          <RefreshCcw className="state-spinner" aria-hidden="true" />
          <p className="eyebrow">{publicGameName ?? "MINI-GAME PREPARING"}</p>
          <h1>
            {publicChallenge
              ? `${challenger?.displayName ?? "A player"} challenged ${challenged?.displayName ?? "an opponent"}.`
              : "The next matchup is preparing."}
          </h1>
          {publicChallenge ? (
            <div className="mini-spectator-details">
              <span>
                Game <strong>{publicGameName}</strong>
              </span>
              <span>
                Stake each{" "}
                <strong>
                  {publicChallenge.stakePerPlayer.toLocaleString()}
                </strong>
              </span>
              <span>
                Winner receives{" "}
                <strong>{publicChallenge.pot.toLocaleString()}</strong>
              </span>
            </div>
          ) : null}
          <p>
            You are spectating. Scores update after the result is validated,
            then the round summary will show every player&apos;s complete net
            change.
          </p>
        </div>
        <Leaderboard snapshot={snapshot} />
      </section>
    );
  }

  const statusLabel =
    challenge.status === "tiebreaker_active"
      ? "SEEDED STOP THE BAR TIEBREAKER"
      : challenge.gameType?.replaceAll("_", " ").toUpperCase();
  const terminal = ["resolved", "refunded", "cancelled"].includes(
    challenge.status,
  );
  const winner = snapshot.players.find(
    (player) => player.id === challenge.winnerPlayerId,
  );

  return (
    <section className="mini-resolution-shell">
      <div className="mini-game-card">
        <header className="mini-game-header">
          <div>
            <p className="eyebrow">{statusLabel ?? "MINI-GAME"}</p>
            <h1>You vs {opponent?.displayName ?? "opponent"}</h1>
          </div>
          <div className="mini-pot">
            <span>Locked pot</span>
            <strong>{challenge.pot?.toLocaleString() ?? "—"}</strong>
          </div>
        </header>

        {terminal ? (
          <div className="mini-wait-card" role="status">
            {challenge.status === "resolved" ? (
              <Trophy aria-hidden="true" />
            ) : (
              <ShieldCheck aria-hidden="true" />
            )}
            <p className="eyebrow">CHALLENGE SETTLED</p>
            <h2>
              {challenge.status === "resolved"
                ? winner?.isSelf
                  ? "You won the pot."
                  : `${winner?.displayName ?? "Your opponent"} won the pot.`
                : challenge.status === "refunded"
                  ? "Both stakes were refunded."
                  : "The challenge was cancelled."}
            </h2>
            <p>
              {snapshot.miniGameState.roomHasActiveChallenge ||
              snapshot.miniGameState.roomQueueCount > 0
                ? "The remaining room queue is resolving now."
                : "Round summary is starting."}
            </p>
          </div>
        ) : challenge.ownSubmitted ? (
          <div className="mini-wait-card" role="status">
            <Check aria-hidden="true" />
            <p className="eyebrow">RESULT LOCKED</p>
            <h2>Waiting for {opponent?.displayName ?? "your opponent"}.</h2>
            <p>Your submitted result cannot be changed.</p>
          </div>
        ) : untilStart > 0 ? (
          <div className="mini-start-countdown" role="timer">
            <span>Get ready</span>
            <strong>{untilStart}</strong>
            <small>Both players receive the same synchronized start.</small>
          </div>
        ) : challenge.specification ? (
          <MiniGamePlay
            key={`${challenge.id}:${challenge.attempt}`}
            specification={challenge.specification}
            disabled={pending !== null || remaining <= 0}
            onSubmit={onSubmit}
          />
        ) : (
          <div className="mini-wait-card" role="status">
            <RefreshCcw className="state-spinner" aria-hidden="true" />
            <h2>Restoring the secure game specification…</h2>
          </div>
        )}
        <footer className="mini-game-footer">
          <span>
            {terminal
              ? `Settled via ${challenge.resolutionMethod?.replaceAll("_", " ") ?? challenge.status}`
              : `Attempt ${challenge.attempt} · ${remaining}s remaining`}
          </span>
          <span>
            {challenge.stakeType === "half" ? "Half" : "All"} stake ·{" "}
            {challenge.stakePerPlayer?.toLocaleString() ?? "—"} each
          </span>
        </footer>
      </div>
      <aside className="game-sidebar">
        <Leaderboard snapshot={snapshot} />
        <div className="mini-rules-card">
          <ShieldCheck aria-hidden="true" />
          <strong>Server-validated</strong>
          <p>
            The hidden seed, deadlines, escrow, and winner are controlled by the
            authoritative database.
          </p>
        </div>
      </aside>
    </section>
  );
}

function MiniGamePlay({
  specification,
  disabled,
  onSubmit,
}: {
  specification: MiniGameSpecification;
  disabled: boolean;
  onSubmit: (result: Record<string, unknown>) => Promise<void>;
}) {
  if (specification.type === "stop_bar")
    return (
      <StopBarGame
        specification={specification}
        disabled={disabled}
        onSubmit={onSubmit}
      />
    );
  if (specification.type === "memory_sequence")
    return (
      <MemorySequenceGame
        specification={specification}
        disabled={disabled}
        onSubmit={onSubmit}
      />
    );
  return (
    <DifferentSymbolGame
      specification={specification}
      disabled={disabled}
      onSubmit={onSubmit}
    />
  );
}

function StopBarGame({
  specification,
  disabled,
  reducedMotion = false,
  authoritativeStartedAt,
  onSubmit,
}: {
  specification: Extract<MiniGameSpecification, { type: "stop_bar" }>;
  disabled: boolean;
  reducedMotion?: boolean;
  authoritativeStartedAt?: string;
  onSubmit: (result: Record<string, unknown>) => Promise<void>;
}) {
  const startedAt = useRef(0);
  const [position, setPosition] = useState(0);

  const elapsed = useCallback(
    () =>
      authoritativeStartedAt
        ? Math.max(0, Date.now() - Date.parse(authoritativeStartedAt))
        : interactionNow() - startedAt.current,
    [authoritativeStartedAt],
  );

  useEffect(() => {
    startedAt.current = interactionNow();
    if (reducedMotion) {
      const interval = window.setInterval(
        () => setPosition(stopBarPosition(specification, elapsed())),
        250,
      );
      return () => window.clearInterval(interval);
    }
    let frame = 0;
    const animate = () => {
      setPosition(stopBarPosition(specification, elapsed()));
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [elapsed, reducedMotion, specification]);

  function stop() {
    const elapsedMs = Math.round(elapsed());
    void onSubmit({
      position: stopBarPosition(specification, elapsedMs),
      elapsedMs,
    });
  }

  return (
    <div className="stop-bar-game">
      <Brain aria-hidden="true" />
      <h2>Stop closest to the target.</h2>
      <div
        className="stop-track"
        role="img"
        aria-label="Moving marker and target zone"
        aria-describedby={reducedMotion ? "stop-bar-position" : undefined}
      >
        <span
          className="stop-target"
          style={{ left: `${specification.targetPosition * 100}%` }}
        />
        <span className="stop-marker" style={{ left: `${position * 100}%` }} />
      </div>
      {reducedMotion && (
        <p
          id="stop-bar-position"
          className="stop-position-text"
          aria-live="polite"
        >
          Marker at {Math.round(position * 100)} percent. Target at{" "}
          {Math.round(specification.targetPosition * 100)} percent.
        </p>
      )}
      <button
        className="button button-lime mini-primary-control"
        type="button"
        disabled={disabled}
        onClick={stop}
      >
        STOP
      </button>
      <p>
        Press Enter or Space while the button is focused.
        {reducedMotion
          ? " Position updates are announced using the same server-timed marker."
          : ""}
      </p>
    </div>
  );
}

const memoryLabels = {
  star: "★",
  circle: "●",
  triangle: "▲",
  diamond: "◆",
} as const;

function MemorySequenceGame({
  specification,
  disabled,
  onSubmit,
}: {
  specification: Extract<MiniGameSpecification, { type: "memory_sequence" }>;
  disabled: boolean;
  onSubmit: (result: Record<string, unknown>) => Promise<void>;
}) {
  const startedAt = useRef(0);
  const [showIndex, setShowIndex] = useState(0);
  const [input, setInput] = useState<string[]>([]);
  const showing = showIndex < specification.sequence.length;

  useEffect(() => {
    if (startedAt.current === 0) startedAt.current = interactionNow();
    if (!showing) return;
    const timeout = window.setTimeout(
      () => setShowIndex((current) => current + 1),
      specification.displayIntervalMs,
    );
    return () => window.clearTimeout(timeout);
  }, [showIndex, showing, specification.displayIntervalMs]);

  function choose(symbol: string) {
    const next = [...input, symbol];
    setInput(next);
    if (next.length === specification.sequence.length) {
      void onSubmit({
        sequence: next,
        correctConsecutive: correctConsecutiveSymbols(specification, next),
        elapsedMs: Math.round(interactionNow() - startedAt.current),
      });
    }
  }

  return (
    <div className="memory-game">
      <h2>Remember the sequence.</h2>
      {showing ? (
        <div className="memory-display" aria-live="polite">
          <strong>
            {memoryLabels[specification.sequence[showIndex]] ?? "•"}
          </strong>
          <span>
            Symbol {showIndex + 1} of {specification.sequence.length}
          </span>
        </div>
      ) : (
        <>
          <p>
            Repeat it in order · {input.length}/{specification.sequence.length}
          </p>
          <div className="memory-controls">
            {specification.symbols.map((symbol) => (
              <button
                key={symbol}
                type="button"
                aria-label={symbol}
                disabled={disabled}
                onClick={() => choose(symbol)}
              >
                {memoryLabels[symbol]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DifferentSymbolGame({
  specification,
  disabled,
  onSubmit,
}: {
  specification: Extract<MiniGameSpecification, { type: "different_symbol" }>;
  disabled: boolean;
  onSubmit: (result: Record<string, unknown>) => Promise<void>;
}) {
  const startedAt = useRef(0);
  const [incorrectTaps, setIncorrectTaps] = useState(0);
  const circles = specification.cells.filter(
    (cell) => cell === "circle",
  ).length;
  const common =
    circles > specification.cells.length / 2 ? "circle" : "diamond";

  useEffect(() => {
    startedAt.current = interactionNow();
  }, []);

  function choose(index: number) {
    if (specification.cells[index] === common) {
      setIncorrectTaps((count) => count + 1);
      return;
    }
    void onSubmit({
      selectedCell: index,
      incorrectTaps,
      elapsedMs: Math.round(interactionNow() - startedAt.current),
    });
  }

  return (
    <div className="different-game">
      <h2>Find the different symbol.</h2>
      <p>{incorrectTaps} incorrect taps · each adds a time penalty</p>
      <div
        className="different-grid"
        style={{
          gridTemplateColumns: `repeat(${specification.gridSize}, 1fr)`,
        }}
      >
        {specification.cells.map((cell, index) => (
          <button
            key={index}
            type="button"
            aria-label={`${cell} at row ${Math.floor(index / specification.gridSize) + 1}, column ${(index % specification.gridSize) + 1}`}
            disabled={disabled}
            onClick={() => choose(index)}
          >
            {cell === "circle" ? "●" : "◆"}
          </button>
        ))}
      </div>
    </div>
  );
}

function ActionChoicePanel({
  snapshot,
  pending,
  targetId,
  onTargetChange,
  onChoice,
  onTarget,
}: {
  snapshot: MatchSnapshot;
  pending: string | null;
  targetId: string;
  onTargetChange: (value: string) => void;
  onChoice: (choice: "draw" | "skip") => Promise<void>;
  onTarget: () => Promise<void>;
}) {
  const action = snapshot.actionState;
  const draw = action.draw;
  const targets = snapshot.players.filter((player) =>
    draw?.eligibleTargetIds.includes(player.id),
  );
  const result =
    draw?.status === "resolved"
      ? actionResultMessages(draw, snapshot.players)
      : [];

  return (
    <section className="game-grid action-game-grid">
      <div className="game-main-column">
        <div
          className={`action-card-stage action-${draw?.category ?? "hidden"}`}
        >
          {draw ? (
            <div
              className="action-card-reveal"
              role="status"
              aria-live="polite"
            >
              <span className="action-category">
                {draw.category} mystery card
              </span>
              <Sparkles size={35} aria-hidden="true" />
              <h1>{draw.displayName}</h1>
              <p>{draw.description}</p>
              {draw.status === "awaiting_target" ? (
                <div className="action-target-control">
                  <label htmlFor="action-target">
                    Choose an eligible player
                  </label>
                  <select
                    id="action-target"
                    value={targetId}
                    onChange={(event) => onTargetChange(event.target.value)}
                    disabled={pending !== null}
                  >
                    <option value="">Choose player</option>
                    {targets.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.displayName}
                      </option>
                    ))}
                  </select>
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={!targetId || pending !== null}
                    onClick={() => void onTarget()}
                  >
                    {pending === "action-target"
                      ? "Resolving…"
                      : "Resolve card"}
                  </button>
                </div>
              ) : (
                <div className="action-result">
                  <strong>Resolved immediately</strong>
                  <p>{result.join(" ")}</p>
                </div>
              )}
            </div>
          ) : action.choice ? (
            <div className="waiting-card">
              <RefreshCcw className="state-spinner" aria-hidden="true" />
              <div>
                <p className="eyebrow">CHOICE LOCKED</p>
                <h1>
                  {action.choice.automatic
                    ? "Automatically skipped"
                    : "Waiting for the room"}
                </h1>
                <p>
                  Your choice cannot be changed. Point decisions begin after
                  everyone responds.
                </p>
              </div>
            </div>
          ) : (
            <div className="action-choice-copy">
              <Sparkles size={42} aria-hidden="true" />
              <p className="eyebrow">OPTIONAL MYSTERY ACTION</p>
              <h1>Draw now—or keep your round predictable.</h1>
              <p>
                A draw is selected and applied immediately by the server. It
                cannot be previewed, rejected, saved, or exchanged.
              </p>
              <div
                className="action-choice-cards"
                role="group"
                aria-label="Choose your mystery action"
              >
                <button
                  className="action-choice-card action-choice-card-mystery"
                  type="button"
                  disabled={pending !== null || action.drawsRemaining === 0}
                  onClick={() => void onChoice("draw")}
                >
                  <span className="action-choice-card-corner">?</span>
                  <span className="action-choice-card-icon" aria-hidden="true">
                    <Sparkles size={34} />
                  </span>
                  <span className="action-choice-card-kicker">
                    MYSTERY DECK
                  </span>
                  <strong>Draw Mystery Card</strong>
                  <span className="action-choice-card-detail">
                    Reveal one surprise and apply it instantly.
                  </span>
                  <span className="action-choice-card-cta">
                    {pending === "action-draw"
                      ? "Drawing…"
                      : "Choose this card"}
                  </span>
                </button>
                <button
                  className="action-choice-card action-choice-card-skip"
                  type="button"
                  disabled={pending !== null}
                  onClick={() => void onChoice("skip")}
                >
                  <span className="action-choice-card-corner">—</span>
                  <span className="action-choice-card-icon" aria-hidden="true">
                    <ShieldCheck size={34} />
                  </span>
                  <span className="action-choice-card-kicker">
                    PLAY IT SAFE
                  </span>
                  <strong>Skip This Round</strong>
                  <span className="action-choice-card-detail">
                    Keep this round predictable and move to your point card.
                  </span>
                  <span className="action-choice-card-cta">
                    {pending === "action-skip"
                      ? "Skipping…"
                      : "Choose this card"}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <aside className="game-sidebar">
        <div className="action-allowance-card">
          <span>Mystery draws remaining</span>
          <strong>{action.drawsRemaining}</strong>
          <small>
            {action.respondedCount} of {action.participantCount} players
            responded
          </small>
        </div>
        {action.shieldActive && (
          <div className="shield-status" role="status">
            <ShieldCheck aria-hidden="true" />
            <div>
              <strong>Shield active</strong>
              <span>
                Blocks the next eligible targeted negative action this round.
              </span>
            </div>
          </div>
        )}
        <Leaderboard snapshot={snapshot} />
      </aside>
    </section>
  );
}

function Connection({ state }: { state: RealtimeConnectionState }) {
  return (
    <div className={`connection-pill connection-${state}`} role="status">
      {state === "connected" ? <span /> : <WifiOff size={13} />}
      {state === "connected"
        ? "Connected"
        : state === "error"
          ? "Connection issue"
          : "Reconnecting"}
    </div>
  );
}

const statisticLabels = {
  lock_in_points: "Most lock-in points",
  biggest_point_challenge: "Biggest point challenge victory",
  action_draws: "Most action draws",
  mini_game_wins: "Most Mini-Game wins",
  biggest_comeback: "Biggest comeback",
} as const;

function ChampionshipPanel({
  snapshot,
  pending,
  reducedMotion,
  onSubmit,
}: {
  snapshot: MatchSnapshot;
  pending: string | null;
  reducedMotion: boolean;
  onSubmit: (result: Record<string, unknown>) => Promise<void>;
}) {
  const tiebreaker = snapshot.completionState.tiebreaker;
  const [now, setNow] = useState(() => Date.parse(snapshot.serverTime));

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  if (!tiebreaker) return null;
  const finalists = snapshot.players.filter((player) =>
    tiebreaker.participantIds.includes(player.id),
  );
  const startsIn = Math.max(
    0,
    Math.ceil((Date.parse(tiebreaker.startsAt) - now) / 1000),
  );

  return (
    <section
      className="championship-shell"
      aria-labelledby="championship-title"
    >
      <div className="championship-heading">
        <Trophy size={48} aria-hidden="true" />
        <p className="eyebrow">CHAMPIONSHIP TIEBREAKER</p>
        <h1 id="championship-title">ONE LAST STOP.</h1>
        <p>
          {finalists.map((player) => player.displayName).join(" · ")} tied for
          first. Scores are frozen; this decides rank only.
        </p>
      </div>
      {tiebreaker.isParticipant ? (
        tiebreaker.ownSubmitted ? (
          <div className="championship-waiting" role="status">
            <Check aria-hidden="true" />
            <h2>Your result is locked.</h2>
            <p>
              Waiting for the other finalists · {tiebreaker.submittedCount}/
              {tiebreaker.participantCount} received
            </p>
          </div>
        ) : startsIn > 0 ? (
          <div
            className="championship-countdown"
            role="timer"
            aria-live="polite"
          >
            <strong>{startsIn}</strong>
            <span>Same seed. Same start. Closest marker wins.</span>
          </div>
        ) : tiebreaker.specification ? (
          <StopBarGame
            specification={tiebreaker.specification}
            disabled={pending !== null}
            reducedMotion={reducedMotion}
            authoritativeStartedAt={tiebreaker.startsAt}
            onSubmit={onSubmit}
          />
        ) : null
      ) : (
        <div className="championship-waiting" role="status">
          <RefreshCcw className="state-spinner" aria-hidden="true" />
          <h2>Championship in progress</h2>
          <p>
            The tied leaders have identical server-seeded conditions. You’ll
            receive the official result automatically.
          </p>
        </div>
      )}
      <Leaderboard snapshot={snapshot} />
    </section>
  );
}

function FinalResultsPanel({
  snapshot,
  pending,
  shareFallback,
  onRematch,
  onShare,
  onReturnHome,
}: {
  snapshot: MatchSnapshot;
  pending: string | null;
  shareFallback: string;
  onRematch: () => Promise<void>;
  onShare: () => Promise<void>;
  onReturnHome: () => Promise<void>;
}) {
  const result = snapshot.completionState.result;
  const winner = snapshot.players.find(
    (player) => player.id === result?.winnerPlayerId,
  );

  if (!result) {
    return (
      <section className="game-complete-card" role="status">
        <RefreshCcw className="state-spinner" aria-hidden="true" />
        <h1>FINALIZING RESULT</h1>
      </section>
    );
  }

  return (
    <section className="final-results" aria-labelledby="final-result-title">
      <div className="winner-hero">
        <Trophy size={54} aria-hidden="true" />
        <p className="eyebrow">OFFICIAL RESULT</p>
        <h1 id="final-result-title">
          {winner?.displayName ?? "CHAMPION"} WINS
        </h1>
        <strong>{winner?.score.toLocaleString()} points</strong>
        <span>
          {snapshot.completionState.tiebreaker
            ? `Championship decided by ${result.resolutionMethod.replaceAll("_", " ")}`
            : "Highest final score"}
        </span>
      </div>

      <div className="final-results-grid">
        <Leaderboard snapshot={snapshot} />
        <section
          className="match-statistics"
          aria-labelledby="match-statistics-title"
        >
          <h2 id="match-statistics-title">Match standouts</h2>
          <dl>
            {Object.entries(statisticLabels).map(([category, label]) => {
              const awards = result.statistics.filter(
                (statistic) => statistic.category === category,
              );
              return (
                <div key={category}>
                  <dt>{label}</dt>
                  <dd>
                    {awards.length
                      ? `${awards
                          .map(
                            (award) =>
                              snapshot.players.find(
                                (player) => player.id === award.playerId,
                              )?.displayName ?? "Player",
                          )
                          .join(" & ")} · ${awards[0].value.toLocaleString()}`
                      : "No qualifying play"}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      </div>

      <div className="final-actions">
        <button
          className="button button-lime"
          type="button"
          disabled={pending !== null}
          onClick={() => void onRematch()}
        >
          <RotateCcw size={18} aria-hidden="true" />
          {pending === "rematch" ? "Creating lobby…" : "Rematch"}
        </button>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void onShare()}
        >
          <Share2 size={18} aria-hidden="true" /> Share result
        </button>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void onReturnHome()}
        >
          Return home
        </button>
      </div>
      {shareFallback && (
        <div className="share-fallback">
          <label htmlFor="share-summary">
            <Copy size={16} aria-hidden="true" /> Copy this result summary
          </label>
          <textarea
            id="share-summary"
            readOnly
            value={shareFallback}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      )}
    </section>
  );
}

function Leaderboard({ snapshot }: { snapshot: MatchSnapshot }) {
  return (
    <div className="leaderboard-card">
      <h2>Leaderboard</h2>
      <ol>
        {snapshot.players.map((player) => (
          <li key={player.id}>
            <span>{player.rank}</span>
            <div>
              <strong>{player.displayName}</strong>
              <small>
                {player.connected ? "Online" : "Disconnected"}
                {player.isHost ? " · Host" : ""}
              </small>
            </div>
            <b>{player.score.toLocaleString()}</b>
            {player.isSelf && <UserRound size={15} aria-label="You" />}
            {player.isHost && <Crown size={14} aria-label="Host" />}
          </li>
        ))}
      </ol>
    </div>
  );
}

function RoundSummaryPanel({
  snapshot,
  remaining,
}: {
  snapshot: MatchSnapshot;
  remaining: number;
}) {
  const summary = snapshot.roundSummaries.at(-1)!;
  const highestChange = Math.max(
    ...summary.scoreChanges.map((change) => change.pointsChanged),
  );
  const leaders = summary.scoreChanges.filter(
    (change) => change.pointsChanged === highestChange,
  );
  const leaderNames = leaders
    .map(
      (change) =>
        snapshot.players.find((player) => player.id === change.playerId)
          ?.displayName,
    )
    .filter(Boolean);
  const headline =
    highestChange === 0
      ? "NO NET SCORE WINNER."
      : leaders.length === 1
        ? `${leaderNames[0]?.toUpperCase()} WINS THE ROUND.`
        : "THE ROUND ENDS WITH JOINT LEADERS.";
  const resultCopy =
    highestChange === 0
      ? "No player finished with a positive net score change."
      : `${leaderNames.join(" & ")} finished the round ${formatSignedPoints(highestChange)}. This includes Action Cards, point cards, and Mini-Games.`;
  return (
    <section className="round-summary-panel">
      <div className="summary-heading">
        <p className="eyebrow">ROUND {summary.roundNumber} COMPLETE</p>
        <h1>{headline}</h1>
        <p>{resultCopy}</p>
      </div>
      <div
        className="summary-winner-banner"
        role="status"
        aria-label="Round result"
      >
        <Trophy aria-hidden="true" />
        <div>
          <span>{leaders.length === 1 ? "ROUND WINNER" : "ROUND LEADERS"}</span>
          <strong>{leaderNames.join(" · ") || "No winner"}</strong>
        </div>
        <b>{formatSignedPoints(highestChange)}</b>
      </div>
      <div className="summary-card-grid">
        {summary.cards.map((card) => {
          const player = snapshot.players.find(
            (item) => item.id === card.playerId,
          );
          const netChange =
            summary.scoreChanges.find(
              (change) => change.playerId === card.playerId,
            )?.pointsChanged ?? 0;
          const isLeader = highestChange > 0 && netChange === highestChange;
          const resolutionLabel = {
            lock_in: "Banked safely",
            challenge_win: "Challenge winner",
            challenge_loss: "Challenge lost",
            challenge_tie: "Challenge tied",
            auto_lock_in: "Auto-banked",
            timeout: "Timed out · auto-banked",
          }[card.resolutionType];
          return (
            <article
              key={card.playerId}
              className={isLeader ? "is-round-leader" : undefined}
            >
              <header>
                <span>{player?.displayName}</span>
                {player?.isSelf && <small>YOU</small>}
              </header>
              <div
                className="summary-playing-card"
                aria-label={`${card.currentValue.toLocaleString()} point card`}
              >
                <span>SU</span>
                <strong>{card.currentValue.toLocaleString()}</strong>
                <small>POINT CARD</small>
              </div>
              <div className="summary-points-earned">
                <span>Point-card award</span>
                <strong>+{card.pointsAwarded.toLocaleString()}</strong>
              </div>
              <div className="summary-net-change">
                <span>Complete round change</span>
                <strong>{formatSignedPoints(netChange)}</strong>
              </div>
              <div className="summary-card-footer">
                <em>{resolutionLabel}</em>
                <span>
                  New total <b>{player?.score.toLocaleString() ?? "—"}</b>
                </span>
              </div>
            </article>
          );
        })}
      </div>
      {summary.miniGames.length > 0 && (
        <section className="summary-mini-games" aria-label="Mini-Game results">
          <p className="eyebrow">MINI-GAME RESULTS</p>
          {summary.miniGames.map((miniGame) => {
            const challenger = snapshot.players.find(
              (player) => player.id === miniGame.challengerPlayerId,
            );
            const opponent = snapshot.players.find(
              (player) => player.id === miniGame.opponentPlayerId,
            );
            const winner = snapshot.players.find(
              (player) => player.id === miniGame.winnerPlayerId,
            );
            const explanation = miniGameResultExplanation(
              miniGame,
              snapshot.players,
            );
            return (
              <article key={miniGame.id}>
                <div>
                  <span>
                    {miniGame.gameType?.replaceAll("_", " ") ?? "Mini-Game"}
                  </span>
                  <strong>
                    {challenger?.displayName} challenged {opponent?.displayName}
                  </strong>
                </div>
                {miniGame.status === "resolved" ? (
                  <div className="summary-mini-result">
                    <p>
                      <Trophy aria-hidden="true" /> {winner?.displayName} won
                      the {miniGame.pot?.toLocaleString()} point pot.{" "}
                      {challenger?.displayName}{" "}
                      {formatSignedPoints(miniGame.challengerScoreChange)} ·{" "}
                      {opponent?.displayName}{" "}
                      {formatSignedPoints(miniGame.opponentScoreChange)}
                    </p>
                    <strong>{explanation}</strong>
                  </div>
                ) : (
                  <p>No points moved because this Mini-Game was not settled.</p>
                )}
              </article>
            );
          })}
        </section>
      )}
      <p className="summary-next-round" role="timer">
        Next round begins in <strong>{remaining}</strong> seconds
      </p>
      <Leaderboard snapshot={snapshot} />
    </section>
  );
}

function formatSignedPoints(value: number) {
  if (value === 0) return "0 points";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toLocaleString()} points`;
}

type MiniGameSummary = RoundSummary["miniGames"][number];

function miniGameResultExplanation(
  miniGame: MiniGameSummary,
  players: MatchSnapshot["players"],
) {
  const playerName = (playerId: string | null) =>
    players.find((player) => player.id === playerId)?.displayName ?? "A player";
  const winnerName = playerName(miniGame.winnerPlayerId);
  const loserId =
    miniGame.winnerPlayerId === miniGame.challengerPlayerId
      ? miniGame.opponentPlayerId
      : miniGame.challengerPlayerId;
  const loserName = playerName(loserId);

  if (miniGame.resolutionMethod === "opponent_timeout")
    return `${winnerName} won because ${loserName} did not submit before the deadline.`;
  if (miniGame.resolutionMethod === "opponent_invalid")
    return `${winnerName} won because their submission was valid and ${loserName}'s was invalid.`;
  if (miniGame.resolutionMethod === "random_fallback")
    return `${winnerName} was selected by the secure fallback after the players remained tied or no valid comparison was possible.`;
  if (miniGame.resolutionMethod === "server_refund")
    return "The server could not settle the challenge, so both stakes were returned.";

  const accepted = miniGame.results.filter(
    (result) => result.validationStatus === "accepted",
  );
  const winnerResult = accepted.find(
    (result) => result.playerId === miniGame.winnerPlayerId,
  );
  const loserResult = accepted.find((result) => result.playerId === loserId);

  if (!winnerResult || !loserResult)
    return `${winnerName} won after the server validated both submitted performances.`;

  if (miniGame.gameType === "different_symbol") {
    const winnerCorrect =
      (winnerResult.primaryScore ?? 100_000_000) < 100_000_000;
    const loserCorrect =
      (loserResult.primaryScore ?? 100_000_000) < 100_000_000;
    if (winnerCorrect && !loserCorrect)
      return `${winnerName} found the different symbol correctly; ${loserName} selected the wrong symbol.`;
    if (winnerCorrect && loserCorrect)
      return `Both players found the different symbol correctly. ${winnerName} won on the lower adjusted time: ${formatMilliseconds(winnerResult.primaryScore)} versus ${formatMilliseconds(loserResult.primaryScore)}.`;
    return `Neither player found the different symbol. ${winnerName} won on the faster validated response time: ${formatMilliseconds(winnerResult.secondaryScore)} versus ${formatMilliseconds(loserResult.secondaryScore)}.`;
  }

  if (miniGame.gameType === "memory_sequence") {
    if (winnerResult.primaryScore !== loserResult.primaryScore)
      return `${winnerName} remembered more symbols correctly: ${winnerResult.primaryScore ?? 0} versus ${loserResult.primaryScore ?? 0}.`;
    return `Both remembered ${winnerResult.primaryScore ?? 0} symbols correctly. ${winnerName} won on the faster time: ${formatMilliseconds(winnerResult.secondaryScore)} versus ${formatMilliseconds(loserResult.secondaryScore)}.`;
  }

  if (winnerResult.primaryScore !== loserResult.primaryScore)
    return `${winnerName} stopped closer to the target: ${formatTargetDistance(winnerResult.primaryScore)} away versus ${formatTargetDistance(loserResult.primaryScore)}.`;
  return `Both stopped equally close to the target. ${winnerName} won on the faster time: ${formatMilliseconds(winnerResult.secondaryScore)} versus ${formatMilliseconds(loserResult.secondaryScore)}.`;
}

function formatMilliseconds(value: number | null) {
  if (value === null) return "no recorded time";
  return `${(value / 1_000).toFixed(2)}s`;
}

function formatTargetDistance(value: number | null) {
  if (value === null) return "an unknown distance";
  return `${(value / 10_000).toFixed(2)}%`;
}

function GameState({
  title,
  copy,
  busy = false,
  onRetry,
}: {
  title: string;
  copy: string;
  busy?: boolean;
  onRetry?: () => void;
}) {
  return (
    <main className="game-page game-state-page">
      <header className="game-topbar">
        <Brand />
      </header>
      <section className="game-state" role={busy ? "status" : "alert"}>
        {busy ? (
          <RefreshCcw className="state-spinner" size={36} />
        ) : (
          <WifiOff size={36} />
        )}
        <p className="eyebrow">CORE GAME</p>
        <h1>{title}</h1>
        <p>{copy}</p>
        {onRetry && (
          <button
            className="button button-primary"
            type="button"
            onClick={onRetry}
          >
            Retry
          </button>
        )}
      </section>
    </main>
  );
}
