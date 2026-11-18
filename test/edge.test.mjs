import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, symlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { analyze } from '../dist/index.js';
import { GitReader } from '../dist/git.js';
import { emptyReport, Failure } from '../dist/types.js';
import { defaults } from '../dist/config.js';
import { buildContext } from '../dist/ai.js';
import { fixture, env, cli } from './helpers.mjs';
test('committed workspace hints ignore working-tree manifests and explicit roots replace them', async (t) => {
  const f = await fixture(t);
  await f.write(
    'package.json',
    JSON.stringify({ workspaces: ['libraries/*'] }),
  );
  await f.write('libraries/cart/src/service.ts', 'x');
  f.commit();
  await f.write('package.json', JSON.stringify({ workspaces: ['private/*'] }));
  let r = await analyze({ cwd: f.root }, { env });
  assert.equal(
    r.report.changes.files.find((f) => f.path.includes('service')).module,
    'libraries/cart',
  );
  await f.write(
    'wtf-happened.config.json',
    JSON.stringify({ analysis: { module_roots: ['explicit/*'] } }),
  );
  r = await analyze({ cwd: f.root }, { env });
  assert.equal(
    r.report.changes.files.find((f) => f.path.includes('service')).module,
    null,
  );
});
test('pnpm and Nx static hints, unsupported YAML is disclosed', async (t) => {
  const f = await fixture(t);
  await f.write(
    'pnpm-workspace.yaml',
    "packages:\n  - 'libraries/*'\n  - {unsupported: true}\n",
  );
  await f.write(
    'nx.json',
    JSON.stringify({ workspaceLayout: { libsDir: 'libs' } }),
  );
  await f.write('libraries/a/src/a.ts', 'a');
  await f.write('libs/b/src/b.ts', 'b');
  f.commit();
  const r = await analyze({ cwd: f.root }, { env });
  assert.equal(r.report.changes.modules['libraries/a'], 1);
  assert.equal(r.report.changes.modules['libs/b'], 1);
  assert.match(r.report.warnings.join(' '), /Unsupported workspace/);
});
test('broken symbolic HEAD is an error, not an empty repository', async (t) => {
  const f = await fixture(t);
  await f.write('a', 'a');
  f.commit();
  await writeFile(join(f.root, '.git/refs/heads/main'), 'a'.repeat(40) + '\n');
  const r = await analyze({ cwd: f.root }, { env });
  assert.equal(r.exitCode, 1);
  assert.match(r.report.error, /HEAD/);
});
test('linked worktrees remain scoped and detached history works', async (t) => {
  const f = await fixture(t);
  await f.write('package.json', '{}');
  f.commit();
  const tree = join(f.root, 'linked');
  f.git(['worktree', 'add', '--detach', tree, 'HEAD']);
  const r = await analyze({ cwd: tree }, { env });
  assert.equal(r.exitCode, 0);
  assert.equal(r.report.statistics.commits, 1);
  assert.equal(r.report.scope, '.');
});
test('budget retains only fully collected commits and handles overall byte/time bounds', async (t) => {
  const f = await fixture(t);
  await f.write('a', '1');
  f.commit();
  await f.write('a', '2');
  f.commit();
  const git = new GitReader(f.root, env);
  const run = git.run.bind(git);
  let meta = 0;
  git.run = async (args, ...rest) => {
    if (args[0] === 'show' && ++meta === 2)
      throw new Failure('budget', 1, true);
    return run(args, ...rest);
  };
  const report = emptyReport();
  const commits = await git.analyze(report, 7, undefined, 100, new Date());
  assert.equal(commits.length, 1);
  assert.equal(report.completeness.history, false);
  const timed = new GitReader(f.root, env);
  timed.started = Date.now() - 31000;
  await assert.rejects(timed.run(['status']), /budget/);
  const bytes = new GitReader(f.root, env);
  bytes.bytes = 10485760;
  await assert.rejects(bytes.run(['status']), /budget/);
});
test('missing Git and config failures are exactly one JSON document', async (t) => {
  const f = await fixture(t);
  const missing = await cli(f.root, ['--json'], { PATH: '', Path: '' });
  assert.equal(missing.code, 1);
  assert.equal(JSON.parse(missing.stdout).status, 'error');
  await f.write('.env', 'WTF_HAPPENED_AI_ENABLED=invalid');
  const invalid = await cli(f.root, ['--json']);
  assert.equal(invalid.code, 2);
  assert.equal(JSON.parse(invalid.stdout).status, 'error');
  await f.write('.env', 'x'.repeat(65537));
  const big = await cli(f.root, ['--json']);
  assert.equal(big.code, 2);
  assert.equal(JSON.parse(big.stdout).statistics.commits, 0);
});
test(
  'literal Unix filenames and symlink source denial',
  {
    skip:
      process.platform === 'win32'
        ? 'Windows cannot create these POSIX filenames/symlinks without extra privileges'
        : false,
  },
  async (t) => {
    const f = await fixture(t);
    for (const name of [
      'src/a\nb.ts',
      'src/a\tb.ts',
      'src/-a.ts',
      'src/a[b].ts',
      'src/a\\b.ts',
    ])
      await f.write(name, 'const safe=1;');
    await symlink('/etc/passwd', join(f.root, 'src/link.ts'));
    f.commit();
    const git = new GitReader(f.root, env);
    const report = emptyReport();
    const commits = await git.analyze(report, 7, undefined, 100, new Date());
    assert.equal(commits[0].changes.length, 6);
    const config = defaults();
    config.ai.include_diffs = true;
    const context = await buildContext(commits, report, config, git);
    assert.equal(
      context.payload.evidence[0].files.find((x) => x.path === 'src/link.ts')
        .excerpt,
      undefined,
    );
  },
);
test(
  'invalid UTF-8 filename cannot select a different blob',
  {
    skip:
      process.platform === 'win32' ? 'Windows filenames use Unicode' : false,
  },
  async (t) => {
    const f = await fixture(t);
    await mkdir(join(f.root, 'src'));
    const path = Buffer.concat([
      Buffer.from(join(f.root, 'src') + '/'),
      Buffer.from([255]),
      Buffer.from('.ts'),
    ]);
    await writeFile(path, 'private');
    f.commit();
    const r = await analyze({ cwd: f.root }, { env });
    assert.equal(r.exitCode, 1);
    assert.match(r.report.error, /non-UTF-8/);
  },
);
test('source submodule modes never produce excerpts', async (t) => {
  const f = await fixture(t);
  await f.write('a', 'x');
  const hash = f.commit();
  f.git([
    'update-index',
    '--add',
    '--cacheinfo',
    `160000,${hash},src/submodule.ts`,
  ]);
  f.git(['commit', '-m', 'Gitlink']);
  const git = new GitReader(f.root, env);
  const report = emptyReport();
  const commits = await git.analyze(report, 7, undefined, 100, new Date());
  const config = defaults();
  config.ai.include_diffs = true;
  const context = await buildContext(commits, report, config, git);
  assert.equal(context.payload.evidence[0].files[0].excerpt, undefined);
});
test('analysis never modifies source contents', async (t) => {
  const f = await fixture(t);
  await f.write('src/a.ts', 'committed');
  f.commit();
  await f.write('src/a.ts', 'working-tree-private');
  const before = await readFile(join(f.root, 'src/a.ts'));
  const r = await analyze({ cwd: f.root, noAi: true }, { env });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(await readFile(join(f.root, 'src/a.ts')), before);
  assert.doesNotMatch(JSON.stringify(r.report), /working-tree-private/);
});
