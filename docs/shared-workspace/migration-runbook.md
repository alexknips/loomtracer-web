# Merge existing histories into a shared workspace

Use this procedure when people already have separate Loomtracer histories and want one shared
working record. For a person joining without importing history, use [onboarding](onboarding.md).
This is a preparation runbook: the cross-format importer remains unimplemented, and this
workspace's shared access path must be selected and verified. Rust already supports admin
provisioning into a shared tenant in opaque-token mode. This runbook does not provide a
currently executable production merge command.

The first case is limited to Jeffrey and Alex's Loomtracer product and development history.
The reusable context and required owner inputs are in the [workspace overview](README.md).

These are requirements for a complete scoped-history cutover. Source-export work, a mapping
analyzer, synthetic fixtures and an isolated local test harness can proceed independently
before a shared endpoint exists. Their results establish only the behavior actually tested;
they do not establish a deployed shared workspace or a completed migration. Both owners must
agree on the destination representation, identity and authorization model, and trust-continuity
mapping before importing live history. A limited pilot must state its selected records and
remaining coverage gaps; it does not narrow the final preservation requirements or expand the
approved sharing scope. Keep the existing recording route until the cutover checks pass.

## 1 Define the boundary and destination

Record the source owners, selected projects and explicit record exceptions, destination
endpoint, tenant/workspace, project IDs, and deployed schema/version/commit. Treat human names,
project display names and product renames as labels, not identity mappings.

Check the actual permission boundary before adding anyone. A selected project in an API query
does not restrict a workspace-wide credential. Use an empty, dedicated shared boundary or a
verified equivalent. Do not invite a collaborator into an account containing excluded projects.
Give each human and agent a distinct identity. Establish who may read, propose, review and
commit; migrations must not silently expand those rights.

For each source, record how to export, where backups are retained, who can restore them, and
who may stop shared-project writes during cutover. A production target and its credentials
must come from its owner; a repository URL or Gas City dashboard is not a memory API address.

## 2 Take complete scoped snapshots

For the hosted Entry/Connection format, obtain the authenticated stored dataset response and project
metadata, not only the UI's **Export history** download. The portable bundle omits separate
server commitment/grant records and capture metadata. The inspected application read is
`GET /api/reasoning?project_ref=<ref>&dataset_id=<id>`; use an authorized application session or
supported project export. Never substitute direct database access or a service-role key.

That read contains the latest bundle, including all retained immutable contribution versions,
sources, extraction runs and review notes, plus current head/revision recording metadata and
separate authority/capture records. The source writer rejects removal of prior immutable
records; reading the latest bundle is not limited to the currently active contributions.

The omitted layer is storage audit: earlier `reasoning_revisions` parent links, manifests and
record membership, and `reasoning_operations` request hashes and retry results. Extraction
runs do not replace this audit. A supported export extension is needed to retain that layer
alongside the reasoning history. Record reasoning-history coverage and storage-audit coverage
separately. Keep the complete scoped storage audit in the private source archive; the common
graph does not need to display retry-cache records or reuse source operation IDs as destination
retry IDs. An owner-approved omission narrows the preservation claim and must be explicit;
none has been approved for this case. See the inspected [source storage contract][hosted-storage].

Snapshot all required sources, attachments or resolvable attachment references, entries,
connections, runs, review notes, external references, server commitments, grants, capture
metadata and revision recording metadata. Bind every export page to one consistent
authenticated snapshot. Its checkpoint must cover the selected dataset set and every head,
project authority events, and the non-secret status of referenced agent connections, including
revocation state. Grants and revocations can change without advancing a dataset head, and a
new dataset can appear between reads. Comparing dataset heads alone is insufficient. If a
consistent snapshot is unavailable, verify all of these components before and after export
and retry changes or retain a separately identified delta; do not label mixed state as one
snapshot. Record the consistency method and any unresolved limitation in the private manifest.

For a Rust source, use the owner-approved native export and preserve event UUIDs, payloads,
actors, times and causation. Determine the full dependency closure of selected product
records; include additional content only when it is in the approved sharing scope. Keep an
excluded target as an unresolved reference. If replay cannot represent that boundary, stop
and change the importer rather than expanding the export silently.

Keep immutable source snapshots private and checksum them. Build a separately identified
transfer package containing only approved content and referenced identity records. A source
bundle can contain unused workspace-wide actor records, and an owner-facing dataset listing
can include workspace-wide agent connection metadata. Filter both to the identity evidence
needed by the selected contributions and authority history; copying either registry wholesale
would exceed a project-only transfer. Preserve the original source snapshot privately and
document the filtering in the transfer manifest. Never include credentials in the package.
A hash mismatch is a failed snapshot.

## 3 Produce a mapping and loss report

The preview must account for every source record as mapped, preserved and queryable,
intentionally excluded by scope, or unresolved. Account for storage-audit records separately
as retained in the complete private audit archive; this category cannot substitute for
queryable contributions, relationships or authority history. An unresolved required record
blocks cutover. Use
`(source system, source namespace, record kind, original ID, version)` as the origin key;
an identical title or actor display name is not a duplicate identity.

| Source property | Required preservation |
| --- | --- |
| Original text and source spans | Exact content and UTF-16 half-open offsets; unchanged attachment/source hashes. Summaries are additional views. |
| Authorship | Expressing person, recording agent and authenticated submitting actor remain distinct. Unknown remains unknown. |
| Time and order | Preserve occurred-at, logged-at, recorded-at and source order independently. Keep original sequence offsets when destination offsets differ. |
| Entry identity and version | Preserve original IDs, logical IDs, versions, labels and contexts. Do not turn every Entry into an accepted Decision. |
| Connections | Preserve one assertion with all named participant roles, evidence spans, basis and rationale. N-ary comparisons and joint grounds must not become unqualified binary edges. |
| Extraction runs and review notes | Retain replacements, omissions, review resolutions and earlier versions. Extraction correction is not a source withdrawal or decision supersession. |
| Authority history | Preserve portable receipts and server-attested history separately, including their origin and basis. Importing either grants no new destination authority. |
| Grants | Preserve historical evidence; establish destination permissions through an explicit, verified authorization mechanism. A delegation flag is not an equivalent grant. |
| External references | Keep original namespace and target identity; do not fetch excluded projects to make a link look complete. |
| Conflicting positions | Keep both attributed contributions, their reasons and chronology. Do not select a winner during migration. |
| Storage audit | Retain revision ancestry, manifests and operation audit privately with coverage and hashes. It is recovery evidence, not a replacement for queryable reasoning history or a destination retry ledger. |

Rust's native ledger replay can preserve native events; it is not a generic Entry/Connection
converter. The existing frontend graph-to-bundle adapter is a display projection, not a
lossless reverse migration. The hosted `mergeBundles` helper also rejects different conversation
identities/namespaces and cannot merge these accounts.

The reviewed native replay renumbers event offsets and rewrites capture-draft IDs, resolving
causation through event UUIDs. It refuses some embedded numeric references, including
`notification.sent.source_event_ids` and `blocker.resolved.resolution_event_id`. Its dry-run
does not validate every causation/draft dependency, and UUID deduplication does not compare
existing payload content. Maintain the origin mapping, reject same-UUID/different-content
collisions in the migration preview, and verify a real isolated replay plus query parity.
See the pinned [replay implementation][replay] and [reference restrictions][replay-refs].

An extension that stores the original bundle plus native projections is a possible design.
It passes only if common API/MCP retrieval and the viewer expose the preserved records,
relationships and history. An inaccessible archive alongside a simplified graph does not pass.
The separately retained storage audit does not relax these requirements for reasoning and
authority history. Agree on this representation and its retrieval contract with both owners;
successful fixture conversion alone does not establish that agreement.

## 4 Rehearse in an isolated destination

Record the exact source heads, transfer hashes, mapping version, destination version and
migration operation ID. Run the preview before any import. Use a disposable tenant/store
with explicit isolation from production and with the same enforced identity model intended
for the shared service.

Apply the same transfer package twice: the second application must create zero duplicates
and must not change existing records. Reuse the operation ID and identical payload after an
uncertain result; first read back whether it committed. Do not automatically retry an ordinary
capture endpoint whose idempotency is not established.

Interrupt an import and verify safe resume. Inject a missing source, changed hash, ambiguous
actor, unauthorized project, malformed span and concurrent-head change. Each must produce an
explicit failure or a documented recoverable state, not a partially accepted silent merge.

Reconcile counts by kind and origin, content hashes, source-span resolution, connection
participants, run ancestry, all historical versions, unresolved references, and authority
history. Counts alone do not establish semantic equivalence. Review representative multi-party
comparisons, joint grounds, disputed authorship, corrections and unknown actors.

Separately compare effective current commitments and guidance against the reviewed source
baseline: adopted/revised/withdrawn state, scope, approved inheritance, actor authority, and
legacy versus verified authority basis. Agree and implement the destination's trust-continuity
mapping for preserved server-attested state. Do not recreate historical approvals as synthetic
new adoption actions, or silently demote active source commitments into ordinary untrusted
text. If the destination cannot represent that continuity, cutover remains blocked.

## 5 Verify common retrieval and the graph

Use independent Jeffrey and Alex identities and their actual agent clients. Verify all of:

- Both resolve the same shared tenant/workspace and project IDs and can retrieve the same
  imported source record by its mapped identifier.
- A contribution by Jeffrey is retrieved by Alex's agent and shown in the graph with its exact
  source and attribution; repeat in the other direction.
- A challenge, correction and attribution dispute remain distinguishable from a new commitment.
  Historical approvals remain traceable without granting the importer authority.
- Authoritative guidance agrees with the reviewed source baseline under the explicit continuity
  mapping; any intended difference has its own owner-authorized action and rationale.
- Grouped Connections, earlier versions and excluded external references remain navigable or
  explicitly marked unresolved. The viewer does not hide required unmapped content.
- Both Gas City workers retrieve the same relevant history before a task and publish outcomes
  to the shared memory service. Beads continue to identify task ownership and execution state.
- An excluded-project request and an impersonation/unauthorized-authority attempt are rejected
  by the service. UI hiding or a requested project filter is not enforcement.
- Revoking one participant's access blocks that participant without deleting historical
  attribution or the other participant's access.

Use a small, explicitly marked onboarding fixture for permission and failure tests. Then
perform one real joint task in the approved project. Record the record IDs and observed client
results as the dogfood proof; do not automatically create commitments as part of the proof.

## 6 Cut over the selected project

Before the cutover window, record both owners' acceptance of the reconciled result, unresolved
items, destination identity contract, backup recovery test and recording-route changes.
Pause or fence writes to the selected source project, record final source checkpoints, import
the remaining deltas, and repeat reconciliation. Unrelated source projects stay on their existing
routes. If project-scoped fencing is unavailable, resolve the write-freeze method with the source
owner first.

Update the viewer, both people's project-specific agent configurations, Gas City workers and
repository guidance to the confirmed shared endpoint and identifiers. Change only routes in
the selected scope. Verify actual installed MCP tools and authorization behavior; the hosted
Entry/Connection tools and Rust MCP tools are different contracts, not interchangeable names.

Keep old shared-project snapshots read-only and mark the new destination in a routing record.
Verify fresh and resumed agent sessions use the new route. A successful UI read does not prove
that background captures stopped using an old endpoint.

## 7 Recover without losing post-cutover work

Keep the original snapshots, source checkpoints, origin-to-destination mapping, transfer
packages and import receipts. Test restore before cutover. Before restoring or switching back,
fence writes and export every destination event created after the cutover checkpoint.

Do not point clients at an old snapshot while allowing new writes on both sides. Reconcile
post-cutover contributions through the reviewed mapping first. If reverse mapping is not
lossless, recover the shared destination from its backup and replay its native deltas; retain
the legacy snapshot for investigation. Document whether recovery is restoration or a forward
repair, which records are affected, and how clients resume one canonical recording route.

## Execution record template

Copy this blank template into private controlled storage for each migration. Completed
manifests, live inventory, original-to-destination mappings, reconciliation results and access
test evidence stay outside published documentation and public pull requests. Store source
snapshots and audit archives privately as well; record their controlled locations in the
private manifest. Keep credentials in the approved credential store, never in the manifest.
Public examples and test fixtures must use synthetic data and fictional identifiers.

| Field | Value |
| --- | --- |
| Run identifier and owners | `Pending` |
| Run scope: synthetic harness, limited pilot or full cutover | `Pending` |
| Approved shared scope, selected records and exclusions | `Pending` |
| Source namespaces, selected dataset set and checkpoints | `Pending` |
| Authority/connection-state checkpoint and snapshot consistency method | `Pending` |
| Source export hashes and private controlled locations | `Pending` |
| Reasoning-history and storage-audit coverage | `Pending` |
| Transfer filtering and dependency closure | `Pending` |
| Agreed representation, retrieval and trust-continuity contract | `Pending` |
| Destination API/MCP, tenant/project, version/commit | `Pending` |
| Identity mapping and enforced capabilities | `Pending` |
| Importer/mapping version and operation ID | `Pending` |
| Counts, hashes, unmapped records and reconciliation | `Pending` |
| Effective guidance/commitment comparison | `Pending` |
| Two-user retrieval and isolation evidence | `Pending` |
| Viewer and Gas City connection evidence | `Pending` |
| Cutover checkpoint and new recording route | `Pending` |
| Backup restore and post-cutover recovery evidence | `Pending` |
| Owner acceptance and remaining exceptions | `Pending` |

After a successful run, update [new-user onboarding](onboarding.md) with the actual supported
setup path and failure recovery learned from the run. Preserve the case evidence privately
and publish only reusable, sanitized instructions. Do not replace it with a claim that the
procedure was always supported.

[replay]: https://github.com/alexknips/loomtracer/blob/775bb277403237a4055ef8f1b9d741c00de4b89b/src/replay.rs#L46
[replay-refs]: https://github.com/alexknips/loomtracer/blob/775bb277403237a4055ef8f1b9d741c00de4b89b/src/replay.rs#L307
[hosted-storage]: https://github.com/TheChairmanMiao/neurofilament/blob/5c0a0278c6a6a094caa24329153c43f81700984f/supabase/migrations/20261012000000_reasoning_architecture.sql
