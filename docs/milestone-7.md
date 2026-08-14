# Milestone 7: Production Deployment and Final Documentation

Milestone 7 packages the verified game for production, adds continuous integration and security headers, publishes the repository, applies the checked-in migrations to a dedicated Supabase project, deploys the Vinext output through Cloudflare-backed Sites, and records operational procedures.

## Deployment architecture decision

The Vinext build produces a Worker entry point at `dist/server/index.js`, an RSC/SSR bundle, and static assets in `dist/client`. A static-only Cloudflare Pages upload would omit the server entry point. The repository therefore keeps its established framework and uses the existing `.openai/hosting.json` Sites contract, which packages the Worker and assets together. No framework migration or deprecated Next-on-Pages adapter is introduced.

## Local release gate

The release gate includes locked dependency installation, local Supabase startup/reset, schema lint, all pgTAP assertions, formatting, strict TypeScript, ESLint, Vitest, two-context Chromium, production build, production-only audit, and whitespace validation. Blocked or skipped commands remain unverified.

## Production safeguards

- The production project is linked only after its name, region, and reference are confirmed.
- Migration history is inspected before and after `db push`.
- The local seed and pgTAP fixtures are never applied to production.
- Browser configuration contains only the Supabase HTTPS URL and public publishable key.
- CSP permits only the configured Supabase HTTPS/WSS origins.
- Hosted smoke tests use independent anonymous identities and clearly identified rooms.
- A release is not declared production-ready until remote CI, migrations, deployment, headers, and the live multiplayer flow all pass.

## Release record

The repository URL, production URL, deployment/version identifiers, deployed commit, remote migration status, CI run, smoke-test evidence, and any remaining manual actions are recorded in the final Milestone 7 report after the authoritative services complete.

See [production architecture](architecture.md), [operations](operations.md), [database design](database-schema.md), and [security model](security-model.md).
