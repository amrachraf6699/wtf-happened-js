import { open, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { parseEnv } from 'node:util';
import { Failure, type Config, type Options } from './types.js';
import { ROOTS, validPattern } from './classifier.js';
export const PROVIDER_KEYS: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  xai: 'XAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  together: 'TOGETHER_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  ollama: 'OLLAMA_API_KEY',
  custom: 'WTF_HAPPENED_AI_API_KEY',
};
export function defaults(): Config {
  return {
    default_days: 7,
    max_commits: 100,
    analysis: { module_roots: [...ROOTS], category_rules: [] },
    ai: {
      enabled: false,
      provider: 'openai',
      api_key: null,
      provider_keys: {},
      model: null,
      base_url: null,
      response_format: 'json_object',
      include_diffs: false,
      max_payload_bytes: 40000,
      max_diff_bytes: 20000,
      timeout_seconds: 20,
    },
  };
}
export function integer(
  value: unknown,
  min: number,
  max: number,
  name: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new Failure(
      `${name} must be an integer between ${min} and ${max}.`,
      2,
    );
  return value;
}
export async function boundedFile(
  root: string,
  name: string,
  max = 65536,
): Promise<string | null> {
  let handle;
  try {
    root = await realpath(root);
    const path = await realpath(join(root, name));
    const rel = relative(root, path);
    if (
      isAbsolute(rel) ||
      rel === '..' ||
      rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))
    )
      throw new Failure(
        'Configuration files must remain inside the selected root.',
        2,
      );
    handle = await open(path, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > max)
      throw new Failure(
        'Configuration input is not a bounded regular file.',
        2,
      );
    const buffer = Buffer.alloc(max + 1);
    const { bytesRead } = await handle.read(buffer, 0, max + 1, 0);
    if (bytesRead > max)
      throw new Failure('Configuration input exceeds its size limit.', 2);
    return new TextDecoder('utf-8', { fatal: true }).decode(
      buffer.subarray(0, bytesRead),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (e instanceof Failure) throw e;
    throw new Failure('Cannot read selected-root configuration data.', 2);
  } finally {
    await handle?.close();
  }
}
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function merge(base: Record<string, unknown>, value: unknown): void {
  if (!object(value))
    throw new Failure('Configuration must contain JSON objects.', 2);
  for (const [k, v] of Object.entries(value)) {
    if (
      ['__proto__', 'constructor', 'prototype'].includes(k) ||
      !Object.hasOwn(base, k)
    )
      throw new Failure('Configuration contains an unknown setting.', 2);
    if (object(base[k])) {
      if (k === 'provider_keys') {
        if (
          !object(v) ||
          Object.keys(v).some((key) => !Object.hasOwn(PROVIDER_KEYS, key))
        )
          throw new Failure('Invalid provider_keys.', 2);
        base[k] = { ...v };
      } else merge(base[k] as Record<string, unknown>, v);
    } else base[k] = v;
  }
}
export async function loadConfig(
  root: string,
  options: Options,
  env: NodeJS.ProcessEnv,
): Promise<Config> {
  const config = defaults();
  const raw = await boundedFile(root, 'wtf-happened.config.json');
  if (raw !== null) {
    try {
      merge(config as unknown as Record<string, unknown>, JSON.parse(raw));
    } catch (e) {
      if (e instanceof Failure) throw e;
      throw new Failure('Malformed wtf-happened.config.json.', 2);
    }
  }
  const dot = await boundedFile(root, '.env');
  const environment = {
    ...(dot === null ? {} : parseEnv(dot)),
    ...Object.fromEntries(
      Object.entries(env).filter(([, v]) => v !== undefined),
    ),
  };
  for (const key of [
    'enabled',
    'provider',
    'api_key',
    'model',
    'base_url',
    'response_format',
    'include_diffs',
  ] as const) {
    const v = environment['WTF_HAPPENED_AI_' + key.toUpperCase()];
    if (v === undefined) continue;
    if (key === 'enabled' || key === 'include_diffs') {
      if (!/^(true|false|1|0)$/i.test(v))
        throw new Failure(
          'AI environment boolean must be true, false, 1 or 0.',
          2,
        );
      config.ai[key] = /^(true|1)$/i.test(v);
    } else config.ai[key] = v;
  }
  for (const [provider, key] of Object.entries(PROVIDER_KEYS)) {
    const v =
      environment[key] ??
      (provider === 'gemini' ? environment.GOOGLE_API_KEY : undefined);
    if (v !== undefined) config.ai.provider_keys[provider] = v;
  }
  integer(config.default_days, 1, 3650, 'default_days');
  integer(config.max_commits, 1, 1000, 'max_commits');
  for (const [k, min, max] of [
    ['max_payload_bytes', 2000, 40000],
    ['max_diff_bytes', 0, 20000],
    ['timeout_seconds', 1, 20],
  ] as const)
    integer(config.ai[k], min, max, `ai.${k}`);
  if (
    typeof config.ai.enabled !== 'boolean' ||
    typeof config.ai.include_diffs !== 'boolean'
  )
    throw new Failure('AI consent settings must be boolean.', 2);
  if (
    !Object.hasOwn(PROVIDER_KEYS, config.ai.provider) ||
    !['json_object', 'json_schema', 'prompt'].includes(
      config.ai.response_format,
    )
  )
    throw new Failure('Invalid AI provider or response_format.', 2);
  for (const v of [
    config.ai.api_key,
    config.ai.model,
    config.ai.base_url,
    ...Object.values(config.ai.provider_keys),
  ])
    if (
      v !== null &&
      (typeof v !== 'string' || v.length > 4096 || /[\x00-\x1f\x7f]/.test(v))
    )
      throw new Failure('Invalid AI string setting.', 2);
  if (
    config.ai.base_url !== null &&
    !['custom', 'ollama'].includes(config.ai.provider)
  )
    throw new Failure('base_url is only supported for custom and ollama.', 2);
  if (
    !Array.isArray(config.analysis.module_roots) ||
    config.analysis.module_roots.length > 100 ||
    !config.analysis.module_roots.every(validPattern)
  )
    throw new Failure('Invalid analysis.module_roots.', 2);
  if (
    !Array.isArray(config.analysis.category_rules) ||
    config.analysis.category_rules.length > 100 ||
    !config.analysis.category_rules.every(
      (r) =>
        object(r) &&
        Object.keys(r).every((k) =>
          ['pattern', 'category', 'review'].includes(k),
        ) &&
        validPattern(r.pattern) &&
        typeof r.category === 'string' &&
        r.category.trim().length > 0 &&
        r.category.length <= 80 &&
        !/[\x00-\x1f]/.test(r.category) &&
        (r.review === undefined || typeof r.review === 'boolean'),
    )
  )
    throw new Failure('Invalid analysis.category_rules.', 2);
  if (options.days !== undefined)
    config.default_days = integer(options.days, 1, 3650, 'days');
  config.ai.enabled = !options.noAi && (options.ai || config.ai.enabled);
  return config;
}
