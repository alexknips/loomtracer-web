# Contributing shared-workspace support

Contributors can implement and test migration tooling without a live destination account.
Owner provisioning is needed for live integration; it is not a prerequisite for local fixture
tests, export support, a migration preview, or navigation against released APIs.

This guide defines contribution boundaries and handoff evidence. It is not a task queue.
Track assigned work, dependencies and current status in the relevant repository's live Beads.

## Independently reviewable changes

| Change | Repository | Evidence available without Alex's deployment | Integration dependency |
| --- | --- | --- | --- |
| Scoped source export | Hosted Entry/Connection source | Authenticated project-scoped snapshot; complete semantic and audit coverage; source hashes; no unrelated identity leakage; export changes no authority. | Deploy the supported exporter before taking a real source snapshot. |
| Preservation contract and preview | This frontend's reasoning package | Synthetic bundles; origin inventory; loss report; dependency closure; UTF-16 span checks; collisions and excluded targets rejected or explicitly reported. | Agree the target representation before implementing a target-writing adapter. |
| Shared-tenant harness | This frontend's integration scripts, exercising the pinned Rust release | Disposable two-human/two-agent fixture; reciprocal REST/MCP visibility; other-tenant exclusion; revocation; actual actor behavior recorded. | SQLite opaque-token results do not establish Postgres, WorkOS or live-user acceptance. |
| Import and common retrieval | Rust backend | Draft implementation, interrupted/repeated-import tests, semantic reconciliation and queries in an isolated store. | Reviewed preservation/identity contract; backend review and release before frontend adoption. |
| Graph navigation | This frontend | Released API fixtures and browser tests for decision, source, relationships and supersession navigation. | New endpoint or history fields need a backend release; keep speculative UI work isolated until then. |
| Onboarding preflight | Integration scripts and reusable docs | Missing-config failures, version checks and synthetic connection tests. | Owner-provided endpoint, tenant, individual access and actual two-person/worker evidence. |

A small initial contribution can prove the existing shared-tenant path or produce a read-only
preservation preview. Those can be reviewed separately. An importer, authentication redesign
and viewer overhaul should not be bundled into one inseparable PR.

The synthetic implementation in this repository is described in [the rehearsal guide](synthetic-rehearsal.md).

The inspected hosted source is `TheChairmanMiao/neurofilament`, at
[`5c0a0278c6a6a094caa24329153c43f81700984f`][hosted-source]. Its current authenticated dataset
read preserves immutable bundle versions but does not expose the entire storage revision and
operation audit. Extend the supported application export with ordinary authenticated access;
do not use a service-role credential or a direct production database export. Verify the source
branch and deployed revision when implementation starts.

## Decisions to review jointly

The current [Rust scope][scope] and the hosted model are not equivalent. Jointly settle:

- Which source contributions and grouped relationships become native decision structures,
  and how the remaining required history stays retrievable.
- How original approvals, revisions, withdrawals, scopes and grants preserve their meaning.
  Source receipts are evidence; copying them must not create new destination authority.
- Whether the existing explicit MCP actor override is suitable for the intended participants.
  [Its regression test][actor-test] establishes deliberate current behavior. Changing it is a
  contract change with compatibility implications, not an unannounced bug fix.
- The live authentication mode, service ownership, approved source scope and cutover boundary.

Do not infer that an independently authored branch settles these decisions. A draft contract
and synthetic counterexamples make the review concrete without migrating actual history.

## Branch and review contract

The [Rust contribution rules][contributing] specify a branch from `master` named
`polecat/<bead-id>`, one bead per branch, and a PR against `master`. Include the bead identifier
in the PR and commit trailer. If the live tracker is unavailable, report that handoff gap;
do not invent an ID or treat the stale `.beads/issues.jsonl` export as the live tracker.
Use `codex/*` for this frontend's local work under its project workflow.

Repository write access permits feature branches; it does not confer service administration
or approval to merge changes to shared product semantics. Use reviewed PRs. The Rust repository
has an active [master ruleset][rules] requiring CI checks. Its contributor policy additionally
requires review and gates passing on the rebased state.

For a Rust code diff, follow the pinned toolchain and [quality gates][quality]:

```bash
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
```

Postgres changes also need `--features shared-backend-postgres`, a disposable Postgres supplied
through `LOOMTRACER_TEST_POSTGRES_URL`, and `LOOMTRACER_POSTGRES_POOL_SIZE=4`. Tests can self-skip
without that URL; a green default suite is not Postgres evidence. Docs-only Rust changes skip
local cargo gates under the documented exception. CI still applies. Outside-contributor
commits require the contributor's DCO sign-off.

For frontend changes, follow [CONTRIBUTING.md](../../CONTRIBUTING.md): install dependencies,
lint, build and run unit tests; run `scripts/e2e-pinned.sh` when page reads/display change.
Apply the project's UI style guide before creating or changing UI.

Backend changes land and release first. The frontend then updates `LOOMTRACER_VERSION` and
`web/LOOMTRACER_API_MAP.md` to the released contract. An edge build or unreleased backend PR
does not satisfy that dependency. CLI/MCP interface changes also need the matching regenerated
reference documentation in `alexknips/loomtracer-site`.

## A complete handoff

Each PR should state the concrete behavior, base/head commit, bead, changed contracts,
fixture/demo command, expected result, test evidence and known limitations. Identify the
specific decision or integration action needed from the maintainer. Separate tested behavior
from deployment assumptions, and state whether any real data has been touched.

Use entirely synthetic public fixtures. Keep actual snapshots, identity mappings, inventory,
receipt exports, reconciliation logs and credentials out of public repositories and PR bodies.
The local `private/` folder beside this guide is Git-ignored for owner handoffs and case notes;
it is not a backup system or a place for credentials. Keep durable data snapshots in controlled
storage with tested recovery.

[hosted-source]: https://github.com/TheChairmanMiao/neurofilament/tree/5c0a0278c6a6a094caa24329153c43f81700984f
[scope]: https://github.com/alexknips/loomtracer/blob/775bb277403237a4055ef8f1b9d741c00de4b89b/AGENTS.md#L55-L78
[actor-test]: https://github.com/alexknips/loomtracer/blob/775bb277403237a4055ef8f1b9d741c00de4b89b/tests/api.rs#L6474-L6493
[contributing]: https://github.com/alexknips/loomtracer/blob/775bb277403237a4055ef8f1b9d741c00de4b89b/CONTRIBUTING.md
[quality]: https://github.com/alexknips/loomtracer/blob/775bb277403237a4055ef8f1b9d741c00de4b89b/docs/QUALITY_GATES.md
[rules]: https://github.com/alexknips/loomtracer/rules/23211207
