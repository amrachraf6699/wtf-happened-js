import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Failure } from './types.js';
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeout: number,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let done = false;
    const data = JSON.stringify(body);
    const req = (url.startsWith('https:') ? httpsRequest : httpRequest)(url, {
      method: 'POST',
      agent: false,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
      },
    });
    const finish = (error?: Failure, value?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(connectionTimer);
      signal?.removeEventListener('abort', abort);
      req.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () =>
        finish(
          new Failure(
            'AI request timed out; use --no-ai or check provider availability.',
          ),
        ),
      Math.min(timeout, 20) * 1000,
    );
    const abort = () => finish(new Failure('AI request cancelled.'));
    signal?.addEventListener('abort', abort, { once: true });
    const connectionTimer = setTimeout(
      () => finish(new Failure('AI connection timed out.')),
      5000,
    );
    req.on('socket', (socket) =>
      socket.once(url.startsWith('https:') ? 'secureConnect' : 'connect', () =>
        clearTimeout(connectionTimer),
      ),
    );
    req.on('error', () =>
      finish(
        new Failure('AI connection failed; check endpoint and network access.'),
      ),
    );
    req.on('response', (res) => {
      let bytes = 0;
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 65536) {
          res.destroy();
          finish(new Failure('AI response exceeded 64 KiB.'));
        } else chunks.push(chunk);
      });
      res.on('error', () => finish(new Failure('AI response interrupted.')));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          finish(
            new Failure(
              status >= 300 && status < 400
                ? 'AI redirect refused.'
                : `AI HTTP ${status}; check credentials, model, rate limits and provider availability.`,
            ),
          );
          return;
        }
        try {
          const value = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
          );
          finish(undefined, value);
        } catch {
          finish(new Failure('AI returned invalid JSON.'));
        }
      });
    });
    if (signal?.aborted) abort();
    else req.end(data);
  });
}
