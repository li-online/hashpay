# Contributing

HashPay is a Cloudflare Workers application, not a generic starter template. Keep contributions focused on the payment gateway itself and keep the Cloudflare deployment surface importable from a Git repository.

## Checks

Run these before submitting changes:

```sh
npm run check
npm run test
npm run deploy:dry
```

Use focused tests while iterating, then run the full checks above before handing off.

## Cloudflare Import Requirements

Cloudflare Workers Builds reads project metadata from `package.json` and deployment details from `wrangler.jsonc`. Keep these files aligned when changing runtime bindings or install requirements.

### `package.json`

Keep the following fields current:

- `name`: package name used by npm and local tooling.
- `description`: one-line application summary.
- `cloudflare.label`: readable name shown in Cloudflare import surfaces.
- `cloudflare.products`: three or fewer Cloudflare products that best describe the project.
- `cloudflare.bindings`: every runtime binding or secret that users must configure.

Do not set `cloudflare.publish` to `true` unless this repository is intentionally being submitted to a public template gallery with approved preview assets.

### `README.md`

The README must include:

- A short `dash-content-start` / `dash-content-end` block suitable for Cloudflare Dashboard display. Keep this section descriptive; do not put shell commands in it.
- Git import settings for Workers Builds.
- Runtime secret names and binding requirements.
- Local development steps.
- Cron testing instructions.

### `.gitignore`

Do not commit generated output, local Cloudflare state, dependency folders, or secrets. Keep example env files trackable:

- Commit `.dev.vars.example`.
- Do not commit `.dev.vars`.
- Commit `.env.example` if one is added.
- Do not commit `.env` or `.env.*`.

### `wrangler.jsonc`

`wrangler.jsonc` is the source of truth for Cloudflare bindings:

- `ASSETS` serves the Vite build output with SPA fallback.
- `DB` is the D1 database and points to `src/server/db/d1/migrations`.
- `QUEUE_NOTIFY` is the queue for merchant callback delivery.
- `triggers.crons` runs scheduled jobs.

After changing bindings, update:

- `package.json` `cloudflare.bindings`
- `README.md`
- `src/server/types/env.ts`
- tests that construct Worker env objects

Run `npm run cf-typegen` when generated Cloudflare types need to change.

## Secrets

Never commit real secrets. Configure these as Worker secrets in Cloudflare and in local `.dev.vars`:

- `TGBOT_TOKEN`
- `APP_SECRET`

If new secrets are introduced, add them to `.dev.vars.example`, `package.json` `cloudflare.bindings`, and `README.md`.

## Testing Guidance

Keep tests close to user-visible behavior and Worker boundaries:

- Payment providers should test asset identity, address matching, amount matching, time windows, and fake-token rejection.
- D1 migrations should remain repeatable.
- Admin and checkout flows should test API shape and permission boundaries.
- Cron behavior should test channel-level batching rather than per-order external requests.

Avoid tests that only lock in implementation details without protecting a real contract.

## Pull Request Checklist

- [ ] `npm run check` passes.
- [ ] `npm run test` passes.
- [ ] `npm run deploy:dry` passes when Wrangler config or runtime bindings changed.
- [ ] `package.json`, `README.md`, `.dev.vars.example`, and `wrangler.jsonc` stay aligned.
- [ ] New visible text is added to shared i18n.
- [ ] New payment drivers include frontend display metadata, browser probing behavior when available, server-side verification, and fake-asset tests.
- [ ] No secrets, generated build output, or local Cloudflare state are committed.
