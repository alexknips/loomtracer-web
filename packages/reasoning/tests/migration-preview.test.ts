import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hashJson, previewMigration, type PreviewEnvelope, type PreviewReport } from '../src/migration-preview';

const load = (): PreviewEnvelope => JSON.parse(readFileSync(new URL('./fixtures/migration-preview.json', import.meta.url), 'utf8'));
const rehash = (value: PreviewEnvelope) => {
  for (const dataset of value.datasets) {
    const { sha256: _old, ...payload } = dataset;
    dataset.sha256 = hashJson(payload);
  }
  return value;
};
const capture = (value: PreviewEnvelope, id: string) => { value.datasets[0].captureMetadata[id] = { ...value.datasets[0].recording }; };
const codes = (value: unknown) => previewMigration(value).issues.map(issue => issue.code);
const expectLocalDependenciesResolve = (report: PreviewReport) => {
  for (const record of report.records) for (const dependency of record.dependencies) {
    if (dependency.scope === 'local') expect(report.records.filter(target => target.kind === dependency.kind && target.id === dependency.id && hashJson(target.namespace) === hashJson(dependency.namespace))).toHaveLength(1);
  }
};

describe('synthetic migration preview', () => {
  it('validates a genuine 0.3 fixture while leaving target support and completeness unestablished', () => {
    const result = previewMigration(load());
    expect(result.status).toBe('requires-review'); expect(result.valid).toBe(true);
    expect(result.completenessEstablished).toBe(false); expect(result.authority).toBe('unchanged');
    expect(result.records.find(item => item.kind === 'connections')?.requirements).toContain('grouped-n-ary-assertion');
    expect(result.records.every(item => item.targetSupport === 'not-established')).toBe(true);
    expect(result.records.find(item => item.kind === 'actors' && item.id === 'unused-person')?.disposition).toBe('exclude-unused-identity');
    expect(JSON.stringify(result)).not.toContain('Option A costs less');
    expect(JSON.stringify(result)).not.toContain('Unused synthetic identity');
  });
  it('is deterministic, reports stable origin hashes and never mutates input', () => {
    const value = load(), before = JSON.stringify(value), first = previewMigration(value);
    expect(previewMigration(value)).toEqual(first); expect(JSON.stringify(value)).toBe(before);
    expect(first.records.every(item => /^[a-f0-9]{64}$/.test(item.originKey))).toBe(true);
  });
  it('rejects unsupported envelopes and fields instead of silently stripping data', () => {
    expect(previewMigration({ ...load(), synthetic: false }).status).toBe('invalid');
    expect(previewMigration({ ...load(), version: 2 }).status).toBe('invalid');
    expect(previewMigration({ ...load(), unexpected: 'private material' }).status).toBe('invalid');
  });
  it('detects modified content and actual artifact bytes', () => {
    const value = load(); value.datasets[0].bundle.entries[0].summary = 'Changed';
    expect(codes(value)).toContain('dataset-hash-mismatch');
    const artifact = load(); artifact.artifacts[0].content += '!';
    expect(codes(artifact)).toContain('artifact-hash-mismatch');
  });
  it('blocks missing bytes or unknown coverage without trusting declared counts', () => {
    const value = load(); value.artifacts = []; value.coverage.storageAudit = 'unavailable';
    expect(previewMigration(value).status).toBe('blocked');
    expect(codes(value)).toContain('segment-bytes-unavailable');
    expect(codes(value)).toContain('coverage-not-established');
  });
  it('checks attachment hashes over decoded bytes', () => {
    const value = load(), bundle = value.datasets[0].bundle;
    bundle.attachments.push({ id: 'image', mimeType: 'image/png', dataUrl: 'data:image/png;base64,eA==', sha256: '0'.repeat(64) });
    bundle.sources[0].attachmentIds.push('image'); capture(value, 'image');
    expect(codes(rehash(value))).toContain('attachment-hash-mismatch');
  });
  it('rejects out-of-range and split-surrogate source spans', () => {
    for (const unicode of [false, true]) {
      const value = load(), bundle = value.datasets[0].bundle;
      const start = unicode ? bundle.sources[0].content.indexOf('🚀') : 0;
      bundle.entries[0].provenance.sourceSpans = [{ messageId: 'source-one', start, end: unicode ? start + 1 : 9999 }];
      expect(codes(rehash(value))).toContain('bundle-invalid');
    }
  });
  it('preserves unknown authorship without manufacturing an actor', () => {
    const value = load(); value.datasets[0].bundle.entries[0].provenance.expressedBy = null;
    const result = previewMigration(rehash(value)); expect(result.valid).toBe(true);
    expect(result.records.find(item => item.kind === 'entries' && item.id === 'option-a-v1')?.attribution?.expressed).toBe('unknown');
  });
  it('rejects scope changes and unresolved local dependencies', () => {
    const scope = load(); scope.scope.projectId = 'another-project';
    expect(codes(scope)).toContain('namespace-scope-mismatch');
    const dependency = load(); dependency.datasets[0].bundle.connections[0].participants[0].entryId = 'missing';
    expect(codes(rehash(dependency))).toContain('bundle-invalid');
  });
  it('detects conflicting duplicate origins and does not merge by display name', () => {
    const value = load(), duplicate = structuredClone(value.datasets[0]);
    duplicate.bundle.entries[0].summary = 'Conflicting original'; value.datasets.push(duplicate);
    expect(codes(rehash(value))).toContain('origin-payload-conflict');
    const repeated = load(); repeated.datasets.push(structuredClone(repeated.datasets[0]));
    expect(codes(repeated)).toContain('repeated-origin'); expect(previewMigration(repeated).valid).toBe(true);
  });
  it('keeps server agent-connection IDs separate from portable graph Connections', () => {
    const value = load(), dataset = value.datasets[0], time = dataset.recording.recordedAt;
    dataset.authorityGrants.push({ id: 'server-grant', action: 'grant', agentActorId: 'recorder', ownerActorId: 'person-one', projectId: value.scope.projectId, recordedAt: time, priorGrantId: null, connectionId: 'agent-connection-only' });
    dataset.commitments.push({ id: 'server-receipt', action: 'adopt', entryId: 'assessment-v1', priorReceiptId: null, actorId: 'recorder', grantId: 'server-grant', recordedAt: time, rationale: 'Synthetic server claim', connectionId: 'agent-connection-only', basis: 'authorized_action', sourceSpans: [] });
    const result = previewMigration(rehash(value)); expect(result.valid).toBe(true); expect(result.status).toBe('blocked');
    expect(result.records.find(item => item.id === 'server-receipt')?.requirements).toContain('no-synthetic-adoption');
    expect(result.records.find(item => item.kind === 'serverAuthorityGrants')?.namespace).toEqual({ sourceInstanceId: value.source.instanceId, workspaceId: value.scope.workspaceId, projectId: value.scope.projectId, datasetId: null });
    expectLocalDependenciesResolve(result);
    expect(dataset.bundle.commitmentReceipts).toEqual([]);
    dataset.commitments[0].priorReceiptId = 'missing'; dataset.commitments[0].action = 'revise';
    expect(codes(rehash(value))).toContain('server-receipt-lineage-invalid');
  });
  it('preserves excluded external references as pointers without fetching or copying targets', () => {
    const value = load(), bundle = value.datasets[0].bundle;
    bundle.externalEntryRefs.push({ id: 'outside', namespace: { workspaceId: value.scope.workspaceId, projectId: 'excluded-project', datasetId: 'excluded-dataset' }, entryId: 'outside-entry', originalId: 'original-outside' }); capture(value, 'outside');
    const result = previewMigration(rehash(value)); expect(result.valid).toBe(true);
    expect(result.records.find(item => item.kind === 'externalEntryRefs' && item.id === 'outside')?.dependencies).toEqual([{ kind: 'entries', id: 'outside-entry', namespace: { sourceInstanceId: value.source.instanceId, workspaceId: value.scope.workspaceId, projectId: 'excluded-project', datasetId: 'excluded-dataset' }, scope: 'external-pointer' }]);
  });
  it('retains correction ancestry and both versions without claiming decision supersession', () => {
    const value = load(), bundle = value.datasets[0].bundle;
    const corrected = { ...structuredClone(bundle.entries[2]), id: 'assessment-v2', version: 2, summary: 'Corrected synthetic extraction' };
    const connection = { ...structuredClone(bundle.connections[0]), id: 'comparison-v2', version: 2 };
    connection.participants[0].entryId = corrected.id;
    bundle.entries.push(corrected); bundle.connections.push(connection);
    bundle.runs.push({ ...structuredClone(bundle.runs[0]), id: 'run-two', parentId: 'run-one', sourceMessageIds: [], addedEntryIds: [corrected.id], addedConnectionIds: [connection.id], replacements: [{ kind: 'entry', previousId: 'assessment-v1', nextId: corrected.id }, { kind: 'connection', previousId: 'comparison-v1', nextId: connection.id }] });
    [corrected.id, connection.id, 'run-two'].forEach(id => capture(value, id));
    const result = previewMigration(rehash(value)); expect(result.valid).toBe(true); expect(result.counts.entries).toBe(4);
    expect(result.records.find(item => item.kind === 'runs' && item.id === 'run-two')?.requirements).toContain('extraction-lineage-not-decision-supersession');
  });
  it('qualifies records and every dependency when two datasets reuse the same IDs', () => {
    const value = load(), second = structuredClone(value.datasets[0]);
    second.bundle.id = 'synthetic-dataset-two'; second.bundle.namespace.datasetId = second.bundle.id;
    value.datasets.push(second); value.scope.datasetIds.push(second.bundle.id);
    const result = previewMigration(rehash(value)); expect(result.valid).toBe(true);
    const repeatedEntries = result.records.filter(record => record.kind === 'entries' && record.id === 'option-a-v1');
    expect(repeatedEntries).toHaveLength(2);
    expect(new Set(repeatedEntries.map(record => record.namespace.datasetId))).toEqual(new Set(value.scope.datasetIds));
    expect(new Set(repeatedEntries.map(record => record.originKey)).size).toBe(2);
    expectLocalDependenciesResolve(result);
  });
  it('normalizes entry, connection and source review targets to resolvable inventory kinds', () => {
    const value = load(), bundle = value.datasets[0].bundle;
    for (const [kind, id] of [['entry', 'option-a-v1'], ['connection', 'comparison-v1'], ['source', 'source-one']] as const) {
      const noteId = `review-${kind}`;
      bundle.reviewNotes.push({ id: noteId, reviewer: 'person-two', createdAt: value.datasets[0].recording.recordedAt, runId: 'run-one', target: { kind, id }, sourceSpans: [], comment: 'Synthetic review' });
      capture(value, noteId);
    }
    const result = previewMigration(rehash(value)); expect(result.valid).toBe(true);
    expectLocalDependenciesResolve(result);
    expect(result.records.filter(record => record.kind === 'reviewNotes').flatMap(record => record.dependencies.map(dependency => dependency.kind))).toEqual(expect.arrayContaining(['entries', 'connections', 'sources']));
  });
  it('rejects a server human receipt targeting an illustration, matching the source contract', () => {
    const value = load(), dataset = value.datasets[0];
    dataset.commitments.push({ id: 'human-receipt', action: 'adopt', entryId: 'assessment-v1', priorReceiptId: null, actorId: 'person-one', grantId: null, recordedAt: dataset.recording.recordedAt, rationale: 'Synthetic claim', connectionId: null, basis: 'authorized_action', sourceSpans: [] });
    expect(previewMigration(rehash(value)).valid).toBe(true);
    dataset.bundle.contexts[0].kind = 'illustration';
    expect(codes(rehash(value))).toContain('server-illustration-commitment');
    expect(previewMigration(value).status).toBe('invalid');
  });
});

describe('migration preview CLI', () => {
  const script = fileURLToPath(new URL('../../../scripts/migration-preview.mts', import.meta.url));
  const run = (...args: string[]) => spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], { encoding: 'utf8' });
  it('returns 0 for the checked-in synthetic fixture, with an explicit review report', () => {
    const result = run('--synthetic'); expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout); expect(report.status).toBe('requires-review');
    expect(report.sourceArtifactCorrespondence).toBe('not-established');
  });
  it.each(['blocked', 'invalid'] as const)('returns the %s code without changing input bytes', status => {
    const directory = mkdtempSync(join(tmpdir(), 'loomtracer-preview-test-'));
    try {
      const value = load();
      if (status === 'blocked') value.artifacts = [];
      else value.datasets[0].bundle.entries[0].summary = 'Changed without rehashing';
      const file = join(directory, 'fixture.json'), original = JSON.stringify(value, null, 2);
      writeFileSync(file, original);
      const result = run('--input', file);
      expect(result.status).toBe(status === 'blocked' ? 1 : 2);
      expect(JSON.parse(result.stdout).status).toBe(status);
      expect(readFileSync(file, 'utf8')).toBe(original);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('returns 2 for malformed input or incorrect arguments without leaking raw input', () => {
    const directory = mkdtempSync(join(tmpdir(), 'loomtracer-preview-test-'));
    try {
      const file = join(directory, 'malformed.json'); writeFileSync(file, 'RAW_INPUT_SENTINEL {');
      const malformed = run('--input', file); expect(malformed.status).toBe(2);
      expect(malformed.stdout + malformed.stderr).not.toContain('RAW_INPUT_SENTINEL');
      expect(readFileSync(file, 'utf8')).toBe('RAW_INPUT_SENTINEL {');
      expect(run().status).toBe(2); expect(run('--synthetic', '--input', file).status).toBe(2);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
