import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Brand } from "./brand";

export function PageShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="form-page">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="form-topbar">
        <Brand />
        <Link className="back-link" href="/">
          <ArrowLeft size={17} aria-hidden="true" /> Back home
        </Link>
      </header>
      <section className="form-layout">
        <div className="form-intro">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
          <div className="mini-scorecard" aria-label="Example score card">
            <span>ROUND CARD</span>
            <strong>+750</strong>
            <small>PLAY IT SMART</small>
          </div>
        </div>
        {children}
      </section>
    </main>
  );
}
