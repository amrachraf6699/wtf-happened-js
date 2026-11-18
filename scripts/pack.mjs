import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run through npm run pack:verify');
const run = (args, cwd = root) =>
  execFileSync(process.execPath, [npm, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const temp = await mkdtemp(join(tmpdir(), 'wtf-pack-'));
try {
  await chmod(join(root, 'dist/cli.js'), 0o755);
  const dry = JSON.parse(run(['pack', '--dry-run', '--json']))[0];
  for (const file of dry.files)
    assert.match(
      file.path,
      /^(?:dist\/[a-z-]+\.(?:js|d\.ts)|package\.json|README\.md|CHANGELOG\.md|LICENSE)$/,
    );
  for (const needed of [
    'dist/cli.js',
    'dist/index.js',
    'dist/index.d.ts',
    'README.md',
    'CHANGELOG.md',
    'LICENSE',
  ])
    assert.ok(
      dry.files.some((f) => f.path === needed),
      needed,
    );
  const pack = JSON.parse(run(['pack', '--json']))[0];
  assert.equal(pack.integrity, dry.integrity);
  const artifact = join(root, pack.filename);
  const listing = execFileSync('tar', ['-tzf', artifact], { encoding: 'utf8' })
    .trim()
    .split(/\r?\n/)
    .sort();
  assert.deepEqual(listing, dry.files.map((f) => 'package/' + f.path).sort());
  for (const type of ['module', 'commonjs']) {
    const consumer = join(temp, type);
    await (await import('node:fs/promises')).mkdir(consumer);
    await writeFile(
      join(consumer, 'package.json'),
      JSON.stringify({
        name: 'wtf-smoke',
        private: true,
        type,
        scripts: { catchup: 'wtf-happened --no-ai --json' },
      }),
    );
    run(
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', artifact],
      consumer,
    );
    const installed = join(
      consumer,
      'node_modules/@amrachraf6690/wtf-happened',
    );
    const manifest = JSON.parse(
      await readFile(join(installed, 'package.json'), 'utf8'),
    );
    assert.equal(manifest.version, '1.0.1');
    assert.ok(
      !manifest.scripts.preinstall &&
        !manifest.scripts.install &&
        !manifest.scripts.postinstall,
    );
    assert.equal(
      run(
        ['exec', '--offline', '--', 'wtf-happened', '--version'],
        consumer,
      ).trim(),
      '1.0.1',
    );
    const git = (args) =>
      execFileSync('git', args, {
        cwd: consumer,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'user.email', 'fixture@example.test']);
    git(['config', 'commit.gpgsign', 'false']);
    await writeFile(join(consumer, '.gitignore'), 'node_modules/\n');
    git(['add', 'package.json', '.gitignore']);
    git(['commit', '-m', 'Fixture']);
    const report = JSON.parse(run(['run', '--silent', 'catchup'], consumer));
    assert.equal(report.statistics.commits, 1);
    assert.equal(report.ai.status, 'disabled');
    const source =
      "const {analyze}=await import('@amrachraf6690/wtf-happened'); const {report}=await analyze({noAi:true}); if(report.statistics.commits!==1) throw Error('analysis failed');";
    await writeFile(
      join(consumer, 'check.' + (type === 'module' ? 'mjs' : 'cjs')),
      type === 'module'
        ? source
        : `(async()=>{${source}})().catch(()=>process.exit(1));`,
    );
    execFileSync(
      process.execPath,
      ['check.' + (type === 'module' ? 'mjs' : 'cjs')],
      { cwd: consumer },
    );
    if (type === 'module') {
      await writeFile(
        join(consumer, 'types.mts'),
        "import { analyze, type Report } from '@amrachraf6690/wtf-happened'; const r: Report = (await analyze({noAi:true})).report; console.log(r.schema_version);",
      );
      execFileSync(
        process.execPath,
        [
          join(root, 'node_modules/typescript/bin/tsc'),
          '--noEmit',
          '--strict',
          '--skipLibCheck',
          '--types',
          'node',
          '--typeRoots',
          join(root, 'node_modules/@types'),
          '--module',
          'NodeNext',
          '--target',
          'ES2022',
          'types.mts',
        ],
        { cwd: consumer, stdio: 'pipe' },
      );
    }
  }
  console.log(
    `Validated ${pack.filename}: ${pack.integrity}; ESM/CommonJS consumers, bin, API and types passed.`,
  );
} finally {
  await rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
