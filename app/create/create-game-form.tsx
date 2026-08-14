"use client";

import { ArrowRight, LockKeyhole, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import {
  createRoomInputSchema,
  roomErrorMessages,
} from "../../src/game/lobby/contracts";
import { useAnonymousSession } from "../../src/hooks/use-anonymous-session";
import { createRoom, RoomOperationError } from "../../src/lib/supabase/rooms";

export function CreateGameForm({
  onSuccess,
}: {
  onSuccess?: (name: string) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [players, setPlayers] = useState("6");
  const [rounds, setRounds] = useState("8");
  const [timer, setTimer] = useState("30");
  const [isPrivate, setPrivate] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const auth = useAnonymousSession({ disabled: Boolean(onSuccess) });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createRoomInputSchema.safeParse({
      displayName: name,
      maxPlayers: Number(players),
      totalRounds: Number(rounds),
      turnTimerSeconds: Number(timer),
      password: isPrivate ? password : "",
      requestId: crypto.randomUUID(),
    });
    if (!parsed.success) {
      if (isPrivate && password.length < 4) {
        setError("Private room passwords need at least 4 characters.");
      } else {
        setError(
          parsed.error.issues[0]?.message ?? roomErrorMessages.INVALID_INPUT,
        );
      }
      return;
    }
    if (onSuccess) {
      setError("");
      onSuccess(parsed.data.displayName);
      return;
    }
    if (auth.status !== "ready") {
      setError(
        auth.status === "unconfigured"
          ? roomErrorMessages.SUPABASE_UNAVAILABLE
          : "Your game session is still connecting.",
      );
      return;
    }

    setError("");
    setPending(true);
    try {
      const lobby = await createRoom(auth.client, parsed.data);
      router.push(`/lobby?room=${encodeURIComponent(lobby.room.id)}`);
    } catch (cause) {
      if (cause instanceof RoomOperationError)
        setError(roomErrorMessages[cause.code]);
      else setError(roomErrorMessages.UNKNOWN_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="game-form" onSubmit={submit} noValidate>
      <div className="form-heading">
        <span>01</span>
        <div>
          <h2>Game setup</h2>
          <p>Your room, your rules.</p>
        </div>
      </div>
      <label className="field-label" htmlFor="display-name">
        Your display name
      </label>
      <input
        id="display-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Captain Maya"
        autoComplete="nickname"
        maxLength={20}
      />

      <div className="field-grid">
        <div>
          <label className="field-label" htmlFor="max-players">
            Max players
          </label>
          <div className="select-wrap">
            <Users size={17} />
            <select
              id="max-players"
              value={players}
              onChange={(event) => setPlayers(event.target.value)}
            >
              {Array.from({ length: 9 }, (_, index) => index + 2).map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </select>
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="turn-timer">
            Turn timer
          </label>
          <select
            id="turn-timer"
            value={timer}
            onChange={(event) => setTimer(event.target.value)}
          >
            {[20, 30, 45, 60].map((value) => (
              <option key={value} value={value}>
                {value} seconds
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset>
        <legend className="field-label">Match length</legend>
        <div className="segment-control">
          {[6, 8, 10].map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="rounds"
                value={value}
                checked={rounds === String(value)}
                onChange={(event) => setRounds(event.target.value)}
              />
              <span>
                <strong>{value}</strong> rounds
                <small>{value === 10 ? "3" : "2"} action draws</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="toggle-row">
        <span className="toggle-copy">
          <LockKeyhole size={19} />
          <span>
            <strong>Private room</strong>
            <small>Require a password to join</small>
          </span>
        </span>
        <input
          type="checkbox"
          checked={isPrivate}
          onChange={(event) => setPrivate(event.target.checked)}
        />
        <span className="switch" aria-hidden="true" />
      </label>
      {isPrivate && (
        <div>
          <label className="field-label" htmlFor="room-password">
            Room password
          </label>
          <input
            id="room-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
          />
        </div>
      )}
      {!onSuccess && auth.status === "loading" && (
        <p className="session-status" role="status">
          Establishing your anonymous game session…
        </p>
      )}
      {!onSuccess &&
        (auth.status === "error" || auth.status === "unconfigured") && (
          <div className="session-error" role="alert">
            <span>{auth.error}</span>
            <button type="button" onClick={auth.retry}>
              Retry
            </button>
          </div>
        )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="button button-primary form-submit"
        type="submit"
        disabled={pending || (!onSuccess && auth.status === "loading")}
      >
        {pending ? "Creating room…" : "Create room"}{" "}
        {!pending && <ArrowRight size={20} />}
      </button>
      <p className="form-footnote">
        No account needed. Your game session stays connected on this device.
      </p>
    </form>
  );
}
