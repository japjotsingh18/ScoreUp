# Milestone 6: Game Completion and Polish

Milestone 6 completes the locally playable match. It does not deploy ScoreUp or begin Milestone 7.

## Finalization and ranking

After the final round's already-started Action and Mini-Game work finishes, the room enters `finalizing`. A unique highest score completes immediately. A tied highest score creates one championship attempt containing only those leaders. Completion is transactional and idempotent; reconnecting clients receive `finalizing`, `championship_tiebreaker`, or the immutable completed result.

Final ordering uses score descending. Championship placement orders only the tied leaders and never changes their stored score. Lower equal scores use competition ranking—for example `1, 2, 2, 4`—and immutable join order only stabilizes presentation within the tie.

## Championship Stop the Bar

Every finalist receives the same server-derived target, speed, direction, start, and deadline. The database validates range and feasible receipt timing, then compares target distance, valid completion time, and finally a cryptographically secure fallback. A disconnected player cannot deadlock completion: after the deadline, one valid finalist wins by timeout, while remaining unresolved cases use the secure fallback. Duplicate submissions and repeated finalization return existing authority without awarding points.

## Match awards

- Most points locked in: largest cumulative Lock In award.
- Biggest point-card challenge victory: largest single combined challenge award.
- Most Action Card draws: largest successfully resolved draw count.
- Mini-Game victories: largest settled Mini-Game win count.
- Biggest comeback: largest improvement from worst recorded round-end rank to final rank.

Every category is derived once from authoritative records during completion. Positive ties create multiple award rows. Categories with no qualifying positive value create none and render as “No qualifying play.”

## Rematch and local preferences

Rematch creates a new lobby/room identity with the same configuration, connected roster, and host. It resets readiness and all match-specific state because none of the old room's cards, ledger, operations, submissions, events, result, or Realtime messages are copied. Return Home best-effort marks the current seat disconnected, removes the game subscriptions on unmount, and preserves the anonymous auth session.

Sound and reduced-motion settings live only in local browser storage. Sound is synthesized locally after interaction; it carries no game state and is never required. Reduced motion respects both the explicit toggle and `prefers-reduced-motion`, removes decorative transitions, and changes Stop the Bar to a lower-frequency textual position announcement without changing its server-timed conditions.

## Accessibility and browser verification

The final, championship, lobby, and gameplay states use landmarks, ordered headings, labeled controls, non-color status text, live status/error regions, visible focus, mobile touch targets, and keyboard-operable Stop the Bar. Axe automated checks run in real Chromium for both lobby contexts, the championship, completed result, and timeout result; the gate rejects serious or critical violations. This is a scoped automated audit, not a claim of complete WCAG conformance.

`npm run test:e2e` starts the local app and runs two isolated anonymous browser contexts against local Supabase. The flow covers create/join/ready/start, Action progression, distinct owner-only cards, Lock In, challenge resolution, Mini-Game queue/settlement, Realtime, refresh recovery, championship, timeout/disconnect, final result, clipboard share, fresh-room rematch, stale-source isolation, and outsider rejection. Install its browser once with `npx playwright install chromium`.

## Dependency security and limitations

Next.js and `eslint-config-next` were updated together from 16.2.6 to the compatible non-major 16.3.1 release. The resulting production tree uses Nano ID 3.3.18, PostCSS 8.5.23, and Sharp 0.35.3; `npm audit --omit=dev` reports zero vulnerabilities. No forced audit fix was used.

Known MVP limitations are browser-timing integrity for Mini-Games/championship, activity-triggered host transfer, and no tournament-grade device attestation. Native Web Share is not enabled in this build; Share Results uses a public-safe clipboard path with an accessible manual-copy fallback. Production deployment, hosted migration application, monitoring, and smoke testing remain Milestone 7.

## Migration recovery

For local recovery, run `npm run db:reset`. Before hosted rollout, snapshot the database and review `20260813050000_game_completion_polish.sql`. If rollout fails before use, restore the snapshot. After completion or rematch rows exist, preserve history with a corrective forward migration or restore the full snapshot; do not drop result tables or weaken RLS, grants, constraints, private seeds, or authorization checks.
