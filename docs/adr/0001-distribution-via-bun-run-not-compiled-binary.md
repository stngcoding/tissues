# 0001 - Distribute via `bun run`, not a compiled single-file binary

Status: accepted (2026-07-31)

## Context

The spec (`docs/spec/tui-issue-viewer.md`) flagged OpenTUI's pre-1.0 churn as a
distribution risk, with a Ratatui rewrite as the escalation path if a single
self-contained binary proved unreliable. Issue #12 is the spike to settle it.

`bun build --compile --outfile tissues src/index.ts` succeeds and produces a
~63 MB single-file executable. It crashes at startup:

```
TypeError: undefined is not an object (evaluating 'loadedPath.startsWith')
    at normalizeLoadedFilePath (/$bunfs/root/tissues)
```

Root cause is upstream, in `@opentui/core@0.4.5`:

```js
// chunk-bun-*.js
var bundledTreeSitterWorkerPath = await resolveBundledFilePath(
  PARSER_WORKER_ASSET_KEY,
  () => import("@opentui/core/parser.worker", { with: { type: "file" } }),
  new URL("../lib/tree-sitter/parser.worker.js", import.meta.url),
  import.meta.url,
  { useAssetRoot: false },   // <- env override disabled for this asset
);
```

This is a top-level `await` evaluated at module load. Under `bun run`, a
`type: "file"` import resolves `.default` to a filesystem path string, so
`normalizeLoadedFilePath` works. Under the `bun build --compile` runtime the
asset is embedded and `.default` is not a path, so `.startsWith` throws before
`initialize()` ever runs. Because this call hardcodes `useAssetRoot: false`,
the documented `OTUI_ASSET_ROOT` relocation hatch cannot rescue it (verified:
copying every wasm + the worker into an asset root and setting the env var
still throws at the same line).

So the markdown renderer's tree-sitter worker cannot load inside a compiled
binary with this OpenTUI version. It is not a bundling flag we are missing; it
is an upstream assumption that only holds for the interpreted runtime.

## Decision

Ship the app to run under `bun run`, not as a compiled binary:

- `bun run src/index.ts` after `bun install` (the `dev`/`start` scripts), or
- publish as a package whose `bin` Bun executes.

Keep the `build` script in `package.json` so the compile path is one command
away the moment upstream fixes asset embedding, but do not treat the binary as
a supported artifact yet.

Do **not** trigger the Ratatui rewrite. Everything else works, and the only
gap is single-file packaging - a build-time concern with a clear upstream
owner, not a defect in the app. Revisit only if a self-contained binary
becomes a hard product requirement.

## Consequences

- Users need Bun installed. Acceptable: the tool targets developers, and the
  companion `gh` CLI is an equivalent prerequisite.
- Startup asset resolution works fine under `bun run` (real tree-sitter client
  initialises in ~40 ms and highlights correctly), so there is no runtime cost
  to this choice - only a packaging one.
- When OpenTUI fixes the compiled-runtime worker path, revisit: re-run
  `bun run build`, smoke-test the binary, and supersede this ADR.

## Note on the PTY smoke test (#12)

The planned `Bun.Terminal` PTY smoke test cannot run here: Bun 1.2.9 predates
`Bun.Terminal` (added in 1.3.5). The headless `createTestRenderer` E2E suite
(`tests/e2e.test.ts`) already drives the full interactive surface - keys,
overlays, scrolling, mutations - against real render frames, so PTY coverage
would be redundant belt-and-suspenders rather than a missing guarantee.
