"use client";

import {
  Check,
  Clock3,
  Crown,
  Radio,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  UserRound,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  gameErrorMessages,
  type MatchSnapshot,
  type PublicGameEvent,
} from "../../src/game/core/contracts";
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
  submitActionChoice,
  submitActionTarget,
} from "../../src/lib/supabase/game";
import {
  subscribeToGame,
  type RealtimeConnectionState,
} from "../../src/lib/supabase/realtime";
import { Brand } from "../components/brand";

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
      return event.payload.tiebreakerRequired
        ? "Match complete with a tie for first."
        : "Match complete.";
  }
}

export function GameClient({ roomId }: { roomId: string | null }) {
  const auth = useAnonymousSession();
  const authClient = auth.status === "ready" ? auth.client : null;
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(roomId));
  const [pending, setPending] = useState<string | null>(null);
  const [targetId, setTargetId] = useState("");
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
    if (
      choice === "draw" &&
      !window.confirm(
        "Draw now? The server will select and immediately apply the card; it cannot be rejected or exchanged.",
      )
    )
      return;
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
    if (
      !target ||
      !window.confirm(
        `Challenge ${target.displayName}? Both cards will resolve immediately.`,
      )
    )
      return;
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
    const leaders = snapshot.players.filter((player) => player.rank === 1);
    return (
      <main className="game-page game-complete-page">
        <header className="game-topbar">
          <Brand />
          <Connection state={connection} />
        </header>
        <section className="game-complete-card">
          <Trophy size={46} aria-hidden="true" />
          <p className="eyebrow">PRELIMINARY RESULT</p>
          <h1>
            {snapshot.room.tiebreakerRequired
              ? "TIED AT THE TOP"
              : `${leaders[0]?.displayName ?? "LEADER"} WINS`}
          </h1>
          <p>
            {snapshot.room.tiebreakerRequired
              ? "A future Mini-Game tiebreaker is required. Milestone 3 does not declare a false winner."
              : "The final core-game round is complete."}
          </p>
          <Leaderboard snapshot={snapshot} />
          <Link className="button button-primary" href="/">
            Return home
          </Link>
        </section>
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
      ) : (
        <section className="game-grid">
          <div className="game-main-column">
            <div className="private-card-panel">
              <div>
                <p className="eyebrow">YOUR PRIVATE POINT CARD</p>
                <h1>
                  {snapshot.privatePlayer.card?.currentValue.toLocaleString() ??
                    "—"}
                </h1>
                <span>POINTS</span>
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
                      disabled={pending !== null}
                      onClick={() => void chooseLockIn()}
                    >
                      {pending === "lock" ? "Locking…" : "Lock In"}
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
      ? Object.entries(draw.privateResult).map(
          ([key, value]) =>
            `${key.replaceAll(/([A-Z])/g, " $1").toLowerCase()}: ${String(value)}`,
        )
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
                  <p>
                    {result.length
                      ? result.join(" · ")
                      : "The server applied this card securely."}
                  </p>
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
              <div className="action-choice-buttons">
                <button
                  className="button button-lime"
                  type="button"
                  disabled={pending !== null || action.drawsRemaining === 0}
                  onClick={() => void onChoice("draw")}
                >
                  <Sparkles size={18} />{" "}
                  {pending === "action-draw" ? "Drawing…" : "Draw Mystery Card"}
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={pending !== null}
                  onClick={() => void onChoice("skip")}
                >
                  {pending === "action-skip" ? "Skipping…" : "Skip this round"}
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
  return (
    <section className="round-summary-panel">
      <div className="summary-heading">
        <p className="eyebrow">ROUND {summary.roundNumber} COMPLETE</p>
        <h1>CARDS ON THE TABLE.</h1>
        <p>Next round begins in {remaining} seconds.</p>
      </div>
      <div className="summary-card-grid">
        {summary.cards.map((card) => {
          const player = snapshot.players.find(
            (item) => item.id === card.playerId,
          );
          return (
            <article key={card.playerId}>
              <span>{player?.displayName}</span>
              <strong>{card.currentValue.toLocaleString()}</strong>
              <small>+{card.pointsAwarded.toLocaleString()} awarded</small>
              <em>{card.resolutionType.replaceAll("_", " ")}</em>
            </article>
          );
        })}
      </div>
      <Leaderboard snapshot={snapshot} />
    </section>
  );
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
