# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-rc.6] - 2026-03-26

### Fixed

- **`convertTree()` OOM on large files** — The AST conversion function called
  `.map(convertTree)` on both `children` and `namedChildren` arrays in the same
  recursive traversal. Since `namedChildren` is a subset of `children`, every
  named node was visited twice, causing exponential memory growth when the
  tree-sitter WASM layer allocates Node wrappers for each accessor call.
  Files with 2000+ nodes (e.g. 15KB PDXScript) would exhaust a 4 GB heap.
  Now uses a single pass: `children.map(convertTree)` + `converted.filter(n => n.isNamed)`
  for `namedChildren`. Identical output, ~1.6 MB heap for the same file. (closes #8)

## [0.1.0-rc.5] - 2026-03-26

### Added

- **`resetParser()` / `disposeParser()`** — Clears the cached tree-sitter parser
  singleton so the next `parse()` call re-initializes with the current
  `grammarBinaryLoader` and `locateFileFn` settings. (closes #5)
  - `resetParser()` — nulls the parser and resets the init flag
  - `disposeParser()` — same + calls `parser.delete()` for WASM resource cleanup
  - Enables test isolation (call in `beforeEach`) and recovery from bad
    `setGrammarBinary()` calls without reloading the module.
- **`getGrammarWasmPath()`** — Resolves the grammar WASM path relative to the
  module's `__dirname` (captured at load time, before bundlers rewrite it).
  Works reliably across CJS/ESM and bundled/unbundled environments. (addresses #3)
  - `defaultGrammarBinaryLoader` now uses this internally (DRY).
- **`PARSER_NAME` constant** — Exports `"pdx-script-parse"` as a named constant,
  removing the fragile magic string from consumers and internal usage. (addresses #4)

### Changed

- `languages` and `parsers` now reference `PARSER_NAME` instead of a hardcoded
  string literal.

## [0.1.0-rc.4] - 2026-03-25

### Fixed

- **Exports field exposes grammar WASM and package.json subpaths** — The
  `exports` field previously only listed the main entry point, blocking
  `require.resolve()` for the grammar WASM subpath. Downstream consumers
  (e.g. VS Code extensions) can now reliably resolve the WASM path via
  `require.resolve("prettier-plugin-pdx-script/dist/tree-sitter/tree-sitter-pdx_script.wasm")`
  for use with `setGrammarBinary()`, eliminating fragile workarounds like
  `__dirname` path concatenation.
- `./package.json` is now explicitly exported, which is standard practice for
  npm packages and needed by some tooling (e.g. `npm ls` metadata inspection).
- README updated to document the new exports shape and WASM resolution path.

## [0.1.0-rc.3] - 2026-03-24

### Added

- **`setLocateFile(fn)` / `getLocateFile()` API** — Exposes web-tree-sitter's
  `locateFile` callback as a configurable hook. Consumers can now control how
  `tree-sitter.wasm` (the tree-sitter runtime) is resolved, which is required
  when bundling this plugin in environments where the default `scriptDir`
  resolution fails (e.g. VS Code extensions packaged with webpack/esbuild).
  - New export: `LocateFileFn` type — `(fileName: string, scriptDir: string) => string`
  - New export: `setLocateFile(fn)` — override the callback (must be called before first `parse()`)
  - New export: `getLocateFile()` — retrieve the current callback
- **Bundling documentation in README** — The "Bundling" section now covers both
  WASM files that consumers may need to supply: the grammar WASM
  (`setGrammarBinary`) and the runtime WASM (`setLocateFile`).
- Intent comments throughout `index.ts` explaining why the configurable
  `locateFile` exists and when it takes effect.

### Changed

- `Parser.init()` now uses the configurable `locateFileFn` instead of a
  hardcoded inline callback. The default behavior is identical (`path.join`
  on `scriptDir` + `fileName`), but consumers can now override it.
- `parserInitialized` guard now covers `setLocateFile()` as well as
  `setGrammarBinary()` — both warn if called after parser init.
- CJS shape test now asserts `setLocateFile` and `getLocateFile` are present
  and are functions.

## [0.1.0-rc.2] - 2026-03-24

### Fixed

- **CI workflow: build before test** — The 3 CJS entry point tests assert
  against `dist/index.cjs`, which requires a prior `bun run build`. The CI
  workflow now runs build before test.
- **CJS test portability** — Replaced bare `require()` with
  `createRequire(import.meta.url)` in tests, which works in both Node.js and
  Bun ESM environments.

### Added

- **npm publish workflow** (`.github/workflows/publish.yml`) — Automatically
  publishes to npm when a GitHub Release is created from a `v*` tag. Uses
  Bun for build and npm for publish with `--provenance` support. Requires
  `NPM_TOKEN` secret in the repository.
- Post-init warning for `setGrammarBinary()` — Logs a warning if called after
  the parser has been initialized, since the cached parser would still use
  the old loader.
- `Uint8Array` validation in `getOrInitParser()` — Throws a descriptive error
  if the grammar binary loader returns `null`/`undefined` instead of a
  `Uint8Array`, instead of letting `web-tree-sitter` throw a cryptic WASM error.

### Changed

- README updated with `index.d.cts` in file structure table.
- README updated with `REFACTOR_RESPONSE.md` reference.

### Removed

- `REFACTOR_RESPONSE.md` — Merge conflict resolution and code review findings
  have been integrated into the codebase.

## [0.1.0-rc.1] - 2026-03-23

### Added

- **Dual CJS/ESM build** — tsup now produces both `dist/index.cjs` (CJS) and
  `dist/index.js` (ESM) with matching TypeScript declarations
  (`index.d.cts` and `index.d.ts`).
- **Conditional exports map** — `package.json` `exports` field routes
  `import` to ESM and `require` to CJS automatically.
- **Configurable WASM loading** — `setGrammarBinary(loader)` lets consumers
  supply the grammar WASM as a `Uint8Array`, replacing the fragile
  `readFileSync` default for bundled environments.
  - `GrammarBinaryLoader` type
  - `getGrammarBinary()` to inspect the current loader
- **Cached parser singleton** — The tree-sitter parser is initialized once
  and reused for subsequent `parse()` calls (~70ms savings per call).
- **Test fixtures** — Fixture-based test framework that auto-discovers
  `__fixtures__` directories and runs input/expected pairs.
- **Idempotency tests** — Verifies formatting the same input twice produces
  identical output.
- **CJS entry point tests** — Verifies `dist/index.cjs` loads, exports the
  expected shape, and formats correctly.

### Changed

- Parser now uses async lazy initialization (`getOrInitParser()`) instead of
  synchronous per-call init.
- `parse()` is now async (returns `Promise`), consistent with Prettier's
  async parser support.
- Tree-sitter nodes converted to plain objects via `convertTree()` to work
  with Prettier's `path.map`/`path.call` traversal (tree-sitter uses
  getters, not stored properties).

## [0.1.0] - 2026-03-20

### Added

- Initial release.
- PDXScript parser using tree-sitter WASM.
- Prettier printer for PDXScript formatting rules:
  - Tab indentation (one per nesting level)
  - Empty block collapsing (`{ }` → `{}`)
  - Block value expansion (inline blocks → multiline)
  - Comment normalization
  - Operator preservation (`=`, `>`, `<`)
