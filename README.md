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

## Review the 3D viewer prototype

Try the [hosted Atlas example](https://loomtracer.vercel.app/graph/prototype), or run `npm ci` and `npm run dev --workspace=web` from the repository root and open [the local prototype](http://127.0.0.1:3000/graph/prototype). The fictional records are bundled, so you can review the layout and example charts before connecting a ledger.

Search for a decision and select its headline to read its sources. Switch between the 3D graph and the tree, scrub the timeline beneath them, then save a named view. Its tab restores the graph position, selected record and point in history after a refresh. Project navigation is in the header. These controls share the same workspace on desktop and phone widths.

To try ledger data, open a project in `/graph` and choose **Open in 3D viewer**. Its relationship charts and saved views use that project’s records. On loopback, the fictional Atlas project also supports questions through a signed-in local Codex app server. See [web setup](web/README.md) for the connection details.

## Two repositories, one contract

[`web/LOOMTRACER_API_MAP.md`](web/LOOMTRACER_API_MAP.md) is the contract between this repo and
`alexknips/loomtracer`: which endpoint each page reads. The UI is tested against the Loomtracer
release named in [`LOOMTRACER_VERSION`](LOOMTRACER_VERSION).

A change that touches both sides is two pull requests, in this order:

1. The backend PR lands in `alexknips/loomtracer` and is released.
2. The frontend PR here raises `LOOMTRACER_VERSION` to that release, with the UI change.

Run the browser tests against the pinned release with `scripts/e2e-pinned.sh`.

## Deploying

Vercel builds the app from the project root `web/`.

## Licence

AGPL-3.0-only, like Loomtracer. See [`LICENSE`](LICENSE).
