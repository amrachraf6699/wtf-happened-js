export interface Options {
  cwd?: string;
  days?: number;
  since?: string;
  ai?: boolean;
  noAi?: boolean;
  funny?: boolean;
  json?: boolean;
  noColor?: boolean;
  help?: boolean;
  version?: boolean;
}
export interface Rule {
  pattern: string;
  category: string;
  review?: boolean;
}
export interface Config {
  default_days: number;
  max_commits: number;
  analysis: { module_roots: string[]; category_rules: Rule[] };
  ai: {
    enabled: boolean;
    provider: string;
    api_key: string | null;
    provider_keys: Record<string, string>;
    model: string | null;
    base_url: string | null;
    response_format: string;
    include_diffs: boolean;
    max_payload_bytes: number;
    max_diff_bytes: number;
    timeout_seconds: number;
  };
}
export interface Change {
  path: string;
  old_path: string | null;
  status: string;
  old: string;
  new: string;
  cross: boolean;
}
export interface Commit {
  hash: string;
  parent: string | null;
  timestamp: number;
  author: string;
  subject: string;
  changes: Change[];
}
export interface FileChange {
  path: string;
  old_path: string | null;
  status: string;
  category: string;
  module: string | null;
}
export interface Statement {
  text: string;
  evidence_ids: string[];
}
export interface Summary {
  summary: Statement;
  highlights: Statement[];
  potential_risks: Statement[];
  suggested_next_step: Statement;
  funny_comment: Statement | null;
}
export interface Report {
  schema_version: 1;
  status: 'ok' | 'degraded' | 'error';
  range: {
    head: string | null;
    since: string | null;
    days: number | null;
    cutoff: string | null;
    until: string;
  } | null;
  scope: string;
  completeness: { history: boolean; ai_context: boolean };
  statistics: { commits: number; files: number; contributors: number };
  changes: {
    files: FileChange[];
    categories: Record<string, number>;
    directories: Record<string, number>;
    modules: Record<string, number>;
    subjects: string[];
  };
  review_items: { path: string; reason: string }[];
  ai: {
    status: 'disabled' | 'skipped_empty' | 'succeeded' | 'failed';
    provider: string | null;
    summary: Summary | null;
    evidence: { id: string; subject: string; paths: string[] }[];
  };
  warnings: string[];
  error: string | null;
}
export class Failure extends Error {
  constructor(
    message: string,
    public exitCode: 1 | 2 = 1,
    public budget = false,
  ) {
    super(message);
  }
}
export function emptyReport(): Report {
  return {
    schema_version: 1,
    status: 'ok',
    range: null,
    scope: '.',
    completeness: { history: true, ai_context: true },
    statistics: { commits: 0, files: 0, contributors: 0 },
    changes: {
      files: [],
      categories: {},
      directories: {},
      modules: {},
      subjects: [],
    },
    review_items: [],
    ai: { status: 'disabled', provider: null, summary: null, evidence: [] },
    warnings: [],
    error: null,
  };
}
