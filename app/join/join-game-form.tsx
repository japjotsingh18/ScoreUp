"use client";

import { ArrowRight, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import {
  joinRoomInputSchema,
  roomErrorMessages,
} from "../../src/game/lobby/contracts";
import { useAnonymousSession } from "../../src/hooks/use-anonymous-session";
import { joinRoom, RoomOperationError } from "../../src/lib/supabase/rooms";

export function JoinGameForm({
  initialCode = "",
  onSuccess,
}: {
  initialCode?: string;
  onSuccess?: (code: string, name: string) => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const auth = useAnonymousSession({ disabled: Boolean(onSuccess) });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = joinRoomInputSchema.safeParse({
      roomCode: code,
      displayName: name,
      password,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? roomErrorMessages.INVALID_INPUT,
      );
      return;
    }
    setError("");
    if (onSuccess) {
      onSuccess(parsed.data.roomCode, parsed.data.displayName);
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
    setPending(true);
    try {
      const lobby = await joinRoom(auth.client, parsed.data);
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
    <form className="game-form join-form" onSubmit={submit} noValidate>
      <div className="form-heading">
        <span>→</span>
        <div>
          <h2>Join game</h2>
          <p>Two details. Then you’re in.</p>
        </div>
      </div>
      <label className="field-label" htmlFor="room-code">
        Room code
      </label>
      <div className="code-input">
        <KeyRound size={20} />
        <input
          id="room-code"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="AB12C"
          maxLength={5}
          autoComplete="off"
        />
      </div>
      <label className="field-label" htmlFor="join-name">
        Your display name
      </label>
      <input
        id="join-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Jordan"
        autoComplete="nickname"
        maxLength={20}
      />
      <label className="field-label" htmlFor="join-password">
        Room password <span className="optional-label">Optional</span>
      </label>
      <input
        id="join-password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Only if the host set one"
        autoComplete="current-password"
        maxLength={64}
      />
      {!onSuccess && auth.status === "loading" && (
        <p className="session-status" role="status">
          Restoring your anonymous game session…
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
        {pending ? "Joining room…" : "Enter room"}{" "}
        {!pending && <ArrowRight size={20} />}
      </button>
      <div className="join-help">
        <strong>Can’t get in?</strong>
        <p>
          Check the code with your host. Room codes never contain spaces or
          punctuation.
        </p>
      </div>
    </form>
  );
}
