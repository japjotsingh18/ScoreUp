# Milestone 5: Mini-Game Challenges

Milestone 5 implements the one-token, stake-backed Mini-Game Challenge system. It does not implement the final first-place championship tiebreaker, rankings, rematches, sharing, or deployment.

## Queue and state machine

A player may request one challenge during `point_decisions`. A valid request acquires private locks for both participants and receives an immutable global FIFO position, but does not consume the token or lock points. Conflicting requests are rejected. After point-card scoring, the database enters `mini_game_resolution`, revalidates the FIFO head, recalculates its stake from current scores, and starts at most one challenge per room. Invalid heads are cancelled and skipped without consuming a token. Settlement releases both locks and starts the next valid item; an empty queue advances to round summary.

Browsers cannot choose the queue head or rely on a timer race. Any room participant may request queue/timeout processing, but the database selects the active row under locks and uses database time.

## Stakes and escrow

`matchedLimit = min(challengerScore, opponentScore)` at actual start.

- Half: `floor((matchedLimit / 2) / 50) * 50`
- All: `matchedLimit`
- Pot: `2 * stakePerPlayer`

Both deductions, the challenge state, and challenger-token consumption commit atomically. The challenged player's token is untouched. The winner receives the complete pot in one signed ledger entry. A server-side failure after escrow can invoke the private transactional refund path, which restores both deductions with auditable entries. Normal disconnects use the deadline result instead of refunds.

## Seeded games and tie handling

The database creates a cryptographically secure 32-byte seed and derives identical participant conditions, a three-second synchronized start, and an authoritative deadline.

- Stop the Bar compares the smallest validated normalized distance, then completion time.
- Memory Sequence independently verifies the submitted symbols and claimed correct consecutive prefix; most correct wins, then fastest.
- Find the Different Symbol independently derives the target cell; correct solutions beat incorrect ones and each incorrect tap adds 500 ms.

An ordinary tie creates one seeded Stop the Bar attempt using the same pot and no extra deduction. A repeated tie resolves with secure random selection. Database-owner-only pgTAP settings make random branches deterministic in rolled-back tests; authenticated clients cannot execute those helpers.

## Validation, privacy, and Realtime

Submission RPCs derive the player from `auth.uid()`, require challenge membership and active status, enforce start/deadline receipt windows, accept one compact result per player/attempt, and record validation reason, normalized result, replay key, and receipt time. Memory accuracy and Different Symbol answers are derived independently. Raw seeds and expected answers remain in `private.mini_game_specs` with no browser grants.

Only the two participants can read challenge details and the playable specification. Each participant can read only their own raw submission. Other room members receive public-safe phase/queue status. Realtime continues to publish only private `{ changed: true }` hints; every reconnect fetches a fresh actor-specific match snapshot, so missed hints do not lose a challenge or result.

Browser-measured timing is an explicit MVP limitation. Feasible bounds and server receipt windows reject obvious manipulation, but they cannot provide tournament-grade device attestation.

## Recovery and migration

Locally, `npm run db:reset` rebuilds Milestones 2–5 in order. For a hosted database, take a snapshot, review the checked-in migration, and use the normal Supabase migration workflow. If rollout fails before clients use Mini-Games, restore the snapshot. After real challenge/ledger rows exist, prefer a corrective forward migration or snapshot restore; dropping the relations would destroy escrow and match history. Never recover by weakening RLS, grants, constraints, or private-schema boundaries.
