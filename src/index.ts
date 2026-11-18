import { realpath } from 'node:fs/promises';
import { GitReader } from './git.js';
import { loadConfig } from './config.js';
import { summarize } from './analysis.js';
import { interpret } from './ai.js';
import { manifestHints } from './manifests.js';
import { sanitize } from './privacy.js';
import { emptyReport, Failure, type Options } from './types.js';
export type {
  Options,
  Report,
  Config,
  FileChange,
  Summary,
  Statement,
} from './types.js';
/** Analyze committed local history. No CLI side effects; credentials never enter the returned report. */
export async function analyze(
  options: Options = {},
  runtime: {
    env?: NodeJS.ProcessEnv;
    now?: Date;
    signal?: AbortSignal;
    notice?: (message: string) => void;
  } = {},
) {
  let report = emptyReport();
  let exitCode = 0;
  const now = runtime.now ?? new Date();
  const env = runtime.env ?? process.env;
  try {
    if (options.days !== undefined && options.since !== undefined)
      throw new Failure('--days and --since are mutually exclusive.', 2);
    let invocation: string;
    try {
      invocation = await realpath(options.cwd ?? process.cwd());
    } catch {
      throw new Failure('Cannot access the selected directory.');
    }
    const git = new GitReader(invocation, env, runtime.signal);
    const scope = await git.discover(options.cwd !== undefined);
    report.scope = scope.scope;
    const config = await loadConfig(scope.root, options, env);
    const commits = await git.analyze(
      report,
      config.default_days,
      options.since,
      config.max_commits,
      now,
    );
    await manifestHints(git, report, config);
    summarize(commits, report, config);
    if (config.ai.enabled) {
      if (!commits.length) report.ai.status = 'skipped_empty';
      else {
        try {
          await interpret(
            commits,
            report,
            config,
            git,
            options.funny ?? false,
            runtime.notice ??
              ((message) => process.stderr.write(message + '\n')),
            runtime.signal,
          );
        } catch (e) {
          report.ai.status = 'failed';
          report.status = 'degraded';
          report.error =
            e instanceof Failure
              ? e.message
              : 'AI analysis failed; deterministic results remain available.';
          exitCode = e instanceof Failure ? e.exitCode : 1;
        }
      }
    }
  } catch (e) {
    report.status = 'error';
    report.completeness.history = false;
    report.error =
      e instanceof Failure
        ? e.message
        : 'Unable to analyze local Git history; check installation and repository access.';
    exitCode = e instanceof Failure ? e.exitCode : 1;
  }
  report = sanitize(report);
  return { report, exitCode };
}
