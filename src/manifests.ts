import { glob, ROOTS, validPattern } from './classifier.js';
import type { GitReader } from './git.js';
import type { Config, Report } from './types.js';
/** Only small regular frozen-HEAD blobs. Unsupported YAML stays explicit configuration. */
export async function manifestHints(
  git: GitReader,
  report: Report,
  config: Config,
): Promise<void> {
  if (
    !report.range?.head ||
    JSON.stringify(config.analysis.module_roots) !== JSON.stringify(ROOTS)
  )
    return;
  const head = report.range.head;
  const prefix = report.scope === '.' ? '' : report.scope + '/';
  const roots: string[] = [];
  for (const name of ['package.json', 'pnpm-workspace.yaml', 'nx.json']) {
    try {
      const entry = (
        await git.text(['ls-tree', '-z', head, '--', prefix + name])
      ).text;
      const match = /^100(?:644|755) blob ([a-f0-9]+)\t/.exec(entry);
      if (!match) continue;
      const size = Number((await git.text(['cat-file', '-s', match[1]!])).text);
      if (size > 65536) {
        report.warnings.push(
          'Oversized committed manifest skipped; configure explicit module roots.',
        );
        continue;
      }
      const text = (await git.text(['cat-file', 'blob', match[1]!])).text;
      if (name === 'pnpm-workspace.yaml') {
        const section = /^packages:\s*\r?\n((?:[ \t]+[^\n]*\n?)*)/m.exec(
          text,
        )?.[1];
        if (section)
          for (const line of section.split('\n')) {
            const m = /^\s+-\s+['"]?([\w@./*?-]+)['"]?\s*(?:#.*)?$/.exec(line);
            if (m?.[1]) roots.push(m[1]);
            else if (line.trim() && !line.trim().startsWith('#'))
              report.warnings.push(
                'Unsupported workspace YAML entry skipped; use explicit module roots.',
              );
          }
      } else {
        const data = JSON.parse(text);
        if (name === 'package.json') {
          const values = Array.isArray(data.workspaces)
            ? data.workspaces
            : data.workspaces?.packages;
          if (Array.isArray(values))
            roots.push(...values.filter((v: unknown) => typeof v === 'string'));
        } else
          for (const key of ['appsDir', 'libsDir']) {
            const dir = data.workspaceLayout?.[key];
            if (typeof dir === 'string') roots.push(dir + '/*');
          }
      }
    } catch {
      report.warnings.push(
        'Committed manifest hints unavailable; path rules remain active.',
      );
    }
  }
  for (const root of roots.slice(0, 100))
    if (
      validPattern(root) &&
      !root.startsWith('!') &&
      !config.analysis.module_roots.includes(root)
    ) {
      try {
        new RegExp(glob(root));
        config.analysis.module_roots.push(root);
      } catch {
        /* Explicit configuration is required for unsupported patterns. */
      }
    }
}
