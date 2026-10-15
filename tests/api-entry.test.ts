import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

it('compiled Vercel entry loads with native Node ESM resolution', () => {
  const output = mkdtempSync(join(tmpdir(), 'payindex-api-entry-'));
  writeFileSync(join(output, 'package.json'), '{"type":"module"}');
  const compile = spawnSync(process.execPath, [
    'node_modules/typescript/bin/tsc', 'api/admin.ts',
    '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--skipLibCheck', '--outDir', output,
  ], { encoding: 'utf8' });
  expect(compile.status, compile.stdout + compile.stderr).toBe(0);
  const entry = pathToFileURL(join(output, 'api/admin.js')).href;
  const load = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const { default: api } = await import(${JSON.stringify(entry)}); const result = await api.fetch(new Request('https://example.test/api/admin')); if (result.status !== 405) process.exit(1);`,
  ], { encoding: 'utf8' });
  expect(load.status, load.stdout + load.stderr).toBe(0);
}, 30_000);
