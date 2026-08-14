import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  Dices,
  Lock,
  Shield,
  Sparkles,
  Swords,
  Trophy,
} from "lucide-react";
import { Brand } from "../components/brand";

export const metadata: Metadata = { title: "How to play" };

const rules = [
  {
    icon: Sparkles,
    title: "Reveal your private card",
    copy: "At the start of every round, you get a point card only you can see. Values run from 0 to 1,000.",
  },
  {
    icon: Lock,
    title: "Lock in or challenge",
    copy: "Bank your points safely, or challenge an unresolved opponent. The higher card takes the combined value.",
  },
  {
    icon: Dices,
    title: "Use action cards",
    copy: "Draw up to two actions in a 6- or 8-round match, or three in a 10-round match. Every draw is final.",
  },
  {
    icon: BrainCircuit,
    title: "Play your one big challenge",
    copy: "Once per match, challenge an opponent to a skill mini-game and stake half or all of the matched limit.",
  },
];

export default function RulesPage() {
  return (
    <main className="rules-page">
      <header className="form-topbar rules-topbar">
        <Brand />
        <Link className="back-link" href="/">
          <ArrowLeft size={17} /> Back home
        </Link>
      </header>
      <section className="rules-hero">
        <p className="eyebrow">HOW TO PLAY</p>
        <h1>
          SMART MOVES.
          <br />
          <span>LOUD VICTORIES.</span>
        </h1>
        <p>
          ScoreUp mixes hidden cards, quick decisions, wild action effects, and
          head-to-head skill. Finish the final round on top.
        </p>
        <a className="button button-primary" href="/create">
          Start a game <ArrowRight size={20} />
        </a>
      </section>
      <section className="rule-grid">
        {rules.map((rule, index) => {
          const Icon = rule.icon;
          return (
            <article key={rule.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <Icon aria-hidden="true" />
              <h2>{rule.title}</h2>
              <p>{rule.copy}</p>
            </article>
          );
        })}
      </section>
      <section className="rules-detail">
        <div>
          <p className="eyebrow">THE HEAD-TO-HEAD RULE</p>
          <h2>CHALLENGE WITH CONFIDENCE</h2>
          <p>
            If your card is higher, you claim both values. If it’s lower, you
            score zero that round. Equal cards each keep their own value. Once
            resolved, a player is safe from more point-card challenges that
            round.
          </p>
        </div>
        <div className="versus-card">
          <div>
            <small>YOUR CARD</small>
            <strong>750</strong>
          </div>
          <Swords size={30} />
          <div>
            <small>RIVAL CARD</small>
            <strong>250</strong>
          </div>
          <p>
            YOU SCORE <b>1,000</b> POINTS
          </p>
        </div>
      </section>
      <section className="rules-callout">
        <Shield size={28} />
        <div>
          <h2>One rule everyone should know</h2>
          <p>
            A Mini-Game Challenge cannot be rejected. Both players lock an equal
            stake based on the lower score, then play under identical
            conditions.
          </p>
        </div>
      </section>
      <section className="win-strip">
        <Trophy />
        <div>
          <p className="eyebrow">WIN CONDITION</p>
          <h2>HIGHEST SCORE AFTER THE FINAL ROUND WINS.</h2>
        </div>
      </section>
    </main>
  );
}
