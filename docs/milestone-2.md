# Milestone 2: multiplayer foundation

This milestone replaces the mock lobby with a secure, authoritative Supabase room lifecycle. It intentionally stops after the host locks a valid lobby into `starting`; dealing cards and initializing gameplay belong to Milestone 3.

## Runtime configuration

The browser reads only:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Configuration is validated before the Supabase library is loaded. Production URLs must use HTTPS; `http://localhost` and `http://127.0.0.1` are accepted for local Supabase. Missing, malformed, or placeholder values render a recoverable multiplayer-unconfigured state instead of crashing the application. No service-role credential is needed or permitted in the client.

## Local Supabase setup

1. Install Node.js 22.13+ and start Docker Desktop.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Run `npm run db:start`.
5. Run `npx supabase status`. Copy the API URL and publishable/anon key into the matching Vite variables in `.env.local`.
6. Run `npm run db:reset` to apply every migration and the local seed.
7. Run `npm run test:db`, then `npm run db:lint`.
8. Run `npm run dev` and open the printed local URL in two browser profiles or one normal and one private window.

Use `npm run db:stop` when finished. Local data is disposable; `db:reset` recreates it from migrations.

## Hosted Supabase setup

1. Create a Supabase project.
2. In Auth settings, enable anonymous sign-ins. Keep CAPTCHA/rate-limit controls appropriate for the deployment.
3. In Realtime settings, use private channels and disable public access. The client subscribes with `config.private: true`.
4. Run `npx supabase login`, then `npx supabase link --project-ref <project-ref>`.
5. Review pending SQL with `npx supabase db diff` as appropriate, then apply checked-in migrations with `npx supabase db push`.
6. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the frontend host. Redeploy after changing Vite variables because they are build-time public configuration.
7. Create two anonymous sessions and run the manual multi-client checks below.

Do not expose the legacy service-role secret, a secret API key, or database credentials to the frontend. The checked-in migration grants only the intended authenticated functions and safe columns.

## Identity and room lifecycle

On first use, the app calls `getSession`; it restores a valid session or calls `signInAnonymously`. Supabase persists that session in browser storage. A player row is bound to `auth.uid()`, so knowing a room code cannot take over another seat.

`create_room` creates the room and host in one transaction. A client-generated request UUID plus a transaction advisory lock makes retries idempotent. New create commands and join attempts use a lightweight server-only rate bucket; idempotent create retries do not consume it. `join_room` locks the room row before password, status, duplicate-name, and capacity checks, so simultaneous joiners cannot overfill it. The same authenticated identity reconnects to its existing seat without consuming another seat.

Ready, start, heartbeat, disconnect, remove, and leave operations are narrow authenticated RPCs. The host may start only when at least two players are connected and every connected player is ready. Start moves the room to `starting` and blocks further joins; it does not initialize gameplay.

## Realtime and recovery

Database triggers send a private room-scoped broadcast containing only `{ "changed": true }`. The message is an invalidation hint. Each client refetches `get_lobby_snapshot`, which is authorized against current membership and omits password hashes and auth user IDs.

Clients heartbeat every 15 seconds. Timestamp-only heartbeat updates do not broadcast, preventing a room-wide refetch loop. Server maintenance marks seats disconnected after 35 seconds without a heartbeat. A disconnected host retains host status for 60 seconds; the next authorized room operation after that grace period transfers host to the earliest connected active player. This activity-triggered design avoids a paid or always-on scheduler at the multiplayer-foundation stage. A completely idle room will not transfer its host until another member reconnects or performs an operation.

## Manual multi-client verification

1. In client A, create a private two-player room and copy its link.
2. In client B, verify a wrong password is rejected without disclosing hash details, then join with the correct password.
3. Verify each client sees the other after snapshot refresh, and that the host cannot start until client B is ready.
4. Ready client B; verify client A can start and both clients see the locked room.
5. Repeat with an unstarted room: close client A, wait more than 60 seconds, then toggle ready or reconnect in client B. Verify client B becomes host.
6. Verify a third identity cannot join a full room and a non-member cannot open the lobby UUID directly.

## Known limitations

- Host transfer and stale-seat cleanup are activity-triggered, not cron-driven.
- Anonymous users can lose control of their seat if browser storage is cleared; account linking is not part of this milestone.
- Lobby start stops at the `starting` state. Gameplay initialization is intentionally deferred to Milestone 3.
- The join limiter is per anonymous identity and room code. Production abuse controls should also use Supabase Auth CAPTCHA/rate limits and edge/network controls.
- Automated database verification requires a healthy Docker daemon; a Docker daemon failure is an environment gate, not a passing database test.
