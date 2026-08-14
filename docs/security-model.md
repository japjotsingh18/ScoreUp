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

## Identity, reconnection, and rooms

Room codes are locators, not credentials. Control requires the original anonymous Supabase session. Private room passwords are verified server-side against a bcrypt-compatible pgcrypto hash with its salt embedded. Display names are trimmed, whitespace-normalized, length-limited, rejected for control characters, escaped by React, and compared case-insensitively inside each active room.

Heartbeats update `last_seen_at` through a bounded command. On reconnect, the same `auth.uid()` reclaims its player and receives an authoritative snapshot. A new anonymous identity cannot take over an active name. Host transfer is activity-triggered after a 60-second disconnected grace period and uses immutable join order; no external scheduler is required for this milestone.

## Secrets and deployment

The frontend receives only `VITE_SUPABASE_URL` and the public/publishable anonymous key. The Supabase service-role key is never required by this milestone and must not enter a Vite variable. Production Realtime channels must remain private, logs should redact payloads, error responses avoid internal detail, and dependency/security monitoring is part of deployment readiness.

## Abuse and residual risk

Server-side validation prevents ordinary score/card forgery, duplicate operations, cross-room actions, and replay. Seeded mini-games intentionally avoid streaming inputs, but a modified client could automate a known game after receiving its seed. Plausibility windows, delayed start specifications, compact validated results, anomaly telemetry, and rate limits reduce this risk; strong competitive integrity would require additional attestation or server-observable input commitments beyond the first release.
