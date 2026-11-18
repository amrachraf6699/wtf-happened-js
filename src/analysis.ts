import { classify } from './classifier.js';
import { byteslice, clean } from './privacy.js';
import type { Commit, Config, FileChange, Report } from './types.js';
export function summarize(
  commits: Commit[],
  report: Report,
  config: Config,
): void {
  const files = new Map<string, FileChange>();
  const authors = new Set<string>();
  for (const commit of [...commits].reverse()) {
    if (commit.author) authors.add(commit.author);
    for (const c of commit.changes) {
      if (c.old_path) files.delete(c.old_path);
      const classification = classify(c.path, config.analysis);
      files.set(c.path, {
        path: c.path,
        old_path: c.old_path ?? files.get(c.path)?.old_path ?? null,
        status: c.status,
        category: classification.category,
        module: classification.module,
      });
    }
  }
  const count = (items: string[]) => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
    return Object.fromEntries(
      [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  };
  report.changes.files = [...files.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  report.statistics = {
    commits: commits.length,
    files: files.size,
    contributors: authors.size,
  };
  report.changes.categories = count([...files.values()].map((f) => f.category));
  report.changes.modules = count(
    [...files.values()].flatMap((f) => (f.module ? [f.module] : [])),
  );
  report.changes.directories = count(
    [...files.keys()].map((p) =>
      p.includes('/') ? p.split('/')[0] + '/' : './',
    ),
  );
  report.changes.subjects = [
    ...new Set(commits.map((c) => byteslice(clean(c.subject), 1000))),
  ].slice(0, 10);
  for (const file of report.changes.files)
    for (const path of [file.path, file.old_path]) {
      if (path && classify(path, config.analysis).review) {
        report.review_items.push({
          path: file.path,
          reason: `${classify(path, config.analysis).category} changed; worth reviewing.`,
        });
        break;
      }
    }
}
