"use client";

import {
  Check,
  Clipboard,
  Clock3,
  Crown,
  LogOut,
  RefreshCcw,
  ShieldCheck,
  UserMinus,
  Users,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  roomErrorMessages,
  type LobbySnapshot,
} from "../../src/game/lobby/contracts";
import { useAnonymousSession } from "../../src/hooks/use-anonymous-session";
import { startMatch } from "../../src/lib/supabase/game";
import {
  fetchLobby,
  heartbeatRoom,
  leaveRoom,
  markRoomDisconnected,
  removePlayer,
  RoomOperationError,
  setReadyState,
} from "../../src/lib/supabase/rooms";
import {
  subscribeToLobby,
  type RealtimeConnectionState,
} from "../../src/lib/supabase/realtime";
import { Brand } from "../components/brand";

function friendlyError(error: unknown) {
  return error instanceof RoomOperationError
    ? roomErrorMessages[error.code]
    : roomErrorMessages.UNKNOWN_ERROR;
}

export function LobbyClient({ roomId }: { roomId: string | null }) {
  const auth = useAnonymousSession();
  const authClient = auth.status === "ready" ? auth.client : null;
  const [snapshot, setSnapshot] = useState<LobbySnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(roomId));
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState(
    roomId ? "" : "This lobby link is incomplete. Create or join a room again.",
  );
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [connection, setConnection] =
    useState<RealtimeConnectionState>("connecting");
  const previousHost = useRef<string | null>(null);
  const requestSequence = useRef(0);

  const applySnapshot = useCallback((next: LobbySnapshot) => {
    if (
      next.room.status === "in_progress" ||
      next.room.status === "completed"
    ) {
      window.location.assign(`/game?room=${encodeURIComponent(next.room.id)}`);
      return;
    }
    if (
      previousHost.current &&
      previousHost.current !== next.room.hostPlayerId
    ) {
      const host = next.players.find(
        (player) => player.id === next.room.hostPlayerId,
      );
      setNotice(
        `${host?.displayName ?? "The earliest active player"} is now the host.`,
      );
    }
    previousHost.current = next.room.hostPlayerId;
    setSnapshot(next);
    setError("");
  }, []);

  const refresh = useCallback(async () => {
    if (!authClient || !roomId) return;
    const sequence = ++requestSequence.current;
    try {
      const next = await fetchLobby(authClient, roomId);
      if (sequence === requestSequence.current) applySnapshot(next);
    } catch (cause) {
      if (sequence === requestSequence.current) setError(friendlyError(cause));
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
    return subscribeToLobby(
      authClient,
      roomId,
      () => void refresh(),
      setConnection,
    );
  }, [authClient, refresh, roomId]);

  useEffect(() => {
    if (!authClient || !roomId) return;
    const heartbeat = () => {
      void heartbeatRoom(authClient, roomId)
        .then(applySnapshot)
        .catch(() => setConnection("reconnecting"));
    };
    const interval = window.setInterval(heartbeat, 15_000);
    const online = () => {
      setConnection("reconnecting");
      heartbeat();
    };
    const offline = () => setConnection("reconnecting");
    const pageHide = () =>
      void markRoomDisconnected(authClient, roomId).catch(() => undefined);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("pagehide", pageHide);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("pagehide", pageHide);
    };
  }, [applySnapshot, authClient, roomId]);

  const self = useMemo(
    () => snapshot?.players.find((player) => player.isSelf) ?? null,
    [snapshot],
  );
  const connectedPlayers =
    snapshot?.players.filter((player) => player.connected) ?? [];
  const canStart = Boolean(
    self?.isHost &&
    snapshot?.room.status === "lobby" &&
    connectedPlayers.length >= 2 &&
    connectedPlayers.every((player) => player.ready),
  );

  async function copyLink() {
    if (!snapshot) return;
    const joinLink = `${window.location.origin}/join?code=${snapshot.room.roomCode}`;
    try {
      await navigator.clipboard.writeText(joinLink);
    } catch {
      setNotice(`Share room code ${snapshot.room.roomCode}.`);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function changeReady() {
    if (auth.status !== "ready" || !snapshot || !self) return;
    setPending("ready");
    try {
      applySnapshot(
        await setReadyState(auth.client, snapshot.room.id, !self.ready),
      );
      setNotice("");
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setPending(null);
    }
  }

  async function beginMatch() {
    if (auth.status !== "ready" || !snapshot) return;
    setPending("start");
    try {
      const match = await startMatch(auth.client, snapshot.room.id);
      window.location.assign(`/game?room=${encodeURIComponent(match.room.id)}`);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setPending(null);
    }
  }

  async function remove(playerId: string, displayName: string) {
    if (auth.status !== "ready" || !snapshot) return;
    if (!window.confirm(`Remove ${displayName} from this lobby?`)) return;
    setPending(playerId);
    try {
      applySnapshot(
        await removePlayer(auth.client, snapshot.room.id, playerId),
      );
      setNotice(`${displayName} was removed from the lobby.`);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setPending(null);
    }
  }

  async function leave() {
    if (auth.status !== "ready" || !snapshot) return;
    setPending("leave");
    try {
      await leaveRoom(auth.client, snapshot.room.id);
      window.location.assign("/");
    } catch (cause) {
      setError(friendlyError(cause));
      setPending(null);
    }
  }

  if (auth.status === "unconfigured") {
    return (
      <LobbyState
        title="MULTIPLAYER ISN'T CONFIGURED"
        copy={auth.error}
        actionLabel="Retry configuration"
        onAction={auth.retry}
      />
    );
  }
  if (auth.status === "error") {
    return (
      <LobbyState
        title="SESSION CONNECTION FAILED"
        copy={auth.error}
        actionLabel="Retry session"
        onAction={auth.retry}
      />
    );
  }
  if (loading || auth.status === "loading") {
    return (
      <LobbyState
        title="CONNECTING YOUR SEAT"
        copy="Restoring your anonymous session and fetching the authoritative lobby…"
        busy
      />
    );
  }
  if (!snapshot) {
    return (
      <LobbyState
        title="ROOM UNAVAILABLE"
        copy={
          error ||
          "This room no longer exists or your session does not have access."
        }
        actionLabel="Return home"
        href="/"
      />
    );
  }

  return (
    <main className="lobby-page">
      <header className="lobby-topbar">
        <Brand />
        <div
          className={`connection-pill connection-${connection}`}
          role="status"
        >
          {connection === "connected" ? <span /> : <RefreshCcw size={13} />}
          {connection === "connected"
            ? "Connected"
            : connection === "error"
              ? "Connection issue"
              : "Reconnecting"}
        </div>
      </header>
      <section className="lobby-heading">
        <div>
          <p className="eyebrow">
            {snapshot.room.status === "lobby" ? "GAME LOBBY" : "ROOM LOCKED"}
          </p>
          <h1>
            ASSEMBLE
            <br />
            <span>YOUR RIVALS.</span>
          </h1>
        </div>
        <div className="room-code">
          <small>ROOM CODE</small>
          <strong>{snapshot.room.roomCode}</strong>
          <button type="button" onClick={copyLink}>
            <Clipboard size={17} /> {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      </section>
      <section className="lobby-content">
        <div className="players-panel">
          <div className="panel-heading">
            <div>
              <Users size={20} />
              <h2>Players</h2>
              <span>
                {snapshot.players.length} / {snapshot.room.maxPlayers}
              </span>
            </div>
            <p>
              {snapshot.room.status === "lobby"
                ? "Waiting for everyone to ready up"
                : "The match is preparing to start"}
            </p>
          </div>
          <div className="player-list">
            {snapshot.players.map((player, index) => (
              <article
                key={player.id}
                className={!player.connected ? "is-disconnected" : ""}
              >
                <span className={`avatar avatar-${(index % 3) + 1}`}>
                  {player.displayName.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <strong>
                    {player.displayName} {player.isSelf && <small>(You)</small>}
                  </strong>
                  <span className="online-label">
                    {player.connected ? <i /> : <WifiOff size={11} />}{" "}
                    {player.connected ? "Online" : "Disconnected"}
                  </span>
                </div>
                {player.isHost && (
                  <span className="host-badge">
                    <Crown size={14} /> Host
                  </span>
                )}
                <span
                  className={player.ready ? "ready-badge" : "waiting-badge"}
                >
                  {player.ready ? (
                    <>
                      <Check size={14} /> Ready
                    </>
                  ) : (
                    "Not ready"
                  )}
                </span>
                {self?.isHost &&
                  !player.isSelf &&
                  snapshot.room.status === "lobby" && (
                    <button
                      className="remove-player"
                      type="button"
                      onClick={() => void remove(player.id, player.displayName)}
                      disabled={pending === player.id}
                      aria-label={`Remove ${player.displayName}`}
                    >
                      <UserMinus size={15} />
                    </button>
                  )}
              </article>
            ))}
          </div>
          {snapshot.room.status === "lobby" && (
            <button
              className={
                self?.ready
                  ? "button ready-control is-ready"
                  : "button ready-control"
              }
              type="button"
              onClick={() => void changeReady()}
              disabled={pending !== null}
            >
              {self?.ready ? (
                <>
                  <Check /> You’re ready
                </>
              ) : (
                "Mark as ready"
              )}
            </button>
          )}
        </div>
        <aside className="lobby-sidebar">
          <div className="settings-card">
            <h2>Match setup</h2>
            <dl>
              <div>
                <dt>
                  <Clock3 size={17} /> Rounds
                </dt>
                <dd>{snapshot.room.totalRounds}</dd>
              </div>
              <div>
                <dt>
                  <Users size={17} /> Player limit
                </dt>
                <dd>{snapshot.room.maxPlayers}</dd>
              </div>
              <div>
                <dt>
                  <Clock3 size={17} /> Turn timer
                </dt>
                <dd>{snapshot.room.turnTimerSeconds} sec</dd>
              </div>
              <div>
                <dt>
                  <ShieldCheck size={17} /> Action draws
                </dt>
                <dd>{snapshot.room.totalRounds === 10 ? 3 : 2} each</dd>
              </div>
            </dl>
          </div>
          <div className="rules-card">
            <h2>Quick rules</h2>
            <ol>
              <li>
                <span>1</span>Draw a private point card.
              </li>
              <li>
                <span>2</span>Lock in or challenge a rival.
              </li>
              <li>
                <span>3</span>Use one Mini-Game token wisely.
              </li>
            </ol>
            <a href="/rules">Read full rules →</a>
          </div>
          {self?.isHost ? (
            <button
              className="button button-primary start-button"
              type="button"
              onClick={() => void beginMatch()}
              disabled={!canStart || pending !== null}
            >
              {pending === "start"
                ? "Locking room…"
                : snapshot.room.status === "lobby"
                  ? "Start game"
                  : "Room locked"}
            </button>
          ) : (
            <p className="host-wait">
              {snapshot.room.status === "lobby"
                ? "Waiting for the host to start…"
                : "The host started the match."}
            </p>
          )}
          <button
            className="leave-link"
            type="button"
            onClick={() => void leave()}
            disabled={pending !== null}
          >
            <LogOut size={16} />{" "}
            {pending === "leave" ? "Leaving…" : "Leave room"}
          </button>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="lobby-notice" role="status">
              {notice}
            </p>
          )}
        </aside>
      </section>
      <p className="lobby-disclosure">
        Mini-Game Challenges cannot be rejected. By readying up, every player
        confirms they understand this rule.
      </p>
    </main>
  );
}

function LobbyState({
  title,
  copy,
  busy = false,
  actionLabel,
  onAction,
  href,
}: {
  title: string;
  copy: string;
  busy?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  href?: string;
}) {
  return (
    <main className="lobby-page lobby-state-page">
      <header className="lobby-topbar">
        <Brand />
      </header>
      <section className="lobby-state" role={busy ? "status" : "alert"}>
        {busy ? (
          <RefreshCcw className="state-spinner" size={34} />
        ) : (
          <WifiOff size={34} />
        )}
        <p className="eyebrow">MULTIPLAYER FOUNDATION</p>
        <h1>{title}</h1>
        <p>{copy}</p>
        {href && actionLabel && (
          <a className="button button-primary" href={href}>
            {actionLabel}
          </a>
        )}
        {onAction && actionLabel && (
          <button
            className="button button-primary"
            type="button"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        )}
      </section>
    </main>
  );
}
