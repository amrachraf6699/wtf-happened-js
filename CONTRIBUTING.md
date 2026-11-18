# Contributing

Use Node 22.14+, 24, or 26 and Git 2.46+. Install with `npm ci`, then run
`npm run check`. Runtime has no third-party dependencies. TypeScript, ESLint and
Prettier are development tools. `npm run format` applies LF formatting.

Tests use temporary repositories and a local HTTP server. They strip provider
credentials and never make paid provider requests. Keep tests cross-platform;
POSIX filename tests explicitly skip on Windows. Never use a real repository as
a mutation fixture. Do not commit generated dist, tarballs, secrets, or fixtures.

Behavioral parity reference: the PHP source and tests at
[v1.0.1](https://github.com/amrachraf6699/wtf-happened/tree/v1.0.1).
This is a separate implementation/history; no PHP dependencies are required.

## Release procedure

1. Ensure package.json, lockfile, changelog and requested version agree. Inspect
   registry ownership/version state. Never overwrite an existing release/tag.
2. Run `npm run check`, commit and push main normally. Wait for every Compatibility
   matrix job at that exact SHA: Linux 22.14.0/22/24/26, Windows 24, macOS 24.
3. `npm run pack:verify` checks the allowlist, actual tar contents, fresh ESM and
   CommonJS consumer installs, npm scripts/bin, dynamic imports and TypeScript.
   Keep its validated tarball. The manually dispatched release workflow also
   produces a SHA-labelled artifact only after its entire matrix passes.
4. Record the actual release date in CHANGELOG.md and rerun validation/CI for the
   resulting release SHA before tagging. Create annotated `v1.0.1` at that SHA,
   push it, and create a GitHub release with install instructions.
5. Bootstrap path for this new npm package: browser-based `npm login` as
   **amrachraf6690**, verify `npm whoami --registry=https://registry.npmjs.org`, then
   `npm publish amrachraf6690-wtf-happened-1.0.1.tgz --access public --tag latest`.
   Complete npm's interactive 2FA in the terminal/browser. Do not put credentials
   in repository files or chat. No automatic publish workflow runs in parallel.
6. Verify registry version, repository metadata, latest dist-tag, and install
   `@amrachraf6690/wtf-happened@1.0.1` from the registry in a fresh project; run the
   installed bin and an actual fixture analysis. Tarball smoke tests alone do not
   establish successful publication.

For subsequent releases, prefer npm trusted publishing after the package exists
and its owner configures the exact repository/workflow in npm package settings.
Current npm documentation requires npm >=11.5.1 and Node >=22.14 for OIDC. Use a
single gated publisher, `id-token: write` only in that job, verify tag/version and
exact-SHA tests, and refuse an existing version. The bootstrap workflow here has
only `contents: read` and deliberately does not claim provenance or publication.

Official references checked during implementation:

- [Node release schedule](https://github.com/nodejs/Release/blob/main/schedule.json)
- [Git log](https://git-scm.com/docs/git-log) and [diff-tree](https://git-scm.com/docs/git-diff-tree)
- [Scoped npm publication](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
- [Trusted publishers](https://docs.npmjs.com/trusted-publishers/)
- [GitHub Node CI](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs)
