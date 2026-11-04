/** Offline synthetic source inspection. This module never imports or activates authority. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { bundleSchema, validateBundle } from './domain.ts';
import type { ReasoningBundle } from './types.ts';

const id = z.string().min(1).max(300);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().refine(value => /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)));
const recording = z.object({ actorId: id, recordedAt: instant }).strict();
// Server connectionId refers to an agent connection, not a portable graph Connection.
const serverGrant = bundleSchema.shape.authorityGrants.element.extend({ connectionId: id }).strict();
const datasetSchema = z.object({
  bundle: bundleSchema, head: id, recording,
  captureMetadata: z.record(id, recording),
  commitments: bundleSchema.shape.commitmentReceipts,
  authorityGrants: z.array(serverGrant), sha256: digest,
}).strict();
export const previewEnvelopeSchema = z.object({
  format: z.literal('loomtracer-migration-preview'), version: z.literal(1), synthetic: z.literal(true),
  source: z.object({ system: z.literal('hosted-reasoning'), instanceId: id, schemaVersion: z.literal('0.3.0') }).strict(),
  scope: z.object({ workspaceId: id, projectId: id, datasetIds: z.array(id).min(1) }).strict(),
  coverage: z.object({
    reasoningHistory: z.enum(['synthetic-fixture', 'unknown', 'unavailable']),
    storageAudit: z.enum(['not-modeled-synthetic', 'unknown', 'unavailable']),
    consistency: z.enum(['static-fixture', 'unknown', 'unavailable']),
  }).strict(),
  datasets: z.array(datasetSchema).min(1),
  artifacts: z.array(z.object({ ref: id, encoding: z.enum(['utf8', 'base64']), content: z.string(), sha256: digest }).strict()),
}).strict();
export type PreviewEnvelope = z.infer<typeof previewEnvelopeSchema>;

/** Version 1 serialization: recursively sort object keys; retain array order; UTF-8. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  throw new Error('Expected JSON data');
}
export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const hashJson = (value: unknown) => sha256(canonicalJson(value));

type Issue = { severity: 'invalid' | 'blocked' | 'review'; code: string; path: string };
type QualifiedNamespace = { sourceInstanceId: string; workspaceId: string | null; projectId: string | null; datasetId: string | null };
type Dependency = { kind: string; id: string; namespace: QualifiedNamespace; scope: 'local' | 'external-pointer' };
type InventoryRecord = {
  kind: string; id: string; namespace: QualifiedNamespace; originKey: string; payloadSha256: string;
  disposition: 'preserved-for-review' | 'exclude-unused-identity';
  dependencies: Dependency[]; targetSupport: 'not-established'; requirements: string[];
  attribution?: { expressed: 'known' | 'unknown'; recorded: 'known' | 'unresolved' };
};
export type PreviewReport = {
  format: 'loomtracer-migration-preview-report'; version: 1;
  status: 'requires-review' | 'blocked' | 'invalid'; valid: boolean;
  completenessEstablished: false; sourceAuthenticity: 'not-established';
  sourceArtifactCorrespondence: 'not-established';
  destinationMapping: 'not-implemented'; authority: 'unchanged';
  counts: Record<string, number>; records: InventoryRecord[]; issues: Issue[];
};
const kinds = ['actors', 'contexts', 'sources', 'attachments', 'entries', 'connections', 'runs', 'reviewNotes', 'authorityGrants', 'commitmentReceipts', 'externalEntryRefs'] as const;

/** A valid fixture proves local structure/integrity only, never deployment completeness. */
export function previewMigration(input: unknown): PreviewReport {
  const issues: Issue[] = [], records: InventoryRecord[] = [];
  const issue = (severity: Issue['severity'], code: string, path = '') => issues.push({ severity, code, path });
  const finish = (): PreviewReport => {
    issues.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b), 'en'));
    records.sort((a, b) => a.originKey.localeCompare(b.originKey, 'en'));
    const counts: Record<string, number> = {};
    for (const record of records) counts[record.kind] = (counts[record.kind] ?? 0) + 1;
    const invalid = issues.some(item => item.severity === 'invalid');
    return { format: 'loomtracer-migration-preview-report', version: 1,
      status: invalid ? 'invalid' : issues.some(item => item.severity === 'blocked') ? 'blocked' : 'requires-review',
      valid: !invalid, completenessEstablished: false, sourceAuthenticity: 'not-established',
      sourceArtifactCorrespondence: 'not-established',
      destinationMapping: 'not-implemented', authority: 'unchanged', counts, records, issues };
  };
  const parsed = previewEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    for (const error of parsed.error.issues) issue('invalid', `schema:${error.code}`, error.path.join('.'));
    return finish();
  }
  const envelope = parsed.data;
  for (const [key, value] of Object.entries(envelope.coverage)) {
    if (value === 'unknown' || value === 'unavailable') issue('blocked', 'coverage-not-established', `coverage.${key}`);
  }
  issue('review', 'synthetic-evidence-only');
  issue('review', 'destination-contract-required');
  const actualIds = envelope.datasets.map(item => item.bundle.id);
  if (new Set(envelope.scope.datasetIds).size !== envelope.scope.datasetIds.length ||
      canonicalJson([...new Set(actualIds)].sort()) !== canonicalJson([...envelope.scope.datasetIds].sort())) issue('invalid', 'dataset-scope-mismatch', 'scope.datasetIds');
  const artifacts = new Map<string, PreviewEnvelope['artifacts'][number]>();
  for (const artifact of envelope.artifacts) {
    if (artifacts.has(artifact.ref)) issue('invalid', 'duplicate-artifact', artifact.ref);
    artifacts.set(artifact.ref, artifact);
    const bytes = Buffer.from(artifact.content, artifact.encoding === 'utf8' ? 'utf8' : 'base64');
    if (artifact.encoding === 'base64' && bytes.toString('base64') !== artifact.content) issue('invalid', 'invalid-base64', artifact.ref);
    if (sha256(bytes) !== artifact.sha256) issue('invalid', 'artifact-hash-mismatch', artifact.ref);
  }
  const origins = new Map<string, string>();
  const datasetHashes = new Map<string, string>();
  const addRecord = <T extends { id: string; version?: number }>(namespace: QualifiedNamespace, kind: string, value: T, dependencies: Dependency[], requirements: string[], unused = false, attribution?: InventoryRecord['attribution']) => {
    const originKey = hashJson({ source: namespace.sourceInstanceId, workspaceId: namespace.workspaceId,
      projectId: namespace.projectId, datasetId: namespace.datasetId, kind, id: value.id, version: value.version ?? null });
    const payloadSha256 = hashJson(value), previous = origins.get(originKey);
    if (previous) {
      if (previous !== payloadSha256) issue('invalid', 'origin-payload-conflict', originKey);
      else issue('review', 'repeated-origin', originKey);
      return;
    }
    origins.set(originKey, payloadSha256);
    records.push({ kind, id: value.id, namespace, originKey, payloadSha256,
      disposition: unused ? 'exclude-unused-identity' : 'preserved-for-review',
      dependencies, targetSupport: 'not-established', requirements, ...(attribution ? { attribution } : {}) });
  };
  for (const [index, dataset] of envelope.datasets.entries()) {
    const path = `datasets.${index}`, { bundle, sha256: expected, ...rest } = dataset;
    const namespace: QualifiedNamespace = { sourceInstanceId: envelope.source.instanceId, ...bundle.namespace };
    const projectNamespace = { ...namespace, datasetId: null };
    const connectionNamespace = { ...namespace, projectId: null, datasetId: null };
    if (hashJson({ ...rest, bundle }) !== expected) issue('invalid', 'dataset-hash-mismatch', path);
    if (datasetHashes.has(bundle.id) && datasetHashes.get(bundle.id) !== expected) issue('invalid', 'dataset-origin-conflict', path);
    datasetHashes.set(bundle.id, expected);
    if (bundle.namespace.workspaceId !== envelope.scope.workspaceId || bundle.namespace.projectId !== envelope.scope.projectId) issue('invalid', 'namespace-scope-mismatch', path);
    const validation = validateBundle(bundle);
    // Domain messages may include source-controlled identifiers; keep the report content-free.
    if (!validation.ok) issue('invalid', 'bundle-invalid', path);
    if (bundle.contexts.some(context => context.kind === 'ledger_record')) issue('invalid', 'frontend-only-context-in-hosted-source', path);
    const localKinds = new Map(kinds.flatMap(kind => bundle[kind].map(item => [item.id, kind] as const)));
    const localIds = new Set(localKinds.keys());
    const actorIds = new Set(bundle.actors.map(actor => actor.id));
    const usedActors = new Set<string>();
    const noteActor = (actor: string | null | undefined) => { if (actor) usedActors.add(actor); };
    noteActor(dataset.recording.actorId);
    addRecord(namespace, 'datasetMetadata', { id: bundle.id, schemaVersion: bundle.schemaVersion, title: bundle.title, namespace: bundle.namespace, manifest: bundle.manifest, head: dataset.head, recording: dataset.recording }, [], ['original-namespace-head-and-frozen-manifest', 'source-recording-attribution']);
    for (const [recordId, capture] of Object.entries(dataset.captureMetadata)) {
      if (!localIds.has(recordId)) issue('invalid', 'capture-unknown-record', `${path}.captureMetadata`);
      noteActor(capture.actorId);
    }
    for (const recordId of localIds) if (!Object.hasOwn(dataset.captureMetadata, recordId)) issue('blocked', 'capture-metadata-missing', `${path}:${recordId}`);
    for (const source of bundle.sources) { noteActor(source.actorId); noteActor(source.provenance?.recordedBy); }
    for (const record of [...bundle.entries, ...bundle.connections]) { noteActor(record.provenance.expressedBy); noteActor(record.provenance.recordedBy); }
    for (const run of bundle.runs) noteActor(run.recordedBy);
    for (const note of bundle.reviewNotes) noteActor(note.reviewer);
    for (const grant of [...bundle.authorityGrants, ...dataset.authorityGrants]) { noteActor(grant.agentActorId); noteActor(grant.ownerActorId); }
    for (const receipt of [...bundle.commitmentReceipts, ...dataset.commitments]) noteActor(receipt.actorId);
    for (const actor of usedActors) if (!actorIds.has(actor)) issue('blocked', 'server-actor-evidence-unresolved', `${path}:${actor}`);
    for (const [recordId, capture] of Object.entries(dataset.captureMetadata)) {
      addRecord(namespace, 'serverCaptureMetadata', { id: recordId, ...capture }, [{ kind: localKinds.get(recordId) ?? 'unknown-record', id: recordId, namespace, scope: 'local' }], ['authenticated-recording-distinct-from-portable-provenance', 'privacy-filter-with-captured-record'], actorIds.has(recordId) && !usedActors.has(recordId));
    }
    for (const segment of bundle.manifest.segments) {
      const artifact = artifacts.get(segment.ref);
      if (!artifact) issue('blocked', 'segment-bytes-unavailable', `${path}:${segment.ref}`);
      else if (artifact.sha256 !== segment.sha256) issue('invalid', 'segment-hash-mismatch', `${path}:${segment.ref}`);
    }
    for (const attachment of bundle.attachments) {
      const encoded = attachment.dataUrl.split(',')[1], bytes = Buffer.from(encoded, 'base64');
      if (bytes.toString('base64') !== encoded || sha256(bytes) !== attachment.sha256) issue('invalid', 'attachment-hash-mismatch', `${path}:${attachment.id}`);
    }
    const externalIds = new Set(bundle.externalEntryRefs.map(item => item.id));
    for (const kind of kinds) for (const record of bundle[kind]) {
      const dependencies: Dependency[] = [], requirements = ['destination-representation-required'];
      const dep = (type: string, value: string | null | undefined, targetNamespace = namespace, external = false) => { if (value) dependencies.push({ kind: type, id: value, namespace: targetNamespace, scope: external ? 'external-pointer' : 'local' }); };
      let attribution: InventoryRecord['attribution'];
      if ('provenance' in record && record.provenance && 'sourceSpans' in record.provenance) {
        const provenance = record.provenance;
        dep('actors', provenance.expressedBy); dep('actors', provenance.recordedBy);
        provenance.sourceSpans.forEach(span => dep('sources', span.messageId));
        requirements.push('exact-utf16-spans', 'distinct-expressing-and-recording-actors');
        if (provenance.basis === 'inferred') requirements.push('inferred-attribution-not-human-approval');
        if (provenance.occurredAt === null) requirements.push('unknown-occurrence-time-preserve-order');
        attribution = { expressed: provenance.expressedBy === null ? 'unknown' : 'known', recorded: actorIds.has(provenance.recordedBy) ? 'known' : 'unresolved' };
      }
      if ('contextId' in record) dep('contexts', record.contextId);
      if ('participants' in record) {
        record.participants.forEach(item => dep(externalIds.has(item.entryId) ? 'externalEntryRefs' : 'entries', item.entryId));
        dep('entries', record.rationaleEntryId);
        requirements.push('named-participant-roles', ...(record.participants.length > 2 ? ['grouped-n-ary-assertion'] : []));
      }
      if ('sourceMessageIds' in record) {
        dep('runs', record.parentId); dep('actors', record.recordedBy);
        record.sourceMessageIds.forEach(value => dep('sources', value));
        record.addedEntryIds.forEach(value => dep('entries', value)); record.addedConnectionIds.forEach(value => dep('connections', value));
        record.replacements.forEach(value => { dep(value.kind === 'entry' ? 'entries' : 'connections', value.previousId); dep(value.kind === 'entry' ? 'entries' : 'connections', value.nextId); });
        (record.omissions ?? []).forEach(value => dep(value.kind === 'entry' ? 'entries' : 'connections', value.recordId));
        record.reviewResolutions.forEach(value => dep('reviewNotes', value.noteId));
        requirements.push('extraction-lineage-not-decision-supersession');
      }
      if ('attachmentIds' in record) { dep('actors', record.actorId); dep('actors', record.provenance?.recordedBy); dep('sources', record.supersededBy); record.attachmentIds.forEach(value => dep('attachments', value)); requirements.push('exact-source-content-and-order'); }
      if ('reviewer' in record) { dep('actors', record.reviewer); dep('runs', record.runId); record.sourceSpans.forEach(span => dep('sources', span.messageId)); if (record.target.id && record.target.kind !== 'missing') dep({ entry: 'entries', connection: 'connections', source: 'sources' }[record.target.kind], record.target.id); }
      if ('agentActorId' in record) { dep('actors', record.agentActorId); dep('actors', record.ownerActorId); dep('authorityGrants', record.priorGrantId); }
      if ('priorReceiptId' in record) { dep('entries', record.entryId); dep('actors', record.actorId); dep('authorityGrants', record.grantId); dep('commitmentReceipts', record.priorReceiptId); dep('connections', record.connectionId); record.sourceSpans.forEach(span => dep('sources', span.messageId)); }
      if (kind === 'authorityGrants' || kind === 'commitmentReceipts') requirements.push('portable-authority-is-untrusted');
      if (kind === 'externalEntryRefs') { const reference = record as ReasoningBundle['externalEntryRefs'][number]; dep('entries', reference.entryId, { sourceInstanceId: envelope.source.instanceId, ...reference.namespace }, true); requirements.push('pointer-only-do-not-fetch'); }
      addRecord(namespace, kind, record, dependencies, requirements, kind === 'actors' && !usedActors.has(record.id), attribution);
    }
    const grants = new Map(dataset.authorityGrants.map(item => [item.id, item]));
    const receipts = new Map(dataset.commitments.map(item => [item.id, item]));
    const entries = new Set(bundle.entries.map(item => item.id));
    const priorReceipts = new Set<string>(), revokedGrants = new Set<string>();
    for (const grant of dataset.authorityGrants) {
      const prior = grant.priorGrantId ? grants.get(grant.priorGrantId) : undefined;
      const agent = bundle.actors.find(actor => actor.id === grant.agentActorId), owner = bundle.actors.find(actor => actor.id === grant.ownerActorId);
      if (grant.projectId !== envelope.scope.projectId || (grant.action === 'grant') !== (grant.priorGrantId === null) ||
          (agent && agent.kind !== 'agent') || (owner && owner.kind !== 'human') ||
          (grant.action === 'revoke' && (!prior || prior.action !== 'grant' || prior.agentActorId !== grant.agentActorId || prior.connectionId !== grant.connectionId || Date.parse(prior.recordedAt) > Date.parse(grant.recordedAt) || revokedGrants.has(prior.id)))) issue('invalid', 'server-grant-lineage-invalid', `${path}:${grant.id}`);
      if (grant.priorGrantId) revokedGrants.add(grant.priorGrantId);
      const dependencies: Dependency[] = [{ kind: 'agentConnections', id: grant.connectionId, namespace: connectionNamespace, scope: 'external-pointer' }];
      if (grant.priorGrantId) dependencies.push({ kind: 'serverAuthorityGrants', id: grant.priorGrantId, namespace: projectNamespace, scope: 'local' });
      addRecord(projectNamespace, 'serverAuthorityGrants', grant, dependencies, ['unverified-server-claim', 'destination-permission-not-granted', 'referenced-agent-connection-state-required']);
    }
    for (const receipt of dataset.commitments) {
      const prior = receipt.priorReceiptId ? receipts.get(receipt.priorReceiptId) : undefined;
      const actor = bundle.actors.find(item => item.id === receipt.actorId), grant = receipt.grantId ? grants.get(receipt.grantId) : undefined;
      const entry = bundle.entries.find(item => item.id === receipt.entryId);
      if (bundle.contexts.find(context => context.id === entry?.contextId)?.kind === 'illustration') issue('invalid', 'server-illustration-commitment', `${path}:${receipt.id}`);
      if (!entries.has(receipt.entryId) || (receipt.action === 'adopt') !== (receipt.priorReceiptId === null) ||
          (receipt.priorReceiptId && (!prior || prior.action === 'withdraw' || prior.id === receipt.id || priorReceipts.has(prior.id) || Date.parse(prior.recordedAt) > Date.parse(receipt.recordedAt))) ||
          (receipt.action === 'revise' && prior?.entryId === receipt.entryId) ||
          (receipt.action === 'withdraw' && prior?.entryId !== receipt.entryId) ||
          (receipt.grantId && !grants.has(receipt.grantId))) issue('invalid', 'server-receipt-lineage-invalid', `${path}:${receipt.id}`);
      if (receipt.basis === 'authorized_action' && actor &&
          ((actor.kind !== 'human' && actor.kind !== 'agent') || (actor.kind === 'human' && receipt.grantId !== null) ||
           (actor.kind === 'agent' && (!grant || grant.action !== 'grant' || grant.agentActorId !== actor.id || grant.connectionId !== receipt.connectionId || Date.parse(grant.recordedAt) > Date.parse(receipt.recordedAt) || dataset.authorityGrants.some(event => event.action === 'revoke' && event.priorGrantId === grant.id && Date.parse(event.recordedAt) <= Date.parse(receipt.recordedAt)))))) issue('invalid', 'server-receipt-grant-mismatch', `${path}:${receipt.id}`);
      if ((receipt.basis.startsWith('legacy_') && !receipt.sourceSpans.length) ||
          (receipt.basis === 'legacy_state' && (receipt.action !== 'adopt' || !receipt.rationale.trim()))) issue('invalid', 'server-legacy-evidence-missing', `${path}:${receipt.id}`);
      if (receipt.priorReceiptId) priorReceipts.add(receipt.priorReceiptId);
      const visited = new Set([receipt.id]); let ancestor = prior;
      while (ancestor) {
        if (visited.has(ancestor.id)) { issue('invalid', 'server-receipt-cycle', `${path}:${receipt.id}`); break; }
        visited.add(ancestor.id); ancestor = ancestor.priorReceiptId ? receipts.get(ancestor.priorReceiptId) : undefined;
      }
      // The same UTF-16 boundary rule, without treating server connection IDs as graph IDs.
      for (const span of receipt.sourceSpans) {
        const source = bundle.sources.find(item => item.id === span.messageId);
        const split = (offset: number) => !!source && /[\uD800-\uDBFF]/.test(source.content.charAt(offset - 1)) && /[\uDC00-\uDFFF]/.test(source.content.charAt(offset));
        if (!source || span.start >= span.end || span.end > source.content.length || split(span.start) || split(span.end)) issue('invalid', 'server-receipt-spans-invalid', `${path}:${receipt.id}`);
      }
      const dependencies: Dependency[] = [{ kind: 'entries', id: receipt.entryId, namespace, scope: 'local' }, { kind: 'actors', id: receipt.actorId, namespace, scope: 'local' }];
      if (receipt.priorReceiptId) dependencies.push({ kind: 'serverCommitments', id: receipt.priorReceiptId, namespace, scope: 'local' });
      if (receipt.grantId) dependencies.push({ kind: 'serverAuthorityGrants', id: receipt.grantId, namespace: projectNamespace, scope: 'local' });
      if (receipt.connectionId) dependencies.push({ kind: 'agentConnections', id: receipt.connectionId, namespace: connectionNamespace, scope: 'external-pointer' });
      receipt.sourceSpans.forEach(span => dependencies.push({ kind: 'sources', id: span.messageId, namespace, scope: 'local' }));
      addRecord(namespace, 'serverCommitments', receipt, dependencies, ['unverified-server-claim', 'trust-continuity-required', 'no-synthetic-adoption']);
    }
    if (dataset.authorityGrants.length || dataset.commitments.length) issue('review', 'server-authority-not-authenticated', path);
    if (dataset.authorityGrants.length || dataset.commitments.some(receipt => receipt.connectionId)) issue('blocked', 'referenced-agent-connection-state-unavailable', path);
  }
  return finish();
}
