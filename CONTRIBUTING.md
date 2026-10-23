# Contributing

Before you open a pull request, run what CI runs (`.github/workflows/ci.yml`):

```bash
npm ci
npm run lint --workspace=web
npm run build
npm test
```

If you changed what a page reads or shows, also run the browser tests against the pinned release:

```bash
scripts/e2e-pinned.sh
```

## A change on both sides is two pull requests

[`web/LOOMTRACER_API_MAP.md`](web/LOOMTRACER_API_MAP.md) is the contract between this repo and the
backend, `alexknips/loomtracer`. The UI is pinned to one backend release in
[`LOOMTRACER_VERSION`](LOOMTRACER_VERSION).

When a UI change needs a new or changed endpoint:

1. Open the backend PR in `alexknips/loomtracer`. It lands and is released first.
2. Then open the frontend PR here. It raises `LOOMTRACER_VERSION` to that release and updates
   `web/LOOMTRACER_API_MAP.md` for the endpoint.

Do not raise the pin to a release that does not exist yet, and do not change the contract file
without the backend release that serves it.
