import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" href="/" aria-label="ScoreUp home">
      <span className="brand-mark" aria-hidden="true">
        <span>SU</span>
        <ArrowUpRight size={15} strokeWidth={3} />
      </span>
      {!compact && (
        <span className="brand-name">
          SCORE<span>UP</span>
        </span>
      )}
    </Link>
  );
}
