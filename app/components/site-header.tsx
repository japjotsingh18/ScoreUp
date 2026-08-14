"use client";

import { Accessibility, Menu, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import { useGamePreferences } from "../../src/hooks/use-game-preferences";
import { Brand } from "./brand";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const preferences = useGamePreferences();

  return (
    <header className="site-header">
      <Brand />
      <nav
        className={open ? "nav-links is-open" : "nav-links"}
        aria-label="Main navigation"
      >
        <a href="/rules">How to play</a>
        <a href="/create">Create game</a>
        <a href="/join">Join game</a>
      </nav>
      <div className="header-actions">
        <button
          className="icon-button"
          type="button"
          aria-label={
            preferences.soundEnabled ? "Turn sound off" : "Turn sound on"
          }
          aria-pressed={preferences.soundEnabled}
          onClick={() => preferences.setSoundEnabled(!preferences.soundEnabled)}
        >
          {preferences.soundEnabled ? (
            <Volume2 size={19} aria-hidden="true" />
          ) : (
            <VolumeX size={19} aria-hidden="true" />
          )}
          <span className="icon-button-label">
            {preferences.soundEnabled ? "Sound on" : "Sound off"}
          </span>
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label={
            preferences.reducedMotion
              ? "Use standard motion"
              : "Reduce interface motion"
          }
          aria-pressed={preferences.reducedMotion}
          onClick={() =>
            preferences.setReducedMotion(!preferences.reducedMotion)
          }
        >
          <Accessibility size={19} aria-hidden="true" />
          <span className="icon-button-label">
            {preferences.reducedMotion ? "Reduced motion" : "Standard motion"}
          </span>
        </button>
        <a className="header-join" href="/join">
          Enter room
        </a>
        <button
          className="menu-button"
          type="button"
          aria-label="Toggle navigation"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Menu aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
