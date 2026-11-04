# Loomtracer web UI

The front end for [Loomtracer](https://github.com/alexknips/loomtracer), memory for decisions: what
was decided, which options lost and why, and who decided. It is a Next.js app that reads a
Loomtracer server over its HTTP API, and nothing else.

It moved here from `alexknips/loomtracer` with its history. The backend stays there.

- `web/`: the Next.js app. [`web/README.md`](web/README.md) says how to run it.
- `packages/reasoning/`: `@loomtracer/reasoning`, the bundle format the app reads. Only `web/` uses it.
- `package.json`, `package-lock.json`: the npm workspace that joins the two.

## Run it

You need Node 20.9 or later and a running Loomtracer server (`loomtracer serve`, from the
[latest release](https://github.com/alexknips/loomtracer/releases)). Then `npm ci`, and follow
[`web/README.md`](web/README.md).

## Two repositories, one contract

[`web/LOOMTRACER_API_MAP.md`](web/LOOMTRACER_API_MAP.md) is the contract between this repo and
`alexknips/loomtracer`: which endpoint each page reads. The UI is tested against the Loomtracer
release named in [`LOOMTRACER_VERSION`](LOOMTRACER_VERSION).

A change that touches both sides is two pull requests, in this order:

1. The backend PR lands in `alexknips/loomtracer` and is released.
2. The frontend PR here raises `LOOMTRACER_VERSION` to that release, with the UI change.

Run the browser tests against the pinned release with `scripts/e2e-pinned.sh`.

## Shared workspace and onboarding

The repository split does not merge separate users' histories.
[Shared workspace consolidation](docs/shared-workspace/README.md) describes the current boundaries,
the migration procedure, and the information needed to establish one shared workspace.
[New user onboarding](docs/shared-workspace/onboarding.md) defines how another person joins that
workspace once it is ready.
[Contributing migration support](docs/shared-workspace/contributing.md) explains what can be
built independently and the evidence needed for a cross-repository handoff.
[Synthetic rehearsal](docs/shared-workspace/synthetic-rehearsal.md) runs the shared-workspace
test and migration preview without connecting to a live workspace. These development commands
require Node 22.18 or later (the web app's minimum version above is unchanged).

## Deploying

Vercel builds the app from the project root `web/`.

## Licence

AGPL-3.0-only, like Loomtracer. See [`LICENSE`](LICENSE).
