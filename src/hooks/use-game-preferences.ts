"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

const STORAGE_KEY = "scoreup.preferences.v1";
const CHANGE_EVENT = "scoreup:preferences-changed";
const DEFAULTS = JSON.stringify({ soundEnabled: true, reducedMotion: false });

export type GamePreferences = {
  soundEnabled: boolean;
  reducedMotion: boolean;
};

function normalize(value: string | null): string {
  if (!value) return DEFAULTS;
  try {
    const parsed = JSON.parse(value) as Partial<GamePreferences>;
    return JSON.stringify({
      soundEnabled: parsed.soundEnabled !== false,
      reducedMotion: parsed.reducedMotion === true,
    });
  } catch {
    return DEFAULTS;
  }
}

function getSnapshot() {
  return normalize(window.localStorage.getItem(STORAGE_KEY));
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function persist(next: GamePreferences) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useGamePreferences() {
  const serialized = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULTS,
  );
  const preferences = useMemo(
    () => JSON.parse(serialized) as GamePreferences,
    [serialized],
  );

  useEffect(() => {
    document.documentElement.dataset.motion = preferences.reducedMotion
      ? "reduce"
      : "full";
  }, [preferences.reducedMotion]);

  return {
    ...preferences,
    setSoundEnabled(soundEnabled: boolean) {
      persist({ ...preferences, soundEnabled });
    },
    setReducedMotion(reducedMotion: boolean) {
      persist({ ...preferences, reducedMotion });
    },
  };
}

export function playGameCue(enabled: boolean, kind: "turn" | "complete") {
  if (!enabled || typeof AudioContext === "undefined") return;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = kind === "complete" ? 660 : 440;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.2);
  oscillator.addEventListener("ended", () => void context.close(), {
    once: true,
  });
}
