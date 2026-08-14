# Security model

## Trust boundaries

The browser is untrusted. It may request an action and render a response, but it never supplies authoritative scores, card identities, stakes, winners, ranks, timers, random outcomes, or another player’s identity. Supabase Auth establishes an anonymous `auth.uid()`; room membership binds that identity to exactly one player row.

Narrowly scoped Postgres RPCs form the Milestone 2 command boundary. The database is the authority for state and time. Supabase Realtime publishes redacted change notifications; clients always recover with a fresh authorized snapshot. Edge Functions may be added only when later gameplay operations need compute that is unsuitable for a database transaction.

## Row Level Security

- Public room lookup exposes only join-safe metadata through a constrained RPC, never raw room rows or password hashes.
- Members can read public room/player state for their own room.
- Players can update no authoritative gameplay columns directly. Ready/heartbeat/leave actions go through validated commands.
- Password material and rate-limit buckets have no direct client select policy. Room/player grants omit `password_hash`, `created_by_user_id`, and `auth_user_id`.
- Direct inserts, updates, and deletes on rooms and players are denied to browser roles; authenticated functions perform the allowed mutations after actor checks.
- Match participants can read public rounds/events/decisions. An unresolved private card is visible only to its authenticated owner; completed rounds reveal cards to participants. The score ledger has no browser grant.
- Direct browser inserts, updates, and deletes on rounds, cards, decisions, scores, deadlines, phases, and events are denied.
- Action choices and draws force RLS and are owner-selectable only. The catalog, shields, mutation audit, score ledger, random selectors, and deterministic test controls have no browser grants.
- Mini-Game challenge rows are visible only to their two participants; submission rows are owner-only through a narrow security-definer identity predicate. Participant locks, raw seeds, expected answers, escrow ledger rows, selectors, and deterministic overrides have no browser table access.
- Championship participants can read the public attempt and only their own submission. Raw championship seed/expected result and deterministic controls remain private. Final results/awards are participant-readable and browser-write-denied.

## Command protections

1. Validate request bodies with shared schemas and strict allowlists.
2. Derive the player from `auth.uid()` plus room membership; ignore client-supplied actor IDs.
3. Verify room, phase, round, turn, deadline, target eligibility, and resource version.
4. Enforce join-attempt rate limits and creation idempotency; later gameplay commands will add their own replay keys.
5. Lock affected rows in stable UUID order to prevent double spending and deadlocks.
6. Use `pgcrypto` secure random bytes for room codes, card selection, and decision order. Test fixtures may set generated cards only while running as the database owner inside rolled-back transactions.
7. Return allowlisted lobby/match snapshots and publish payload-free invalidation hints. A match snapshot includes another player's card only after the round is completed.

## Core Game command boundary

`start_room`, `lock_in_point_card`, `challenge_point_card`, `process_expired_turn`, and `advance_round_summary` are fixed-search-path definers with minimal authenticated grants. They derive the actor from `auth.uid()`, lock authoritative rows, reject stale phases/turns/deadlines/targets, and use unique decisions, ledger sources, or private receipts to stop double awards and replay.

Public challenge events reveal only the two cards after both are resolved. General turn, timeout, score, and round events contain no card values. Realtime sends only `{ changed: true }`; clients then fetch a fresh actor-specific snapshot.

## Action Card command boundary

`submit_action_choice`, `submit_action_target`, `process_expired_action_phase`, and `process_expired_action_target` derive membership from `auth.uid()`, lock the room/round/draw, enforce phase and deadline state, and return a validated owner-specific snapshot. Weighted selection uses `gen_random_bytes`; normal clients cannot supply or invoke card codes, weights, effect parameters, secure targets, or outcomes. Database-owner-only settings make random branches deterministic in rolled-back pgTAP transactions, and selector helpers have no authenticated execute grant.

Before summary, an owner sees their own card name and private result. Other clients see only allowlisted public event data. Fresh Draw and Random Card Swap events disclose no old/new point values. Only Point Swipe is classified as a shield-blockable targeted negative effect; self-applied negative and unpredictable cards do not consume shields.

## Mini-Game command boundary

`request_mini_game_challenge`, `process_mini_game_queue`, `submit_mini_game_result`, `process_expired_mini_game`, and `get_mini_game_snapshot` derive identity and membership from `auth.uid()`. Room/round locks, participant-lock primary keys, a one-active-per-room partial index, request UUIDs, one-submission-per-attempt constraints, and signed ledger source keys protect queue order, escrow, and exactly-once settlement.

The database chooses the game, 32-byte seed, specification, synchronized start, deadline, and any fallback winner. It independently validates Memory accuracy and Different Symbol targets, range-checks Stop Bar positions, checks feasible timing and receipt windows, and derives all comparison values. Clients cannot submit a winner, score, stake, pot, seed, target, or adjusted result. Public events and private Realtime invalidation hints never include raw submissions, normalized results, seeds, or expected answers.

## Identity, reconnection, and rooms

Room codes are locators, not credentials. Control requires the original anonymous Supabase session. Private room passwords are verified server-side against a bcrypt-compatible pgcrypto hash with its salt embedded. Display names are trimmed, whitespace-normalized, length-limited, rejected for control characters, escaped by React, and compared case-insensitively inside each active room.

Heartbeats update `last_seen_at` through a bounded command. On reconnect, the same `auth.uid()` reclaims its player and receives an authoritative snapshot. A new anonymous identity cannot take over an active name. Host transfer is activity-triggered after a 60-second disconnected grace period and uses immutable join order; no external scheduler is required for this milestone.

Heartbeat-only `last_seen_at` writes do not emit game invalidations; otherwise each authorized refetch would create another broadcast/refetch cycle. A visible `connected` transition still emits an invalidation. Game pages refresh periodically, refetch after Realtime recovery, and best-effort mark the seat disconnected on page hide.

## Completion and rematch boundary

The database derives the final score set, winner, ranks, awards, and completion time. Championship callers cannot supply a seed, target, winner, distance, rank, score, or statistic. The attempt shares identical conditions and server time across finalists; one-submission constraints, room locks, replay receipts, and database deadlines make resolution idempotent and disconnect-safe.

A rematch is not an in-place reset. It creates a new room identifier and Realtime topic, then copies only approved configuration and roster fields. This prevents old operation UUIDs, submissions, snapshots, or events from controlling the new match while retaining the completed room as auditable history.

Playwright provisioning is Node-only, validates a loopback application origin and UUID room ID, and invokes the named local Supabase Docker database directly. It is not imported by application code, contains no service-role key, and cannot target a non-loopback deployment through its configured base URL.

## Secrets and deployment

The frontend receives only `VITE_SUPABASE_URL` and the public/publishable anonymous key. The Supabase service-role key is never required by this milestone and must not enter a Vite variable. Production Realtime channels must remain private, logs should redact payloads, error responses avoid internal detail, and dependency/security monitoring is part of deployment readiness.

The Cloudflare Worker and static asset configuration apply a shared CSP with exact Supabase HTTPS and WSS origins, frame denial, no object embedding, strict referrer behavior, limited browser capabilities, MIME-sniffing protection, and HTTPS transport security. Vinext's inline RSC bootstrap and embedded font styles currently require documented `'unsafe-inline'` script/style allowances; no third-party script/style origin or unrestricted CSP wildcard is allowed. Dynamic HTML/RSC responses are not cached, while content-hashed assets are immutable.

## Abuse and residual risk

Server-side validation prevents ordinary score/card forgery, duplicate operations, cross-room actions, and replay. Mini-Game participants receive a derived playable specification, never the raw seed; a modified client can still automate visible conditions or falsify plausible local elapsed time. Receipt windows, delayed synchronized starts, compact validated results, seed-derived answer verification, and infeasible-value rejection reduce abuse, but browser timing is not tournament-grade anti-cheat. Strong competitive integrity would require device attestation or server-observable input commitments beyond this MVP.

The same browser-timing limitation applies to championship Stop the Bar. Result sharing is intentionally limited to an allowlisted public text summary through clipboard/manual copy in this build; room codes, IDs, passwords, auth data, private cards, seeds, and submissions are excluded.
