// Single bootstrap publishing path. Run only after npm browser login and tagging.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run npm run release:publish');
const run = (binary, args) =>
  execFileSync(binary, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(manifest.name, '@amrachraf6690/wtf-happened');
assert.equal(manifest.version, '1.0.1');
assert.equal(
  run('git', ['status', '--porcelain']),
  '',
  'Working tree must be clean.',
);
const sha = run('git', ['rev-parse', 'HEAD']);
assert.equal(
  run('git', ['cat-file', '-t', 'v1.0.1']),
  'tag',
  'An annotated tag is required.',
);
assert.equal(run('git', ['rev-parse', 'v1.0.1^{commit}']), sha);
const headers = {
  'User-Agent': 'wtf-happened-release',
  Accept: 'application/vnd.github+json',
};
const api = async (path) => {
  const response = await fetch(
    'https://api.github.com/repos/amrachraf6699/wtf-happened-js/' + path,
    { headers, signal: AbortSignal.timeout(20000) },
  );
  assert.ok(response.ok, `GitHub check HTTP ${response.status}`);
  return response.json();
};
const runs = await api(
  `actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100`,
);
const passed = runs.workflow_runs.find(
  (r) =>
    r.head_sha === sha &&
    r.event === 'push' &&
    r.status === 'completed' &&
    r.conclusion === 'success',
);
assert.ok(passed, 'Compatibility must pass at the exact release SHA.');
const jobs = await api(`actions/runs/${passed.id}/jobs?per_page=100`);
assert.equal(jobs.jobs.length, 6);
assert.ok(jobs.jobs.every((j) => j.conclusion === 'success'));
const release = await api('releases/tags/v1.0.1');
assert.equal(release.draft, false);
assert.equal(
  run(process.execPath, [
    npm,
    'whoami',
    '--registry=https://registry.npmjs.org',
  ]),
  'amrachraf6690',
);
const registry = await fetch(
  'https://registry.npmjs.org/@amrachraf6690%2fwtf-happened/1.0.1',
  { signal: AbortSignal.timeout(20000) },
);
assert.equal(
  registry.status,
  404,
  'Requested version already exists or registry state is unavailable; inspect before publishing.',
);
const pack = JSON.parse(
  run(process.execPath, [npm, 'pack', '--dry-run', '--json']),
)[0];
const artifact = await readFile(pack.filename);
assert.equal(
  'sha512-' + createHash('sha512').update(artifact).digest('base64'),
  pack.integrity,
  'Tarball must match this exact clean release tree. Run pack:verify first.',
);
const published = spawnSync(
  process.execPath,
  [
    npm,
    'publish',
    pack.filename,
    '--access',
    'public',
    '--tag',
    'latest',
    '--registry=https://registry.npmjs.org',
  ],
  { stdio: 'inherit', shell: false },
);
process.exitCode = published.status ?? 1;
