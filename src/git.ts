import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { dirname, relative, resolve, isAbsolute, sep } from 'node:path';
import { Failure, type Change, type Commit, type Report } from './types.js';
export function gitEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const safe = Object.fromEntries(
    Object.entries(env).filter(([k]) => !/^GIT_/i.test(k)),
  );
  return {
    ...safe,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_LITERAL_PATHSPECS: '1',
    GIT_ATTR_NOSYSTEM: '1',
    LC_ALL: 'C',
  };
}
export class GitReader {
  private started = Date.now();
  private bytes = 0;
  constructor(
    public root: string,
    private env: NodeJS.ProcessEnv = process.env,
    private signal?: AbortSignal,
  ) {}
  async run(
    args: string[],
    allowFailure = false,
  ): Promise<{ code: number; data: Buffer }> {
    const remaining = 30000 - (Date.now() - this.started);
    if (remaining <= 0 || this.bytes >= 10485760)
      throw new Failure('Git analysis budget reached.', 1, true);
    return new Promise((resolveResult, reject) => {
      const child = spawn(
        'git',
        [
          '--no-pager',
          '-c',
          'core.fsmonitor=false',
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'core.quotePath=false',
          '-c',
          'core.attributesFile=/dev/null',
          '-c',
          'credential.helper=',
          '-c',
          'protocol.allow=never',
          '-c',
          'diff.external=',
          '-c',
          'log.showSignature=false',
          ...args,
        ],
        {
          cwd: this.root,
          env: gitEnvironment(this.env),
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let received = 0;
      const chunks: Buffer[] = [];
      let failure: Failure | undefined;
      const stop = (error: Failure) => {
        failure ??= error;
        child.kill('SIGKILL');
      };
      const timer = setTimeout(
        () => stop(new Failure('Git time budget reached.', 1, true)),
        Math.min(10000, remaining),
      );
      const abort = () => stop(new Failure('Analysis cancelled.'));
      this.signal?.addEventListener('abort', abort, { once: true });
      if (this.signal?.aborted) abort();
      const receive = (data: Buffer, out: boolean) => {
        received += data.length;
        this.bytes += data.length;
        if (received > 2097152 || this.bytes > 10485760)
          stop(new Failure('Git output budget reached.', 1, true));
        else if (out && !failure) chunks.push(data);
      };
      child.stdout.on('data', (b: Buffer) => receive(b, true));
      child.stderr.on('data', (b: Buffer) => receive(b, false));
      child.on('error', () => {
        failure = new Failure(
          'Could not execute Git. Install Git and make it available on PATH.',
        );
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        this.signal?.removeEventListener('abort', abort);
        if (failure) reject(failure);
        else if (code !== 0 && !allowFailure)
          reject(
            new Failure(
              'Git could not read local history. Check missing objects or repository corruption; no fetch was attempted.',
            ),
          );
        else resolveResult({ code: code ?? 1, data: Buffer.concat(chunks) });
      });
    });
  }
  async text(args: string[], allowFailure = false) {
    const r = await this.run(args, allowFailure);
    return { code: r.code, text: decode(r.data) };
  }
  async discover(explicit: boolean): Promise<{ root: string; scope: string }> {
    const version = /git version (\d+)\.(\d+)/.exec(
      (await this.text(['--version'])).text,
    );
    if (
      !version ||
      Number(version[1]) < 2 ||
      (Number(version[1]) === 2 && Number(version[2]) < 46)
    )
      throw new Failure(
        'Git 2.46 or newer is required for bounded offline analysis.',
      );
    if (
      (
        await this.text(['rev-parse', '--is-bare-repository'], true)
      ).text.trim() === 'true'
    )
      throw new Failure(
        'Bare repositories are unsupported; use a working tree.',
      );
    const top = await this.text(['rev-parse', '--show-toplevel'], true);
    if (top.code !== 0)
      throw new Failure('No Git working tree found at the selected directory.');
    const repo = await realpath(top.text.replace(/\r?\n$/, ''));
    let selected = this.root;
    if (!explicit) {
      let cursor = selected;
      while (true) {
        try {
          if ((await stat(resolve(cursor, 'package.json'))).isFile()) {
            selected = cursor;
            break;
          }
        } catch {
          /* Missing manifests do not change scope. */
        }
        if (cursor === repo) break;
        const parent = dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
      }
    }
    const rel = relative(repo, selected);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep))
      throw new Failure('Selected root is outside the Git working tree.');
    this.root = repo;
    return { root: selected, scope: rel.split(sep).join('/') || '.' };
  }
  async analyze(
    report: Report,
    days: number,
    since: string | undefined,
    limit: number,
    now: Date,
  ): Promise<Commit[]> {
    const headResult = await this.text(
      ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
      true,
    );
    const head = headResult.code === 0 ? headResult.text.trim() : null;
    report.range = {
      head,
      since: null,
      days: since ? null : days,
      cutoff: since
        ? null
        : new Date(now.getTime() - days * 86400000).toISOString(),
      until: now.toISOString(),
    };
    if (since !== undefined) {
      if (
        !since ||
        since.startsWith('-') ||
        /[\x00-\x20~^:@{}\\?*\[]|\.\./.test(since)
      )
        throw new Failure(
          '--since must be one local commit hash or named reference.',
          2,
        );
      const ref = await this.text(
        [
          'rev-parse',
          '--verify',
          '--quiet',
          '--end-of-options',
          since + '^{commit}',
        ],
        true,
      );
      if (ref.code !== 0)
        throw new Failure('--since could not be resolved locally.', 2);
      report.range.since = ref.text.trim();
      if (
        !head ||
        (
          await this.run(
            ['merge-base', '--is-ancestor', ref.text.trim(), head],
            true,
          )
        ).code !== 0
      )
        throw new Failure('--since must be an ancestor of frozen HEAD.', 2);
    }
    if (!head) {
      const sym = await this.text(['symbolic-ref', '--quiet', 'HEAD'], true);
      if (
        sym.code !== 0 ||
        (
          await this.run(
            ['show-ref', '--verify', '--quiet', sym.text.trim()],
            true,
          )
        ).code !== 1
      )
        throw new Failure(
          'Cannot resolve HEAD; check missing or corrupt objects.',
        );
      return [];
    }
    const shallow =
      (
        await this.text(['rev-parse', '--is-shallow-repository'])
      ).text.trim() === 'true';
    if (shallow) {
      report.completeness.history = false;
      report.warnings.push('Shallow history: boundary changes are omitted.');
    }
    const commits: Commit[] = [];
    try {
      const args = [
        'rev-list',
        '--date-order',
        '--parents',
        '--max-count=10001',
        `--before=@${Math.floor(now.getTime() / 1000)}`,
      ];
      if (!since)
        args.push(
          `--since-as-filter=@${Math.floor(now.getTime() / 1000) - days * 86400}`,
        );
      args.push(since ? `${report.range.since}..${head}` : head, '--');
      const lines = (await this.text(args)).text
        .trim()
        .split('\n')
        .filter(Boolean);
      if (lines.length > 10000) {
        report.completeness.history = false;
        report.warnings.push(
          'Traversal limit reached; only analyzed counts are shown.',
        );
      }
      for (const line of lines.slice(0, 10000)) {
        const [hash, ...parents] = line.trim().split(' ');
        if (!hash) continue;
        const parent = parents[0] ?? null;
        if (shallow && !parent) {
          const raw = (await this.text(['cat-file', 'commit', hash])).text;
          if (/^parent /m.test(raw)) continue;
        }
        const diff = await this.run([
          'diff-tree',
          '--no-commit-id',
          '--no-ext-diff',
          '--no-textconv',
          '--ignore-submodules=none',
          '-r',
          '-z',
          '--name-status',
          '-M',
          '-l1000',
          ...(parent ? [parent, hash] : ['--root', hash]),
          '--',
        ]);
        const changes = parseChanges(diff.data, report.scope);
        if (!changes.length) continue;
        if (commits.length === limit) {
          report.completeness.history = false;
          report.warnings.push(
            'Commit limit reached; statistics describe only analyzed commits.',
          );
          break;
        }
        const fields = (
          await this.text([
            'show',
            '--no-patch',
            '--no-show-signature',
            '--no-use-mailmap',
            '--format=%ct%x00%ae%x00%an%x00%s',
            hash,
            '--',
          ])
        ).text.split('\0');
        commits.push({
          hash,
          parent,
          timestamp: Number(fields[0]),
          author: (fields[1]?.trim() || fields[2]?.trim() || '').toLowerCase(),
          subject: (fields[3] ?? '').trim(),
          changes,
        });
      }
    } catch (e) {
      if (!(e instanceof Failure) || !e.budget) throw e;
      report.completeness.history = false;
      report.warnings.push(
        'Git budget reached; only fully collected commits are counted.',
      );
    }
    return commits;
  }
  async excerpt(commit: Commit, change: Change): Promise<string | null> {
    if (change.cross) return null;
    for (const [revision, path] of [
      [commit.parent, change.old],
      [commit.hash, change.new],
    ]) {
      if (!revision || !path) continue;
      const entry = (await this.text(['ls-tree', '-z', revision, '--', path]))
        .text;
      if (!entry) continue;
      const m = /^100(?:644|755) blob ([a-f0-9]+)\t/.exec(entry);
      if (!m) return null;
      const size = Number((await this.text(['cat-file', '-s', m[1]!])).text);
      if (size > 262144) return null;
      const blob = (await this.run(['cat-file', 'blob', m[1]!])).data;
      if (blob.includes(0)) return null;
      try {
        decode(blob);
      } catch {
        return null;
      }
    }
    return (
      await this.text([
        'diff-tree',
        '--no-commit-id',
        '--no-ext-diff',
        '--no-textconv',
        '-r',
        '-p',
        '--unified=1',
        '--no-color',
        ...(commit.parent
          ? [commit.parent, commit.hash]
          : ['--root', commit.hash]),
        '--',
        change.old,
        change.new,
      ])
    ).text;
  }
}
export function decode(data: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    throw new Failure(
      'Git contains non-UTF-8 evidence; analysis stopped without selecting replacement paths.',
    );
  }
}
export function parseChanges(data: Buffer, scope: string): Change[] {
  const tokens = decode(data).split('\0');
  const prefix = scope === '.' ? '' : scope + '/';
  const changes: Change[] = [];
  for (let i = 0; i < tokens.length - 1;) {
    const status = tokens[i++]?.[0];
    const old = tokens[i++];
    const next = status === 'R' || status === 'C' ? tokens[i++] : old;
    if (!status || old === undefined || next === undefined)
      throw new Failure('Malformed Git change data.');
    const a = old.startsWith(prefix),
      b = next.startsWith(prefix);
    if (!a && !b) continue;
    changes.push({
      status: !a ? 'A' : !b ? 'D' : status,
      path: (b ? next : old).slice(prefix.length),
      old_path: status === 'R' && a && b ? old.slice(prefix.length) : null,
      old,
      new: next,
      cross: a !== b,
    });
  }
  return changes;
}
