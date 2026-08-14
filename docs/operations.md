# Production operations

This runbook covers the ScoreUp MVP on Cloudflare Sites and Supabase. Replace angle-bracket placeholders with confirmed values from the deployment record. Never paste tokens, database passwords, secret keys, or service-role credentials into issues, logs, commands, screenshots, or committed files.

## Release checklist

1. Confirm the intended branch, Git diff, and production project.
2. Run the full local verification gate from `README.md`.
3. Confirm `.env.local` and generated credentials remain ignored.
4. Push the reviewed commit to `main` without rewriting history.
5. Wait for every required GitHub Actions job to pass.
6. Run `npx supabase migration list` and review every pending migration.
7. Verify a recent logical backup or recovery point. Free projects require regular CLI exports.
8. Apply migrations once with `npx supabase db push`—never include the local seed.
9. Re-run `npx supabase migration list` and safe authorization checks.
10. Build with the production public Supabase URL and publishable key.
11. Save and deploy the exact pushed commit through Sites.
12. Verify headers and complete the two-session production smoke test.

## Frontend deployment

```bash
npm ci
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
npm audit --omit=dev
```

Production browser configuration consists only of:

- `VITE_SUPABASE_URL`: the project HTTPS API URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: the public browser key, never a secret/service-role key.

These values are build inputs for Vite and runtime values for the Worker CSP. Preview builds must use a separate non-production Supabase project before they are allowed to mutate data. Do not point arbitrary pull-request deployments at production.

Sites versions are immutable deployment candidates tied to a Git commit. Roll back by selecting the last verified version in Sites/Cloudflare and redeploying it; do not force-push or rebuild an old commit with new dependencies. Inspect application exceptions in the Sites Worker logs and provider deployment logs.

## Database migrations

Link and inspect before every hosted change:

```bash
npx supabase link --project-ref <confirmed-project-ref>
npx supabase migration list
npx supabase db dump --linked --file <secure-offsite-path>/scoreup-$(date +%F).sql
npx supabase db push
npx supabase migration list
```

The dump destination must be a protected location outside the repository. Do not run `db reset --linked`, `db push --include-seed`, pgTAP fixtures, or local provisioning helpers against production. Apply corrective forward migrations after production use begins. Restore a full verified snapshot only during a declared incident with an understood recovery point and maintenance window.

The Free plan does not provide the same retained daily-backup access as paid plans. Maintain regular encrypted logical exports off-device, test restoration into a disposable non-production project, and record the export checksum and date without recording credentials.

## Supabase configuration

- Enable anonymous sign-ins and retain sensible anonymous-user rate limits.
- Set the Auth site URL to the exact production HTTPS origin.
- Allow only the production origin and explicitly managed preview origins as redirects.
- Keep Realtime channels private and public-channel access disabled.
- Keep RLS enabled on every exposed table and preserve column-level grants.
- Keep the service-role/secret key out of the browser and Cloudflare public variables.
- Monitor Auth users, database size/connections, Realtime messages/connections, bandwidth, storage, and API errors in the Supabase dashboard.
- Inspect Postgres, Auth, API, and Realtime logs during incidents; redact JWTs and payloads before sharing excerpts.

## Security headers and cache behavior

Verify the production origin with:

```bash
curl -I https://<production-host>/
curl -I https://<production-host>/assets/<hashed-asset>.js
```

HTML/RSC must be `private, no-store`; content-hashed assets must be immutable. Confirm CSP has the exact Supabase HTTPS and WSS host, contains no unrestricted wildcard, and does not block Auth, RPC, Realtime, fonts, or application assets.

## Monitoring and free-tier expectations

At the time of the Milestone 7 release, the Supabase Free plan documents two active free projects, 500 MB database size, 50,000 monthly active users, 5 GB egress, 1 GB file storage, and pausing after one week of inactivity. Limits and pricing change; verify the current [Supabase pricing page](https://supabase.com/pricing) before launch or load testing.

Cloudflare limits also change. Monitor Worker requests, errors, CPU time, deployment status, and asset delivery in the Cloudflare/Sites dashboards and consult the current [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/) before a public campaign.

No production telemetry SDK is added in this milestone. Operational visibility comes from provider logs, deployment status, browser-console smoke testing, GitHub Actions, and explicit incident notes.

## Incident response

1. Record the start time, affected URL, deployed commit, provider status, and user-visible impact.
2. Stop new frontend traffic by disabling/unpublishing the Sites deployment or switching access away from public; do not delete the project.
3. If database integrity may be affected, disable anonymous sign-ins and avoid further mutations.
4. Preserve logs and take a logical export when safe.
5. Roll the frontend back to the last verified Sites version if the fault is delivery-only.
6. For schema/data faults, prefer a reviewed forward migration. Restore only from a verified backup with an agreed recovery point.
7. Rotate any exposed secret in its provider, update only the relevant protected environment, redeploy, and invalidate the old value.
8. Re-run authorization and multiplayer smoke tests before restoring public access.
9. Document root cause, recovery, lost-data window, and preventive action.

The Supabase publishable key is intentionally public, but it must still be paired with effective RLS. A leaked service-role key, database password, personal access token, or Cloudflare token is a critical incident.

## MVP limitations and cleanup

Deadlines and host transfer are activity-triggered. A completely idle room does not progress until an authorized participant reconnects or invokes processing. Browser-measured Mini-Game and championship timing is validated but is not tournament-grade device attestation.

Use clearly prefixed production smoke-test display names and retain the exact room UUIDs. Remove only those known test resources after validating that cleanup will not erase unrelated history. Do not add broad or scheduled destructive cleanup without a separate retention decision, backup, dry run, and explicit approval.
