#!/usr/bin/env node
/** Node 22.18+: read a synthetic fixture and print a report; never writes input or contacts a service. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { previewMigration } from '../packages/reasoning/src/migration-preview.ts';

const args = process.argv.slice(2);
let path: string;
if (args.length === 1 && args[0] === '--synthetic') {
  path = fileURLToPath(new URL('../packages/reasoning/tests/fixtures/migration-preview.json', import.meta.url));
} else if (args.length === 2 && args[0] === '--input' && args[1] && !args[1].startsWith('--')) {
  path = args[1];
} else {
  process.stderr.write('Usage: node scripts/migration-preview.mts --synthetic | --input <synthetic-envelope.json>\n');
  process.exit(2);
}
try {
  const raw = await readFile(path, 'utf8');
  if (Buffer.byteLength(raw) > 5_000_000) throw new Error('Input too large');
  const report = previewMigration(JSON.parse(raw));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === 'invalid' ? 2 : report.status === 'blocked' ? 1 : 0;
} catch {
  process.stderr.write('Preview failed: input must be readable JSON under 5 MB. No migration was performed.\n');
  process.exitCode = 2;
}
