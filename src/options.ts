import { Failure, type Options } from './types.js';
export function parseOptions(args: string[]): Options {
  const result: Options = {};
  const flags: Record<string, keyof Options> = {
    '--ai': 'ai',
    '--no-ai': 'noAi',
    '--funny': 'funny',
    '--json': 'json',
    '--no-color': 'noColor',
    '--help': 'help',
    '--version': 'version',
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (flags[arg]) {
      Object.assign(result, { [flags[arg]!]: true });
      continue;
    }
    const equal = arg.indexOf('=');
    const name = equal < 0 ? arg : arg.slice(0, equal);
    if (!['--days', '--since', '--cwd'].includes(name))
      throw new Failure('Invalid arguments. Run wtf-happened --help.', 2);
    const value = equal < 0 ? args[++i] : arg.slice(equal + 1);
    if (!value || value.startsWith('--'))
      throw new Failure('Missing option value. Run wtf-happened --help.', 2);
    if (name === '--days') {
      if (!/^[1-9]\d*$/.test(value) || Number(value) > 3650)
        throw new Failure('--days must be an integer between 1 and 3650.', 2);
      result.days = Number(value);
    } else if (name === '--since') result.since = value;
    else result.cwd = value;
  }
  if (result.days !== undefined && result.since !== undefined)
    throw new Failure('--days and --since are mutually exclusive.', 2);
  return result;
}
export const HELP = `WTF Happened? 1.0.1
You were gone. Your code wasn't. Here's WTF happened.

Usage: wtf-happened [options]
  --days=N      Last N days (1..3650; default 7)
  --since=REF   After a local ancestor commit/tag (conflicts with --days)
  --cwd=PATH    Explicit analysis root; default nearest package.json
  --ai          Enable one AI request
  --no-ai       Override all AI opt-ins; local Git only
  --funny       Fact-based humor; does not enable AI
  --json        Exactly one versioned report; diagnostics on stderr
  --no-color    Disable terminal color (also NO_COLOR)
  --help        Show this text, taking precedence over --json/--version
  --version     Show version, taking precedence over --json

Arguments are validated before informational output. No application boot.
`;
