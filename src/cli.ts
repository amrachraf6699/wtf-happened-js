#!/usr/bin/env node
import { analyze } from './index.js';
import { parseOptions, HELP } from './options.js';
import { emptyReport, Failure } from './types.js';
import { render } from './report.js';
const abort = new AbortController();
for (const stream of [process.stdout, process.stderr])
  stream.on('error', () => {
    abort.abort();
    process.exitCode = 0;
  });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    abort.abort();
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
  });
const args = process.argv.slice(2);
let json = args.includes('--json');
try {
  const options = parseOptions(args);
  json = options.json ?? false;
  if (options.help) process.stdout.write(HELP);
  else if (options.version) process.stdout.write('1.0.1\n');
  else {
    const { report, exitCode } = await analyze(options, {
      signal: abort.signal,
    });
    if (!abort.signal.aborted) {
      if (report.error) process.stderr.write(report.error + '\n');
      if (json)
        for (const warning of report.warnings)
          process.stderr.write(warning + '\n');
      process.stdout.write(
        json
          ? JSON.stringify(report) + '\n'
          : render(report, {
              funny: options.funny,
              color:
                !!process.stdout.isTTY &&
                !options.noColor &&
                !Object.hasOwn(process.env, 'NO_COLOR'),
              width: process.stdout.columns,
            }),
      );
      process.exitCode = exitCode;
    }
  }
} catch (e) {
  if (!abort.signal.aborted) {
    const report = emptyReport();
    report.status = 'error';
    report.completeness.history = false;
    report.error =
      e instanceof Failure ? e.message : 'Unable to complete analysis.';
    process.stderr.write(report.error + '\n');
    process.stdout.write(json ? JSON.stringify(report) + '\n' : render(report));
    process.exitCode = e instanceof Failure ? e.exitCode : 1;
  }
}
