import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, defaults } from '../dist/config.js';
import { classify } from '../dist/classifier.js';
import { clean, sourceAllowed, byteslice } from '../dist/privacy.js';
import { parseOptions } from '../dist/options.js';
import { render } from '../dist/report.js';
import { emptyReport } from '../dist/types.js';
import { fixture, env, cli } from './helpers.mjs';
test('strict options and help/version precedence', async (t) => {
  const f = await fixture(t);
  for (const args of [
    ['--days=0'],
    ['--days=7', '--since=HEAD'],
    ['--days'],
    ['--unknown'],
    ['--ai=true'],
  ]) {
    const r = await cli(f.root, [...args, '--json']);
    assert.equal(r.code, 2);
    assert.equal(JSON.parse(r.stdout).status, 'error');
    assert.ok(r.stderr);
  }
  assert.equal((await cli(f.root, ['--version', '--json'])).stdout, '1.0.1\n');
  assert.match(
    (await cli(f.root, ['--help', '--version', '--json'])).stdout,
    /Usage:/,
  );
  assert.equal(parseOptions(['--cwd', 'a b']).cwd, 'a b');
});
test('nested merge, list replacement, dotenv data-only and environment precedence', async (t) => {
  const f = await fixture(t);
  await f.write(
    'wtf-happened.config.json',
    JSON.stringify({
      analysis: { module_roots: ['components/*'] },
      ai: { enabled: true, provider_keys: { openai: 'file-key' } },
    }),
  );
  await f.write(
    '.env',
    'WTF_HAPPENED_AI_ENABLED=false\nWTF_HAPPENED_AI_MODEL="$(never-execute)"\nOPENAI_API_KEY=dotenv-key',
  );
  const config = await loadConfig(
    f.root,
    { ai: true, noAi: true },
    { ...env, OPENAI_API_KEY: 'environment-key' },
  );
  assert.deepEqual(config.analysis.module_roots, ['components/*']);
  assert.deepEqual(config.analysis.category_rules, []);
  assert.equal(config.ai.enabled, false);
  assert.equal(config.ai.model, '$(never-execute)');
  assert.equal(config.ai.provider_keys.openai, 'environment-key');
  assert.equal(config.ai.timeout_seconds, 20);
  assert.equal(process.env.WTF_HAPPENED_AI_MODEL, undefined);
});
test('invalid and polluting config sanitized', async (t) => {
  const f = await fixture(t);
  for (const raw of [
    '{',
    '{"__proto__":{"polluted":true}}',
    '{"max_commits":0}',
    '{"ai":{"enabled":"true"}}',
    '{"analysis":{"module_roots":["../outside"]}}',
  ]) {
    await f.write('wtf-happened.config.json', raw);
    const r = await cli(f.root, ['--json']);
    assert.equal(r.code, 2);
    assert.equal(JSON.parse(r.stdout).status, 'error');
    assert.doesNotMatch(r.stdout, /SyntaxError|stack|polluted/);
  }
  assert.equal({}.polluted, undefined);
});
test('framework classification, precedence and custom roots', () => {
  const c = defaults().analysis;
  const cases = {
    'src/users/user.controller.ts': 'Controllers',
    'src/users/user.service.ts': 'Services',
    'src/users/user.guard.ts': 'Guards',
    'src/app/(shop)/checkout/page.tsx': 'Pages and Layouts',
    'app/api/users/route.ts': 'Routes',
    'pages/api/users.ts': 'Routes',
    'src/routes/+page.svelte': 'Pages and Layouts',
    'src/routes/api/+server.ts': 'Routes',
    'src/components/a.vue': 'Components',
    'src/composables/useA.ts': 'Hooks',
    'src/stores/cart.ts': 'State',
    'src/test/user.controller.ts': 'Tests',
    'docs/user.controller.ts': 'Documentation',
    'node_modules/a/controller.ts': 'Other',
    'prisma/schema.prisma': 'Schemas',
    'database/migrations/001.sql': 'Migrations',
    '.github/workflows/ci.yml': 'Infrastructure',
    'package-lock.json': 'Dependencies',
    'unknown.bin': 'Other',
  };
  for (const [path, category] of Object.entries(cases))
    assert.equal(classify(path, c).category, category, path);
  assert.equal(classify('packages/shop/src/a.ts', c).module, 'packages/shop');
  assert.equal(
    classify('packages/@acme/shop/src/a.ts', c).module,
    'packages/@acme/shop',
  );
  const custom = {
    module_roots: ['components/*'],
    category_rules: [
      { pattern: 'components/*/**', category: 'First', review: true },
      { pattern: '**', category: 'Second' },
    ],
  };
  assert.equal(classify('components/shop/a.ts', custom).category, 'First');
  assert.equal(
    classify('components/shop/a.ts', custom).module,
    'components/shop',
  );
});
test('redaction, source denials and UTF-8 byte slicing', () => {
  const input =
    "password='private' Bearer abc.def https://user:pass@example.test user@example.test sk-ant-12345678901234567890 \x1b[31mred\x1b[0m";
  const safe = clean(input);
  assert.doesNotMatch(
    safe,
    /private|abc.def|user:pass|user@example|sk-ant|\x1b/,
  );
  for (const p of [
    'src/config/a.ts',
    'src/a.config.ts',
    'src/secrets.ts',
    'src/node_modules/a.ts',
    'src/dist/a.ts',
    'src/key.ts',
    'src/a.pem',
    'README.md',
  ])
    assert.equal(sourceAllowed(p, true), false, p);
  assert.equal(sourceAllowed('src/services/a.ts', true), true);
  assert.equal(byteslice('😀abc', 5), '😀a');
});
test('terminal safely wraps ASCII headings and funny mode', () => {
  const r = emptyReport();
  r.statistics.commits = 2;
  r.changes.subjects = ['\x1b]8;;https://evil\x07claim\x1b]8;;\x07'];
  const output = render(r, { funny: true, width: 30 });
  assert.doesNotMatch(output, /\x1b/);
  assert.match(output, /2 commits/);
  assert.match(output, /AI: DISABLED/);
});
