import { clean } from './privacy.js';
import type { Report } from './types.js';
export function render(
  report: Report,
  options: { funny?: boolean; color?: boolean; width?: number } = {},
): string {
  const width = Math.max(20, Math.min(100, options.width ?? 80));
  const lines: string[] = [];
  const line = (s = '') => {
    const chars = [...clean(s)];
    if (!chars.length) lines.push('');
    while (chars.length) lines.push(chars.splice(0, width).join(''));
  };
  const heading = (s: string) => {
    line();
    lines.push(options.color ? `\x1b[1;36m${s}\x1b[0m` : s);
  };
  heading('WTF HAPPENED?');
  line("You were gone. Your code wasn't. Here's WTF happened.");
  line('Scope: ' + report.scope);
  if (report.range)
    line(
      report.range.since
        ? 'Range: after ' +
            report.range.since.slice(0, 12) +
            ' through ' +
            report.range.head?.slice(0, 12)
        : 'Window: last ' + report.range.days + ' days',
    );
  heading('THE DAMAGE REPORT');
  const stats = report.statistics;
  line(
    `${stats.commits} commits | ${stats.files} changed files | ${stats.contributors} contributors`,
  );
  if (!report.completeness.history)
    line('Analyzed counts; incomplete history.');
  if (!stats.commits) line('No matching commits were analyzed.');
  heading('WHAT CHANGED');
  for (const [k, v] of Object.entries(report.changes.categories).slice(0, 25))
    line(`${k}: ${v} files changed`);
  line(
    'Main directories: ' +
      Object.keys(report.changes.directories).slice(0, 3).join(', '),
  );
  if (Object.keys(report.changes.modules).length) {
    heading('AFFECTED MODULES');
    for (const [k, v] of Object.entries(report.changes.modules).slice(0, 8))
      line(`${k}: ${v} files changed`);
  }
  for (const subject of report.changes.subjects.slice(0, 5))
    line('Commit: ' + subject);
  if (report.review_items.length) {
    heading('WORTH REVIEWING');
    for (const item of report.review_items.slice(0, 8))
      line(item.path + ' - ' + item.reason);
  }
  heading('AI: ' + report.ai.status.toUpperCase());
  if (report.ai.summary) {
    line(
      'AI interpretation; references do not prove correctness. Verify against Git.',
    );
    const ai = report.ai.summary;
    for (const s of [ai.summary, ...ai.highlights, ...ai.potential_risks])
      line(`${s.text} [${s.evidence_ids.join(', ')}]`);
    heading('SUGGESTED NEXT STEP');
    line(ai.suggested_next_step.text);
    if (ai.funny_comment) line(ai.funny_comment.text);
    for (const e of report.ai.evidence.slice(0, 10))
      line(`${e.id}: ${e.subject} (${e.paths.slice(0, 3).join(', ')})`);
  } else {
    heading('SUGGESTED NEXT STEP');
    line(
      report.review_items.length
        ? 'Review the listed changes and their committed diffs.'
        : 'Inspect the selected history with Git.',
    );
    if (options.funny && stats.commits)
      line(
        `${stats.commits} commits while you were away. Git did not take the same vacation.`,
      );
  }
  for (const warning of report.warnings) line('Note: ' + warning);
  if (report.error) line(report.error);
  return lines.join('\n') + '\n';
}
