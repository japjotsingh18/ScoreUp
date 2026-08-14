import {
  ArrowRight,
  Bolt,
  BrainCircuit,
  ShieldCheck,
  Sparkles,
  Swords,
  Users,
} from "lucide-react";
import { SiteHeader } from "./components/site-header";

const steps = [
  {
    number: "01",
    icon: Sparkles,
    title: "Draw your card",
    copy: "Every round starts with a private point card. Only you know what you're holding.",
  },
  {
    number: "02",
    icon: Swords,
    title: "Make your move",
    copy: "Lock in the safe points—or challenge an opponent and take the combined score.",
  },
  {
    number: "03",
    icon: BrainCircuit,
    title: "Outplay the room",
    copy: "Use mystery actions and one high-stakes Mini-Game Challenge at the perfect moment.",
  },
];

export default function Home() {
  return (
    <main>
      <section className="hero-shell">
        <div className="score-grid" aria-hidden="true" />
        <div className="hero-glow glow-a" aria-hidden="true" />
        <div className="hero-glow glow-b" aria-hidden="true" />
        <SiteHeader />
        <div className="hero">
          <div className="hero-copy">
            <div className="live-pill">
              <span /> BUILT FOR 2–10 PLAYERS
            </div>
            <h1>
              PLAY THE CARD.
              <br />
              <span>OWN THE SCORE.</span>
            </h1>
            <p>
              Draw wisely. Challenge boldly. Score your way to the top in the
              party game where every round can flip the leaderboard.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="/create">
                Create a game <ArrowRight size={20} />
              </a>
              <a className="button button-secondary" href="/join">
                Join with code
              </a>
            </div>
            <div className="proof-row" aria-label="Game highlights">
              <span>
                <Bolt size={16} /> Fast rounds
              </span>
              <span>
                <ShieldCheck size={16} /> No account needed
              </span>
              <span>
                <Users size={16} /> Play on any device
              </span>
            </div>
          </div>
          <div className="hero-stage" aria-label="ScoreUp game card preview">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="player-chip chip-one">
              <span>1</span> MAYA <strong>2,450</strong>
            </div>
            <div className="player-chip chip-two">
              <span>2</span> JORDAN <strong>1,800</strong>
            </div>
            <div className="point-card card-back">
              <small>MYSTERY</small>
              <span>?</span>
              <strong>SCOREUP</strong>
            </div>
            <div className="point-card card-front">
              <small>YOUR CARD</small>
              <span>750</span>
              <strong>POINTS</strong>
              <i>LOCK OR CHALLENGE?</i>
            </div>
            <div className="round-chip">
              ROUND <strong>4</strong> / 8
            </div>
          </div>
        </div>
        <div className="ticker" aria-hidden="true">
          <div>
            LOCK IN <span>✦</span> CHALLENGE <span>✦</span> DRAW WISELY{" "}
            <span>✦</span> CLIMB THE LEADERBOARD <span>✦</span> LOCK IN{" "}
            <span>✦</span> CHALLENGE
          </div>
        </div>
      </section>

      <section className="how-section" id="how-it-works">
        <div className="section-heading">
          <div>
            <p className="eyebrow">THE RULES ARE SIMPLE</p>
            <h2>
              THREE MOVES.
              <br />
              <span>ENDLESS DRAMA.</span>
            </h2>
          </div>
          <a className="text-link" href="/rules">
            See all the rules <ArrowRight size={18} />
          </a>
        </div>
        <div className="step-grid">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <article className="step-card" key={step.number}>
                <span className="step-number">{step.number}</span>
                <div className="step-icon">
                  <Icon size={28} aria-hidden="true" />
                </div>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="cta-band">
        <div>
          <p className="eyebrow">READY TO MAKE YOUR MOVE?</p>
          <h2>
            START A ROOM.
            <br />
            START SOME <span>DRAMA.</span>
          </h2>
        </div>
        <a className="button button-lime" href="/create">
          Create a game <ArrowRight size={20} />
        </a>
      </section>
      <footer className="site-footer">
        <strong>
          SCORE<span>UP</span>
        </strong>
        <p>Strategy. Risk. Bragging rights.</p>
        <small>© 2026 ScoreUp</small>
      </footer>
    </main>
  );
}
