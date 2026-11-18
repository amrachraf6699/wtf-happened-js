# WTF Happened?

**You were gone. Your code wasn't. Here's WTF happened.**

Local Git catch-up for JavaScript, TypeScript, backend services, frontend apps,
and monorepos. No framework boot, application imports, plugins or installation
of analyzed project dependencies. Built for **#OneToolEveryWeek** by Amr Achraf.

## Install and run

Requirements: Node **22.14+**, **24**, or **26**, Git **2.46+** on PATH, and a local
working tree. These LTS lines are covered by the compatibility workflow, including
the minimum Node version; a green run is the evidence for a particular release.
Git 2.46 is the conservative minimum for lazy-fetch suppression (documented in
Git 2.45.1); time filtering needs 2.37+.

```sh
npm install --save-dev @amrachraf6690/wtf-happened
npx wtf-happened
npx wtf-happened --days=30
npx wtf-happened --since=v1.0.0
npx wtf-happened --funny
npx wtf-happened --no-ai --json
```

Explicit one-shot invocation:

```sh
npm exec --package=@amrachraf6690/wtf-happened -- wtf-happened --no-ai
```

Or install globally with `npm install --global @amrachraf6690/wtf-happened`, then
run `wtf-happened`. An npm script can use `"catchup": "wtf-happened --no-ai"`.
The package ships compiled JavaScript/declarations; there are no installation
hooks or consumer compilation. ESM and CommonJS applications can both use the CLI.
Package-manager installation/download traffic is separate from the CLI: analysis
is offline by default and never invokes npm/npx or downloads models.

## Options and scope

| Flag          | Behavior                                                           |
| ------------- | ------------------------------------------------------------------ |
| `--days=N`    | Last N days, 1–3650, default 7                                     |
| `--since=REF` | After one local ancestor hash/tag/reference, excluding that commit |
| `--cwd=PATH`  | Select this directory as the analysis root                         |
| `--ai`        | Enable one external AI request for this run                        |
| `--no-ai`     | Override all persistent and explicit AI opt-ins                    |
| `--funny`     | Fact-based code/workflow humor; never enables AI                   |
| `--json`      | Exactly one versioned JSON report; diagnostics on stderr           |
| `--no-color`  | Disable color; `NO_COLOR` also works                               |
| `--help`      | Informational text; takes precedence over version/JSON             |
| `--version`   | Version text; takes precedence over JSON                           |

Values also accept `--days 30` style. Unknown/missing/invalid options fail.
Arguments are validated before help/version. Explicit `--days`, even `--days=7`,
conflicts with `--since`. Revision expressions (`HEAD~2`, ranges, path expressions)
are rejected; resolve a hash yourself. No remote fetch occurs.

Without `--cwd`, the nearest package.json at or above invocation cwd is selected,
stopping at the containing Git root. If there is none, invocation cwd is selected.
`--cwd` selects exactly that real directory, even if another manifest is nearby.
Use `--cwd=.` from a monorepo root to analyze the whole repository. Running in one
package excludes sibling applications. The report shows repository-relative scope.
Git discovery is never anchored to the installed CLI directory.

## Example report

Illustrative sample, not measured results:

```text
WTF HAPPENED?
You were gone. Your code wasn't. Here's WTF happened.
Scope: apps/api

THE DAMAGE REPORT
8 commits | 12 changed files | 3 contributors

WHAT CHANGED
Routes: 2 files changed
Migrations: 1 files changed

AFFECTED MODULES
src/modules/orders: 4 files changed

WORTH REVIEWING
src/routes/orders.ts - Routes changed; worth reviewing.

AI: DISABLED
```

Under-30-second demo in an existing checkout: run `npx wtf-happened --no-ai`, then
`npx wtf-happened --funny --no-ai`, then `npx wtf-happened --no-ai --json`. Download
time is excluded. Terminal output uses ASCII headings, bounded sections, width
wrapping, and TTY-only color. Repository/provider control sequences are removed.

## Configuration

Only `wtf-happened.config.json` and `.env` at the selected root are read. There is
no ancestor/global/sibling config search. Inputs are regular files bounded to
64 KiB; symlinks escaping the selected root are rejected. JSON is strictly
validated, unknown settings and prototype-polluting keys are rejected. JavaScript
configuration, application code, scripts and shell expansion are never executed.

Merge order: defaults → selected-root JSON → selected-root `.env` with real process
environment overriding present keys → CLI options. Nested objects merge; ordered
lists replace. Environment mappings override only when present. The `.env` parser
is Node's data-only `util.parseEnv`; it supports quoted values/comments but does
not expand commands or variables, mutate process.env, or enable AI merely because
keys exist. Normal analysis writes no configuration.

```json
{
  "default_days": 7,
  "max_commits": 100,
  "analysis": {
    "module_roots": ["packages/*", "apps/*", "src/features/*", "components/*"],
    "category_rules": [
      {
        "pattern": "components/*/gateways/**",
        "category": "Gateways",
        "review": true
      }
    ]
  },
  "ai": {
    "enabled": false,
    "provider": "openai",
    "model": null,
    "include_diffs": false,
    "response_format": "json_object",
    "max_payload_bytes": 40000,
    "max_diff_bytes": 20000,
    "timeout_seconds": 20
  }
}
```

`max_commits`: 1–1000; `max_payload_bytes`: 2000–40000; `max_diff_bytes`: 0–20000;
`timeout_seconds`: 1–20. `api_key`, `base_url`, and `model` default to null;
`provider_keys` defaults to an empty provider-to-key map. Prefer untracked
environment variables for secrets. Never commit real keys in JSON or `.env`.

## Classification and modules

Case-insensitive, full committed-path heuristics recognize controllers, handlers,
services, middleware, models/entities, repositories, validation, auth, policies,
guards, jobs/queues, events/listeners, commands, providers, utilities, types,
interfaces, DTOs, enums, exceptions and Nest module/interceptor/pipe/filter/resolver
suffixes. Next App/Pages API routes and pages/layouts/loading/error conventions,
React/Vue/Svelte components, SvelteKit routes, hooks/composables, Angular directives,
stores, migrations, schemas, seeders, GraphQL, documentation, tests/fixtures,
configuration, dependencies, styles/assets, translations, CI and infrastructure
have separate categories. Ambiguous paths remain Other; filenames do not prove
behavior. Dependency/generated and documentation paths do not acquire source roles.
Tests take precedence over controller/service suffixes.

Default module roots, in order:
`packages/@*/*`, `packages/*/*`, `packages/*`, `apps/*`, `services/*`, `modules/*`, `src/modules/*`,
`src/features/*`, `src/domain/*`, `src/domains/*`, `domain/*`, `domains/*`.
With default roots, bounded frozen-HEAD package.json npm/Yarn workspaces,
simple pnpm-workspace.yaml package lists and Nx workspaceLayout add hints after
the defaults. Turborepo conventional apps/packages work without installing Turbo.
Complex YAML/globs are not inferred; configure explicit roots. An explicit root
list disables automatic hints and replaces defaults. For vendor-style roots use
`packages/*/*` before `packages/*`, with a narrower vendor prefix if ambiguous.

`packages/*/*` skips conventional source directory names such as `src` and `lib`
to distinguish vendor/package roots. Use explicit roots for ambiguous layouts.

`*` matches a nonempty segment, `**` crosses zero or more segments, `?` matches one
character. No braces, extglobs or negation. First matching root wins; first custom
category rule wins before built-ins. Omitted `review` is false. Lists replace,
so include default entries when extending. Module/category counts deduplicate
changed entries; rename destinations determine category/module, while both paths
are checked for review and privacy. At most eight modules are shown in the terminal;
JSON includes all. Adding a module root extends the source excerpt allowlist.
Custom categories never bypass privacy exclusions.

## Optional AI

```dotenv
WTF_HAPPENED_AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your-key
WTF_HAPPENED_AI_MODEL=your-supported-model
```

Then `npx wtf-happened --ai`. There is no default model, provider/model substitution,
automatic retry, browsing, tool execution, or conversation history. Empty analyzed
history skips AI successfully. `--no-ai` overrides `--ai`, which overrides
persistent `ai.enabled`. Keys, models, funny mode and diff consent do not enable AI.

| Provider   | Key variable                        | Protocol / default base                                            |
| ---------- | ----------------------------------- | ------------------------------------------------------------------ |
| openai     | OPENAI_API_KEY                      | Responses · https://api.openai.com/v1                              |
| anthropic  | ANTHROPIC_API_KEY                   | Messages · https://api.anthropic.com/v1                            |
| gemini     | GEMINI_API_KEY, then GOOGLE_API_KEY | generateContent · https://generativelanguage.googleapis.com/v1beta |
| deepseek   | DEEPSEEK_API_KEY                    | Chat · https://api.deepseek.com/v1                                 |
| groq       | GROQ_API_KEY                        | Chat · https://api.groq.com/openai/v1                              |
| mistral    | MISTRAL_API_KEY                     | Chat · https://api.mistral.ai/v1                                   |
| xai        | XAI_API_KEY                         | Chat · https://api.x.ai/v1                                         |
| openrouter | OPENROUTER_API_KEY                  | Chat · https://openrouter.ai/api/v1                                |
| together   | TOGETHER_API_KEY                    | Chat · https://api.together.ai/v1                                  |
| fireworks  | FIREWORKS_API_KEY                   | Chat · https://api.fireworks.ai/inference/v1                       |
| cerebras   | CEREBRAS_API_KEY                    | Chat · https://api.cerebras.ai/v1                                  |
| ollama     | OLLAMA_API_KEY (optional locally)   | Chat · http://localhost:11434/v1                                   |
| custom     | WTF_HAPPENED_AI_API_KEY             | Chat · explicit base required                                      |

Environment mappings are `WTF_HAPPENED_AI_ENABLED`, `WTF_HAPPENED_AI_PROVIDER`,
`WTF_HAPPENED_AI_API_KEY`, `WTF_HAPPENED_AI_MODEL`, `WTF_HAPPENED_AI_BASE_URL`,
`WTF_HAPPENED_AI_RESPONSE_FORMAT`, `WTF_HAPPENED_AI_INCLUDE_DIFFS`, plus provider
keys above. The generic key explicitly overrides the selected provider key; another
provider's key is never used. Booleans accept true/false/1/0.

Persistent metadata opt-in: `WTF_HAPPENED_AI_ENABLED=true` authorizes future runs.
Independent source consent: `WTF_HAPPENED_AI_INCLUDE_DIFFS=true`. Before the one
request, stderr names the provider, endpoint and transmission scope.

OpenAI uses strict Responses `text.format` JSON schema and `store:false`. Gemini
uses JSON MIME/schema. Anthropic uses prompted JSON with API version 2026-10-21.
Chat adapters default to `json_object`; explicitly select `json_schema` or `prompt`
using `WTF_HAPPENED_AI_RESPONSE_FORMAT` according to your model's capabilities.
All modes enforce the same local contract. Unsupported formats/models fail safely;
no fallback request occurs. Tests cover adapters, not live account/model availability.

Local Ollama: set provider `ollama` and model `your-installed-model`, then `--ai`.
Start/install your model yourself. Custom gateway example:

```dotenv
WTF_HAPPENED_AI_PROVIDER=custom
WTF_HAPPENED_AI_BASE_URL=https://gateway.example/v1
WTF_HAPPENED_AI_API_KEY=your-key
WTF_HAPPENED_AI_MODEL=your-supported-model
```

Only custom/Ollama accept base overrides. Include API prefix; `/chat/completions`
is appended. HTTPS is required except exact localhost/127.0.0.1/[::1]. Credentials,
query strings, fragments, unsafe URL forms and redirects are rejected. Keys are
optional only for local custom/Ollama. Direct Azure/Bedrock/Vertex authentication
is not implemented; compatible gateways can use custom.

## Privacy, history and limits

- No telemetry, network by default, prompts/diffs on disk, background tasks,
  checkpoints or automatic fixes. Uncommitted/untracked source is ignored.
- Freeze HEAD once. Select committer dates with absolute UTC cutoff and invocation
  upper bound; `--since-as-filter` handles unusual date ordering. Ancestor ranges
  include reachable side branches. Each commit compares to its first parent;
  only genuine roots compare to empty trees. Merge overlap is expected, not net churn.
- Complete-tree renames are detected before subtree filtering. Cross-boundary
  moves become scoped additions/deletions without sibling paths or excerpts.
  Renames replace prior changed entries; deletions remain counted. Counts describe
  analyzed entries, not current files. Contributor emails normalize locally with
  name fallback; only the count is exposed.
- Shallow boundaries are omitted and incompleteness disclosed. Default 100 matching
  commits plus one detected extra; traversal caps at 10,000 candidates. Git has
  10 seconds/process, 30 seconds overall including excerpts, 2 MiB/process and
  10 MiB overall stdout+stderr limits. Completed commits survive budget exhaustion;
  no complete total is invented. Traversal can exhaust a budget before any matches.
- Git uses shell-free argument arrays, NUL paths, literal pathspecs, stripped Git
  overrides, no pager/external diffs/textconv/replacement objects/lazy fetch,
  disabled fsmonitor, credentials and remote protocols. Normal runs do not alter
  refs, files, index, working tree or Git config. Invalid UTF-8 evidence fails safely
  instead of selecting a replacement-character path. Literal Unix backslashes stay
  literal. Display filtering can make unusual filenames look different.
- AI metadata is sanitized counts/completeness, truncated subjects, relative
  paths/status/categories/modules and opaque IDs. No authors, remotes, absolute
  paths, full commit bodies or working-tree source. Excerpts require both consents.
- Source allowlist: JS/TS variants, Vue/Svelte under recognized src/app/pages/routes/
  server/lib/components/composables/hooks/database/prisma/drizzle/tests, conventional
  api/middleware/plugins/stores/utils/controllers/services/models/jobs, and module
  roots. Config/environment/credential/key/certificate files, lockfiles, generated/
  dependency/build/cache output, binary/invalid UTF-8, symlink/submodule and oversized
  blobs are excluded. Both rename paths are checked before reading blobs.
- Blob mode/size checked first; either side over 256 KiB is skipped. At most ten
  excerpts, 2048 bytes each, 20000 bytes combined, one context line. Review changes
  precede newest commits and lexical paths. UTF-8 slicing and final JSON-encoded
  payload bounds apply after redaction. Excerpts never enter public evidence/JSON.
- One request; five-second connection and at most twenty-second total timeout;
  response streams, including error bodies, capped at 64 KiB. No redirects/retries.
  Refusal, truncation, tool calls, invalid JSON/evidence and HTTP failures preserve
  deterministic results with a sanitized diagnostic.

**Automatic filtering cannot guarantee secret removal.** Subjects/filenames may
be sensitive. Obvious secret assignments, bearer/provider tokens, key blocks,
credential URLs, emails and terminal controls are filtered. OpenAI `store:false`
does not guarantee zero retention. Providers/gateways have their own data policies.
Structured output and valid evidence references do not prove factual correctness.
Review heuristics are not security scanning or verified behavior analysis.

## JSON and programmatic API

Schema version 1 always contains `schema_version`, `status`, `range`, `scope`,
`completeness`, `statistics`, `changes`, `review_items`, `ai`, `warnings`, `error`.
Errors retain the envelope, empty counts/collections as appropriate, and nullable
range/error. `status`: ok/degraded/error. AI: disabled/skipped_empty/succeeded/failed.
`completeness.history` and `.ai_context` report independent omissions.
`range`: frozen head/since IDs, days, UTC cutoff/until. `statistics`: commits/files/
contributors. `changes`: files/categories/directories/modules/subjects; files include
path, old_path, status, category and nullable module. Count maps are JSON objects.
`ai`: status/provider/summary/evidence. Public evidence maps IDs to subjects/paths.

AI summary has exactly summary, highlights (≤5), potential_risks (≤3),
suggested_next_step and funny_comment (null unless requested). Each statement has
nonempty text ≤600 Unicode characters and 1–10 known evidence_ids. Unexpected keys,
unknown IDs and fenced/non-JSON output are rejected. AI cannot change statistics.

Exit 0: report, including empty/partial. Exit 1: Git/environment or enabled AI
failure. Exit 2: invalid CLI/configuration. AI failures preserve facts with degraded
status. JSON stdout is one object even on errors; stderr carries diagnostics.
Help/version are documented informational exceptions.

```js
import { analyze } from '@amrachraf6690/wtf-happened';
const { report, exitCode } = await analyze({ cwd: process.cwd(), noAi: true });
console.log(report.statistics);
```

The ESM API accepts CLI-equivalent camelCase options and optional runtime
`{env, now, signal, notice}` for isolated environment/time, cancellation and notice
handling. It returns `{report, exitCode}` rather than throwing analysis failures.
Importing has no CLI side effects. CommonJS callers can use dynamic `import()`;
synchronous `require()` library access is not provided.

Development: `npm ci && npm run check`. See [CONTRIBUTING.md](CONTRIBUTING.md) for
tests, exact-SHA compatibility gates and the release process. Licensed [MIT](LICENSE).
