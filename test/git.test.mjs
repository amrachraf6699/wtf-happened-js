import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyze } from '../dist/index.js';
import { GitReader, parseChanges } from '../dist/git.js';
import { fixture, env, cli, snapshot } from './helpers.mjs';
test('empty, outside, bare and missing Git return consistent envelopes', async (t) => {
  const f = await fixture(t);
  let r = await analyze({ cwd: f.root, ai: true }, { env });
  assert.equal(r.report.ai.status, 'skipped_empty');
  assert.equal(r.exitCode, 0);
  const outside = await mkdtemp(join(tmpdir(), 'wtf-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  r = await analyze({ cwd: outside }, { env });
  assert.equal(r.exitCode, 1);
  f.git(['init', '--bare', 'bare']);
  r = await analyze({ cwd: join(f.root, 'bare') }, { env });
  assert.match(r.report.error, /Bare/);
  r = await analyze({ cwd: f.root }, { env: { ...env, PATH: '', Path: '' } });
  assert.match(r.report.error, /execute Git/);
});
test('counts, rename, delete, range and read-only snapshot', async (t) => {
  const f = await fixture(t);
  await f.write('src/services/a.ts', 'export const x=1;');
  await f.write('package.json', '{}');
  const first = f.commit();
  f.git(['tag', 'v0']);
  f.git(['mv', 'src/services/a.ts', 'src/services/b.ts']);
  f.commit('Rename');
  await f.write('src/routes/api.ts', 'route');
  f.commit('Route');
  f.git(['rm', 'src/services/b.ts']);
  f.commit('Delete');
  await f.write('src/untracked.ts', 'private');
  const before = await snapshot(f);
  const r = await analyze({ cwd: f.root, noAi: true }, { env });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.report.statistics, {
    commits: 4,
    files: 3,
    contributors: 1,
  });
  assert.equal(
    r.report.changes.files.find((x) => x.path.endsWith('b.ts')).status,
    'D',
  );
  assert.deepEqual(await snapshot(f), before);
  for (const since of [first, 'v0']) {
    const range = await analyze({ cwd: f.root, since }, { env });
    assert.equal(range.report.statistics.commits, 3);
    assert.equal(range.report.range.since, first);
  }
  assert.doesNotMatch(
    JSON.stringify(r.report),
    /fixture@example|untracked|private/,
  );
});
test('subtree default discovery and cross-boundary rename hides siblings', async (t) => {
  const f = await fixture(t);
  await f.write('package.json', '{}');
  await f.write('apps/a/package.json', '{}');
  await f.write('apps/a/src/a.ts', 'same content');
  await f.write('apps/b/package.json', '{}');
  f.commit();
  await mkdir(join(f.root, 'apps/b/src'), { recursive: true });
  f.git(['mv', 'apps/a/src/a.ts', 'apps/b/src/a.ts']);
  f.commit();
  const result = await cli(join(f.root, 'apps/a/src'), ['--json', '--no-ai']);
  const report = JSON.parse(result.stdout);
  assert.equal(report.scope, 'apps/a');
  assert.equal(report.statistics.files, 2);
  assert.doesNotMatch(result.stdout, /apps\/b/);
  assert.equal(
    report.changes.files.find((x) => x.path === 'src/a.ts').status,
    'D',
  );
  const all = await analyze({ cwd: f.root }, { env });
  assert.equal(all.report.scope, '.');
  assert.ok(all.report.statistics.files > 2);
});
test('date anomalies, future exclusion, matching limit', async (t) => {
  const f = await fixture(t);
  const now = Date.now();
  await f.write('src/a.ts', '1');
  f.commit('Recent ancestor', new Date(now - 60000).toISOString());
  await f.write('src/a.ts', '2');
  f.commit('Old child', new Date(now - 10 * 86400000).toISOString());
  await f.write('src/a.ts', '3');
  f.commit('Recent child', new Date(now - 30000).toISOString());
  await f.write('src/a.ts', '4');
  f.commit('Future', new Date(now + 86400000).toISOString());
  let r = await analyze({ cwd: f.root }, { env, now: new Date(now) });
  assert.equal(r.report.statistics.commits, 2);
  await f.write('wtf-happened.config.json', JSON.stringify({ max_commits: 1 }));
  r = await analyze({ cwd: f.root }, { env, now: new Date(now) });
  assert.equal(r.report.statistics.commits, 1);
  assert.equal(r.report.completeness.history, false);
});
test('merge side branches, detached HEAD, invalid references', async (t) => {
  const f = await fixture(t);
  await f.write('base', 'a');
  f.commit();
  f.git(['checkout', '-b', 'feature']);
  await f.write('src/routes/a.ts', 'a');
  const other = f.commit();
  f.git(['checkout', 'main']);
  assert.equal(
    (await analyze({ cwd: f.root, since: other }, { env })).exitCode,
    2,
  );
  await f.write('src/models/b.ts', 'b');
  f.commit();
  f.git(['merge', '--no-ff', 'feature', '-m', 'Merge']);
  f.git(['checkout', '--detach']);
  const r = await analyze({ cwd: f.root }, { env });
  assert.equal(r.report.statistics.commits, 4);
  for (const since of ['--help', 'missing', 'HEAD~1', 'HEAD..HEAD', 'HEAD:src'])
    assert.equal((await analyze({ cwd: f.root, since }, { env })).exitCode, 2);
});
test('shallow boundaries omitted', async (t) => {
  const f = await fixture(t);
  await f.write('a', '1');
  f.commit();
  await f.write('a', '2');
  f.commit();
  f.git(['clone', '--depth=1', pathToFileURL(f.root).href, 'clone']);
  const r = await analyze({ cwd: join(f.root, 'clone') }, { env });
  assert.equal(r.report.statistics.commits, 0);
  assert.equal(r.report.completeness.history, false);
});
test('hostile environment and configured commands cannot run', async (t) => {
  const f = await fixture(t);
  await f.write('src/a.ts', '1');
  f.commit();
  f.git(['config', 'core.fsmonitor', 'nonexistent-hostile-command']);
  f.git(['config', 'diff.external', 'nonexistent-hostile-command']);
  f.git(['config', 'filter.evil.smudge', 'nonexistent-hostile-command']);
  await f.write('.gitattributes', '*.ts filter=evil diff=evil');
  f.commit();
  f.git(['config', 'diff.evil.textconv', 'nonexistent-hostile-command']);
  const r = await analyze(
    { cwd: f.root },
    {
      env: {
        ...env,
        GIT_DIR: 'missing',
        GIT_WORK_TREE: 'missing',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.fsmonitor',
        GIT_CONFIG_VALUE_0: 'bad',
      },
    },
  );
  assert.equal(r.exitCode, 0);
  assert.equal(r.report.statistics.commits, 2);
});
test('NUL paths retain literal special characters and reject invalid UTF-8', () => {
  const names = ['a\nb.ts', '-a.ts', 'a\tb.ts', 'a[b].ts', 'a\\b.ts'];
  for (const name of names)
    assert.equal(
      parseChanges(Buffer.from('A\0' + name + '\0'), '.')[0].path,
      name,
    );
  assert.throws(
    () => parseChanges(Buffer.from([65, 0, 255, 0]), '.'),
    /non-UTF-8/,
  );
});
test('actual output bound and cancellation kill Git', async (t) => {
  const f = await fixture(t);
  await f.write('large', 'x'.repeat(2200000));
  f.commit();
  const hash = f.git(['rev-parse', 'HEAD:large']);
  const reader = new GitReader(f.root, env);
  await assert.rejects(reader.run(['cat-file', 'blob', hash]), /budget/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new GitReader(f.root, env, controller.signal).run(['status']),
    /cancelled/,
  );
});
