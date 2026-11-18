import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { analyze } from '../dist/index.js';
import { defaults } from '../dist/config.js';
import { PRESETS, settings, request, responseText } from '../dist/providers.js';
import { validateSummary, schema, buildContext } from '../dist/ai.js';
import { postJson } from '../dist/http.js';
import { GitReader } from '../dist/git.js';
import { emptyReport } from '../dist/types.js';
import { fixture, env, cli } from './helpers.mjs';
const statement = {
  text: 'Source paths changed; worth reviewing.',
  evidence_ids: ['c1'],
};
const summary = {
  summary: statement,
  highlights: [statement],
  potential_risks: [],
  suggested_next_step: statement,
  funny_comment: null,
};
const chat = (value = summary) => ({
  choices: [
    { finish_reason: 'stop', message: { content: JSON.stringify(value) } },
  ],
});
async function server(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}/v1`;
}
for (const name of Object.keys(PRESETS))
  test(`provider ${name}: exact endpoint/auth/body, extraction and local contract`, () => {
    const c = defaults().ai;
    c.provider = name;
    c.model = 'supported-model';
    c.provider_keys[name] = 'selected-key';
    if (name === 'custom') c.base_url = 'http://localhost:1234/v1';
    const s = settings(c);
    const wire = request(s, 'instructions', { evidence: [] }, schema);
    assert.ok(!wire.url.includes('selected-key'));
    assert.equal(wire.body.model ?? c.model, 'supported-model');
    assert.match(JSON.stringify(wire.body), /evidence_ids/);
    let body;
    if (s.protocol === 'responses') {
      assert.equal(wire.body.store, false);
      assert.equal(wire.body.text.format.strict, true);
      body = {
        status: 'completed',
        output: [
          { type: 'reasoning', content: [] },
          {
            type: 'message',
            status: 'completed',
            content: [{ type: 'output_text', text: JSON.stringify(summary) }],
          },
        ],
      };
    } else if (s.protocol === 'anthropic') {
      assert.equal(wire.headers['x-api-key'], 'selected-key');
      assert.equal(wire.headers.Authorization, undefined);
      body = {
        stop_reason: 'end_turn',
        content: [
          { type: 'thinking', thinking: 'private' },
          { type: 'text', text: JSON.stringify(summary) },
        ],
      };
    } else if (s.protocol === 'gemini') {
      assert.equal(wire.headers['x-goog-api-key'], 'selected-key');
      assert.match(wire.url, /generateContent$/);
      body = {
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                { thought: true, text: 'private' },
                { text: JSON.stringify(summary) },
              ],
            },
          },
        ],
      };
    } else {
      assert.equal(wire.body.response_format.type, 'json_object');
      assert.match(wire.url, /chat\/completions$/);
      body = chat();
    }
    const text = responseText(s, body);
    assert.deepEqual(
      validateSummary(JSON.parse(text), new Set(['c1']), false),
      summary,
    );
    assert.throws(() =>
      validateSummary(JSON.parse(text), new Set(['other']), false),
    );
    assert.throws(() => responseText(s, {}));
  });
test('settings deny unsafe URLs, key mixing, missing model; modes do not retry', () => {
  for (const base of [
    'http://remote.test/v1',
    'http://127.1/v1',
    'http://2130706433/v1',
    'http://user:pass@localhost/v1',
    'http://localhost/v1?x=1',
    'http://localhost/v1#x',
    'http:\\localhost',
    'https://example.test/%0a',
  ])
    assert.throws(() =>
      settings({
        ...defaults().ai,
        provider: 'custom',
        base_url: base,
        model: 'm',
      }),
    );
  assert.throws(
    () =>
      settings({
        ...defaults().ai,
        provider: 'anthropic',
        model: 'm',
        provider_keys: { openai: 'wrong' },
      }),
    /requires/,
  );
  assert.throws(() => settings({ ...defaults().ai, api_key: 'key' }), /MODEL/);
  for (const format of ['prompt', 'json_schema']) {
    const s = settings({
      ...defaults().ai,
      provider: 'ollama',
      model: 'm',
      response_format: format,
    });
    const body = request(s, '', {}, schema).body;
    assert.equal(
      body.response_format?.type,
      format === 'prompt' ? undefined : 'json_schema',
    );
  }
});
test('strict statements, types, lengths, evidence and extra fields', () => {
  for (const invalid of [
    { ...summary, extra: true },
    { ...summary, summary: { text: 'x', evidence_ids: [] } },
    { ...summary, summary: { text: 'x'.repeat(601), evidence_ids: ['c1'] } },
    { ...summary, summary: { ...statement, extra: true } },
    { ...summary, funny_comment: statement },
    { ...summary, highlights: Array(6).fill(statement) },
    { ...summary, potential_risks: Array(4).fill(statement) },
  ])
    assert.throws(() => validateSummary(invalid, new Set(['c1']), false));
});
test('refusals, tools, truncation and unsupported provider envelopes rejected', () => {
  for (const body of [
    { choices: [{ finish_reason: 'length', message: { content: '{}' } }] },
    {
      choices: [
        { finish_reason: 'stop', message: { content: '{}', tool_calls: [{}] } },
      ],
    },
    {
      choices: [
        { finish_reason: 'stop', message: { content: '{}', refusal: 'no' } },
      ],
    },
  ])
    assert.throws(() => responseText({ protocol: 'chat' }, body));
  assert.throws(() =>
    responseText(
      { protocol: 'responses' },
      { status: 'completed', output: [{ type: 'function_call' }] },
    ),
  );
  assert.throws(() =>
    responseText(
      { protocol: 'anthropic' },
      { stop_reason: 'end_turn', content: [{ type: 'tool_use' }] },
    ),
  );
  assert.throws(() =>
    responseText(
      { protocol: 'gemini' },
      { promptFeedback: { blockReason: 'SAFETY' } },
    ),
  );
});
test('real HTTP statuses, redirects, streamed byte limits, timeout and cancellation', async (t) => {
  let count = 0;
  const base = await server(t, (req, res) => {
    count++;
    const path = req.url;
    if (path.endsWith('/oversize')) {
      res.writeHead(200);
      res.write('x'.repeat(33000));
      res.end('x'.repeat(33000));
    } else if (path.endsWith('/timeout')) {
    } else if (path.endsWith('/redirect')) {
      res.writeHead(302, { Location: base + '/ok' });
      res.end('private body');
    } else {
      const status = Number(path.split('/').at(-1));
      res.writeHead(status || 200);
      res.end(status ? 'private response body' : JSON.stringify({ ok: true }));
    }
  });
  assert.deepEqual(await postJson(base + '/ok', {}, {}, 2), { ok: true });
  for (const code of [401, 403, 404, 429, 500, 503])
    await assert.rejects(
      postJson(base + '/' + code, {}, {}, 2),
      (e) => e.message.includes(String(code)) && !e.message.includes('private'),
    );
  const before = count;
  await assert.rejects(postJson(base + '/redirect', {}, {}, 2), /redirect/);
  assert.equal(count, before + 1);
  await assert.rejects(postJson(base + '/oversize', {}, {}, 2), /64 KiB/);
  await assert.rejects(postJson(base + '/timeout', {}, {}, 1), /timed out/);
  const abort = new AbortController();
  const pending = postJson(base + '/timeout', {}, {}, 2, abort.signal);
  abort.abort();
  await assert.rejects(pending, /cancelled/);
});
test('consent, single request, sanitized evidence, no excerpts in public JSON, degraded fallback', async (t) => {
  const f = await fixture(t);
  await f.write(
    'src/services/payment.ts',
    "const token='private-token';\nexport const amount=3;\n",
  );
  await f.write('src/config/service.ts', 'private-config');
  await f.write('.env', 'SECRET=private-env');
  f.commit('Change token=private-subject');
  let calls = 0;
  let received;
  const base = await server(t, (req, res) => {
    calls++;
    let body = '';
    req.on('data', (b) => (body += b));
    req.on('end', () => {
      received = JSON.parse(body);
      res.end(JSON.stringify(chat()));
    });
  });
  await f.write(
    'wtf-happened.config.json',
    JSON.stringify({
      ai: {
        provider: 'custom',
        base_url: base,
        model: 'm',
        include_diffs: true,
      },
    }),
  );
  let r = await analyze({ cwd: f.root, funny: true }, { env });
  assert.equal(r.exitCode, 0);
  assert.equal(calls, 0);
  r = await analyze({ cwd: f.root, ai: true, noAi: true }, { env });
  assert.equal(calls, 0);
  const notices = [];
  r = await analyze(
    { cwd: f.root, ai: true },
    { env, notice: (s) => notices.push(s) },
  );
  assert.equal(r.exitCode, 0, r.report.error);
  assert.equal(calls, 1);
  assert.equal(notices.length, 1);
  assert.match(received.messages[1].content, /excerpt/);
  assert.doesNotMatch(
    received.messages[1].content,
    /private-token|private-config|private-env|private-subject|fixture@example/,
  );
  assert.doesNotMatch(
    JSON.stringify(r.report),
    /excerpt|private-token|private-config|private-subject/,
  );
  await f.write(
    'wtf-happened.config.json',
    JSON.stringify({ ai: { enabled: true } }),
  );
  const result = await cli(f.root, ['--json']);
  const failed = JSON.parse(result.stdout);
  assert.equal(result.code, 1);
  assert.equal(failed.status, 'degraded');
  assert.equal(failed.statistics.commits, 1);
});
test('excerpt bounds, binary/large blobs and both rename paths denied', async (t) => {
  const f = await fixture(t);
  await f.write('src/secrets.ts', 'private-source');
  await f.write('src/config/a.ts', 'private-config');
  await f.write('src/binary.ts', Buffer.from([0, 1, 2]));
  await f.write('src/large.ts', 'x'.repeat(262145));
  for (let i = 0; i < 12; i++)
    await f.write(`src/services/file${i}.ts`, '// 😀 line\n'.repeat(300));
  f.commit();
  f.git(['mv', 'src/secrets.ts', 'src/public.ts']);
  f.commit('Rename');
  const git = new GitReader(f.root, env);
  const report = emptyReport();
  const commits = await git.analyze(report, 7, undefined, 100, new Date());
  const config = defaults();
  config.ai.include_diffs = true;
  config.ai.max_diff_bytes = 3000;
  config.ai.max_payload_bytes = 4000;
  const context = await buildContext(commits, report, config, git);
  const json = JSON.stringify(context.payload);
  assert.ok(Buffer.byteLength(json) <= 4000);
  assert.doesNotMatch(json, /private-source|private-config/);
  let bytes = 0,
    count = 0;
  for (const entry of context.payload.evidence)
    for (const file of entry.files)
      if (file.excerpt) {
        bytes += Buffer.byteLength(file.excerpt);
        count++;
        assert.ok(Buffer.byteLength(file.excerpt) <= 2048);
        assert.ok(
          !['src/binary.ts', 'src/large.ts', 'src/public.ts'].includes(
            file.path,
          ),
        );
      }
  assert.ok(bytes <= 3000);
  assert.ok(count <= 10);
  assert.equal(context.omitted, true);
});
