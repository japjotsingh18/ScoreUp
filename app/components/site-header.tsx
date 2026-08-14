"use client";

import { Menu, Volume2 } from "lucide-react";
import { useState } from "react";
import { Brand } from "./brand";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [sound, setSound] = useState(true);

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
          aria-label={sound ? "Turn sound off" : "Turn sound on"}
          aria-pressed={sound}
          onClick={() => setSound((value) => !value)}
        >
          <Volume2 size={19} aria-hidden="true" />
          <span className="icon-button-label">
            {sound ? "Sound on" : "Sound off"}
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
