export function clean(text: string): string {
  return text
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
      '[REDACTED KEY]',
    )
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(?:sk-(?:proj-)?[\w-]{12,}|AKIA[A-Z0-9]{16}|AIza[\w-]{20,}|gsk_[\w-]{16,}|xai-[\w-]{16,}|gh[pousr]_[\w]{20,})\b/g,
      '[REDACTED]',
    )
    .replace(
      /([\w.-]*(?:password|passwd|secret|token|api[_-]?key|credential)[\w.-]*["']?\s*(?:=>|[:=])\s*)(?:`[^`]*`|"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
      '$1[REDACTED]',
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED EMAIL]')
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(
      /(?:[A-Za-z]:[\\/]|\/(?:home|Users|tmp|var|etc)\/)[^\s"<>]*/g,
      '[LOCAL PATH]',
    );
}
export function sanitize<T>(value: T): T {
  if (typeof value === 'string') return clean(value) as T;
  if (Array.isArray(value)) return value.map(sanitize) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [clean(k), sanitize(v)]),
    ) as T;
  return value;
}
export function byteslice(value: string, max: number): string {
  let result = '';
  let bytes = 0;
  for (const char of value) {
    bytes += Buffer.byteLength(char);
    if (bytes > max) break;
    result += char;
  }
  return result;
}
export function metadataAllowed(path: string): boolean {
  return !/(?:^|\/)(?:\.env(?:\..*)?|id_rsa|id_ed25519|credentials[^/]*|secrets?[^/]*)(?:\/|$)|\.(?:pem|key|p12|pfx)$/i.test(
    path,
  );
}
export function sourceAllowed(path: string, source: boolean): boolean {
  return (
    source &&
    metadataAllowed(path) &&
    /\.(?:[cm]?[jt]sx?|vue|svelte)$/i.test(path) &&
    !/(?:^|[/_.-])(?:env|config|credentials?|secrets?|keys?|certificates?|node_modules|vendor|generated|dist|build|coverage|cache|\.next|\.nuxt|lock)(?:[/_.-]|$)/i.test(
      path,
    )
  );
}
