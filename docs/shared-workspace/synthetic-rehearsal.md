# Run the synthetic shared-workspace rehearsal

This rehearsal answers two bounded questions: can distinct participants share native decisions
through the released backend, and what would need preservation when bringing a hosted
Entry/Connection history across? It does not migrate data or configure a live workspace.

Use Node 22.18 or later and install the locked dependencies from the repository root:

```bash
npm ci
npm run typecheck:reasoning
npm test
npm run test:shared-workspace
npm run preview:migration
```

The first shared-workspace run downloads the release named in `LOOMTRACER_VERSION` from the
official repository and verifies its archive checksum. Later runs reuse the ignored local
binary cache. Supported release platforms are Linux x86_64/arm64 and macOS arm64. No Rust
compiler, Docker, database service, account credential or deployed endpoint is needed.

## Shared-workspace test

`scripts/shared-workspace/run.mjs` creates and owns a temporary directory and a backend child
process. It creates fictional tenants and a project through the CLI, then serves on
`127.0.0.1` with an operating-system-assigned port. It learns the address from its own process.
The runner accepts a binary path, but no remote address or existing data directory. Inherited
database, authentication and integration settings are excluded from the child environment.

All users, agents, decisions and credentials are created just for this test. The assertions
exercise real HTTP and MCP requests, including:

- Separate human and agent identities sharing a tenant and a registered project.
- Contributions visible to the other participants through independent sessions, direct reads
  and the graph API used by the viewer.
- Exclusion of another tenant, even when it supplies a forged tenant-selection header.
- Empty MCP reads for the outsider using either its own session or a shared participant's
  session ID. Session IDs are reusable transport metadata; the bearer credential selects the tenant.
- Refusal of missing credentials and unauthorized administrative operations.
- Individual revocation while other participants and historical attribution remain intact.
- The existing explicit MCP actor override, observed as allowed. Passing the test must not
  be interpreted as proof that all MCP authorship is bound to the credential.

Successful output is a JSON report with `status: "passed"`, backend version/commit, named
checks, limitations and cleanup confirmation. Failure exits nonzero. The runner stops its
children and removes their scratch data on success, failure, timeout or SIGINT/SIGTERM/SIGHUP.
Temporary credentials are redacted from errors. As with any process, forced operating-system
termination cannot guarantee cleanup.

This is SQLite with opaque tokens. It does not test Postgres isolation, WorkOS login,
organization membership, the viewer's deployment access gate, real clients or Gas City worker
configuration. The graph API is exercised without a browser. Existing browser tests remain
available through `scripts/e2e-pinned.sh`.

## Read-only migration preview

`scripts/migration-preview.mts --synthetic` reads the committed fictional fixture. To inspect
another synthetic envelope, run:

```bash
node --experimental-strip-types scripts/migration-preview.mts --input synthetic-envelope.json
```

The version-1 preview envelope is an experimental inspection format, not a production export
or Rust import format. It contains an explicit workspace/project/dataset scope, a 0.3.0
ReasoningBundle, separate server receipt/grant claims, capture metadata and source artifacts.
The input must be explicitly marked synthetic. Do not substitute actual private history in
public fixtures or PR output.

The preview uses the existing bundle validator and adds actual SHA-256 verification, scope
checks, origin collision detection and separate inspection of server authority claims. Source
segments are checked against their provided original artifact bytes; hashes are not inferred
by concatenating selected messages. Dataset hashes use recursively key-sorted JSON objects,
unchanged array order, UTF-8 bytes, and SHA-256, excluding the dataset's own `sha256` field.
Attachment hashes use decoded bytes. These checks establish integrity within the supplied
fixture, not an authenticated source or a consistent production snapshot.
Matching extracted source text back to a segment's original format also remains unestablished;
the report exposes this as `sourceArtifactCorrespondence: "not-established"`.

The report inventories originals and their preservation requirements: exact UTF-16 spans,
distinct expressing/recording actors, grouped relationships, earlier versions, extraction
corrections, authority evidence and excluded-project pointers. It reports unused identities
as exclusions for review and keeps external references unresolved. It does not fetch them.
Records and dependency targets retain their namespaces so reused IDs across datasets remain
distinguishable. Review-note links use the same record-kind names as the inventory.
No source text, attachment bytes or credential values are copied into the report.

| Result | Exit code | Meaning |
| --- | ---: | --- |
| `requires-review` | 0 | Fixture structure and integrity passed; target representation still needs agreement. |
| `blocked` | 1 | Coverage, evidence or source bytes are missing or unresolved. |
| `invalid` | 2 | Schema, identity/scope, hash or source-reference checks failed. Unreadable JSON also exits 2. |

Every report leaves completeness unestablished, destination mapping unimplemented and authority
unchanged. Grouped Connections are never silently flattened, correction runs are never treated
as withdrawals, and copied receipts are never turned into approvals. The preview never calls
a service, writes a database or modifies its input. Save stdout separately if a report is needed.

## From rehearsal to a reviewed migration

Use the fixture and reported requirements to agree the destination representation and identity
contract. Then implement supported scoped source export, an idempotent importer and common
retrieval with their own tests. Obtain owner-provided live configuration for a bounded pilot.
Complete the [migration runbook](migration-runbook.md) before historical cutover and use
[onboarding](onboarding.md) to verify real participant access.

CI runs the preview unit tests, the synthetic CLI and the real pinned-backend harness. A local
pass is reproducible implementation evidence; it does not complete those live acceptance steps.
