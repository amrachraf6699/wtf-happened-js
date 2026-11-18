import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { gitEnvironment } from '../dist/git.js';
export const env = Object.fromEntries(
  Object.entries(gitEnvironment(process.env)).filter(
    ([k]) => !k.includes('API_KEY') && !k.startsWith('WTF_HAPPENED_'),
  ),
);
export async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'wtf-test-'));
  t.after(() =>
    rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
  );
  const git = (args, extra = {}) =>
    execFileSync('git', args, {
      cwd: root,
      env: { ...env, ...extra },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'core.autocrlf', 'false']);
  const write = async (path, value) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), value);
  };
  const commit = (subject = 'Fixture change', date) => {
    git(['add', '--all']);
    git(
      ['commit', '-m', subject],
      date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {},
    );
    return git(['rev-parse', 'HEAD']);
  };
  return { root, git, write, commit };
}
export async function cli(root, args = [], extra = {}) {
  return new Promise((resolveResult, reject) => {
    const p = spawn(process.execPath, [resolve('dist/cli.js'), ...args], {
      cwd: root,
      env: { ...env, ...extra },
      windowsHide: true,
    });
    let stdout = '',
      stderr = '';
    p.stdout.on('data', (b) => (stdout += b));
    p.stderr.on('data', (b) => (stderr += b));
    p.on('error', reject);
    p.on('close', (code) => resolveResult({ code, stdout, stderr }));
  });
}
export async function snapshot(f) {
  return {
    status: f.git(['status', '--porcelain=v1', '--untracked-files=all']),
    refs: f.git(['show-ref']),
    index: (await readFile(join(f.root, '.git/index'))).toString('base64'),
  };
}
