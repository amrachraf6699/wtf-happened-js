import { Failure, type Config } from './types.js';
export const PRESETS: Record<string, [string, string]> = {
  openai: ['responses', 'https://api.openai.com/v1'],
  anthropic: ['anthropic', 'https://api.anthropic.com/v1'],
  gemini: ['gemini', 'https://generativelanguage.googleapis.com/v1beta'],
  deepseek: ['chat', 'https://api.deepseek.com/v1'],
  groq: ['chat', 'https://api.groq.com/openai/v1'],
  mistral: ['chat', 'https://api.mistral.ai/v1'],
  xai: ['chat', 'https://api.x.ai/v1'],
  openrouter: ['chat', 'https://openrouter.ai/api/v1'],
  together: ['chat', 'https://api.together.ai/v1'],
  fireworks: ['chat', 'https://api.fireworks.ai/inference/v1'],
  cerebras: ['chat', 'https://api.cerebras.ai/v1'],
  ollama: ['chat', 'http://localhost:11434/v1'],
  custom: ['chat', ''],
};
export function settings(config: Config['ai']) {
  const preset = PRESETS[config.provider];
  if (!preset) throw new Failure('Unknown AI provider.', 2);
  const base = config.base_url ?? preset[1];
  if (config.base_url && !['custom', 'ollama'].includes(config.provider))
    throw new Failure('Only custom and ollama allow base_url.', 2);
  let url: URL;
  try {
    if (!/^https?:\/\//.test(base) || /[\s\\%]/.test(base)) throw 0;
    url = new URL(base);
  } catch {
    throw new Failure('Invalid AI base URL.', 2);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  // Check the original host too: WHATWG normalizes decimal/abbreviated IPv4.
  const host = base.slice(base.indexOf('://') + 3).split('/')[0]!;
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    base.includes('?') ||
    base.includes('#') ||
    (!loopback && url.protocol !== 'https:') ||
    (loopback && !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))
  )
    throw new Failure(
      'AI URL requires HTTPS except exact loopback, without credentials, query or fragment.',
      2,
    );
  const key = config.api_key ?? config.provider_keys[config.provider] ?? '';
  const model = config.model;
  if (!model?.trim())
    throw new Failure(
      'AI requires WTF_HAPPENED_AI_MODEL; select an available model or use --no-ai.',
    );
  if (
    !key.trim() &&
    !(loopback && ['custom', 'ollama'].includes(config.provider))
  )
    throw new Failure(
      'AI requires the selected provider key or WTF_HAPPENED_AI_API_KEY; use --no-ai for offline analysis.',
    );
  return {
    name: config.provider,
    protocol: preset[0],
    base: base.replace(/\/+$/, ''),
    key,
    model,
    format: config.response_format,
  };
}
export type Settings = ReturnType<typeof settings>;
export function request(
  s: Settings,
  instructions: string,
  input: unknown,
  schema: unknown,
) {
  instructions +=
    ' Return only JSON matching this schema: ' + JSON.stringify(schema);
  const json = JSON.stringify(input);
  let headers: Record<string, string> = s.key
    ? { Authorization: 'Bearer ' + s.key }
    : {};
  let path: string;
  let body: Record<string, unknown>;
  if (s.protocol === 'responses') {
    path = '/responses';
    body = {
      model: s.model,
      store: false,
      max_output_tokens: 1800,
      instructions,
      input: json,
      text: {
        format: {
          type: 'json_schema',
          name: 'git_catch_up',
          strict: true,
          schema,
        },
      },
    };
  } else if (s.protocol === 'anthropic') {
    path = '/messages';
    headers = { 'x-api-key': s.key, 'anthropic-version': '2026-10-21' };
    body = {
      model: s.model,
      max_tokens: 1800,
      system: instructions,
      messages: [{ role: 'user', content: json }],
    };
  } else if (s.protocol === 'gemini') {
    path =
      '/models/' +
      encodeURIComponent(s.model.replace(/^models\//, '')) +
      ':generateContent';
    headers = { 'x-goog-api-key': s.key };
    body = {
      systemInstruction: { parts: [{ text: instructions }] },
      contents: [{ role: 'user', parts: [{ text: json }] }],
      generationConfig: {
        maxOutputTokens: 1800,
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
      },
    };
  } else {
    path = '/chat/completions';
    body = {
      model: s.model,
      max_tokens: 1800,
      stream: false,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: json },
      ],
    };
    if (s.format !== 'prompt')
      body.response_format =
        s.format === 'json_schema'
          ? {
              type: 'json_schema',
              json_schema: { name: 'git_catch_up', strict: true, schema },
            }
          : { type: 'json_object' };
  }
  return { url: s.base + path, headers, body };
}
export function responseText(s: Settings, body: any): string {
  const fail = (): never => {
    throw new Failure(
      'AI returned an incomplete, blocked or unsupported response.',
    );
  };
  let text = '';
  if (!body || typeof body !== 'object' || body.error) return fail();
  if (s.protocol === 'responses') {
    if (
      body.status !== 'completed' ||
      body.incomplete_details ||
      !Array.isArray(body.output)
    )
      return fail();
    for (const item of body.output) {
      if (item.type === 'reasoning') continue;
      if (
        item.type !== 'message' ||
        item.status !== 'completed' ||
        !Array.isArray(item.content)
      )
        return fail();
      for (const part of item.content) {
        if (part.type !== 'output_text' || typeof part.text !== 'string')
          return fail();
        text += part.text;
      }
    }
  } else if (s.protocol === 'anthropic') {
    if (body.stop_reason !== 'end_turn' || !Array.isArray(body.content))
      return fail();
    for (const part of body.content) {
      if (['thinking', 'redacted_thinking'].includes(part.type)) continue;
      if (part.type !== 'text' || typeof part.text !== 'string') return fail();
      text += part.text;
    }
  } else if (s.protocol === 'gemini') {
    if (
      body.promptFeedback?.blockReason ||
      body.candidates?.length !== 1 ||
      body.candidates[0].finishReason !== 'STOP'
    )
      return fail();
    for (const part of body.candidates[0].content?.parts ?? []) {
      if (part.thought) continue;
      if (typeof part.text !== 'string' || part.functionCall) return fail();
      text += part.text;
    }
  } else {
    if (body.choices?.length !== 1) return fail();
    const choice = body.choices[0];
    if (
      choice.finish_reason !== 'stop' ||
      choice.message?.refusal ||
      choice.message?.tool_calls?.length ||
      choice.message?.function_call ||
      typeof choice.message?.content !== 'string'
    )
      return fail();
    text = choice.message.content;
  }
  if (!text.trim()) return fail();
  return text;
}
