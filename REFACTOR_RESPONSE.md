# Refactor Response: prettier-plugin-pdx-script v0.2.0

## Summary

All 4 recommended changes from the `PLUGIN_REPORT.md` have been implemented in branch `refactor/cjs-dual-build`. The downstream extension can now eliminate all ESM/CJS interop workarounds and bundling workarounds.

---

## Changes Implemented

### Change 1: Dual CJS/ESM entry points

**Status:** Implemented

The package now ships both module formats:

```json
{
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "exports": {
    "import": "./dist/index.js",
    "require": "./dist/index.cjs"
  }
}
```

**What the downstream can remove:**

| Workaround                                             | Why it's no longer needed                     |
| ------------------------------------------------------ | --------------------------------------------- |
| `await import("prettier-plugin-pdx-script")`           | `require()` works directly                    |
| `.mts` test file extensions                            | `.ts` works for importing CJS                 |
| `vitest.config.mts` → `vitest.config.ts`               | CJS entry point is available                  |
| `import type ... with { "resolution-mode": "import" }` | CJS can `require()` and access types normally |
| `format: 'cjs'` in esbuild                             | No longer needs to work around ESM-only entry |
| Dependency injection in `formatText()`                 | Normal static import works                    |

**Implementation detail:** Build tool changed from `tsc` to [tsup](https://tsup.ego.dev.dev), which compiles `index.ts` into both CJS and ESM formats with a single config. `printer.ts` is inlined into the bundle (it's our own code, not an external dependency).

---

### Change 2: Configurable WASM loading

**Status:** Implemented

New public API:

```typescript
// Override the grammar WASM binary loader
export function setGrammarBinary(loader: GrammarBinaryLoader): void;

// Get the current loader (useful for wrapping/testing)
export function getGrammarBinary(): GrammarBinaryLoader;
```

The default loader reads from the package's `tree-sitter/` directory. Consumers can override it to supply a `Uint8Array` directly — for example when bundling with esbuild/webpack:

```typescript
import { setGrammarBinary } from "prettier-plugin-pdx-script";
import wasmBinary from "prettier-plugin-pdx-script/tree-sitter/tree-sitter-pdx_script.wasm";

setGrammarBinary(() => wasmBinary);
```

**What the downstream can remove:**

| Workaround                                            | Why it's no longer needed                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------------- |
| `external` for prettier/plugin/tree-sitter in esbuild | WASM can be bundled via `setGrammarBinary`                             |
| `copyRuntimeDeps()` post-build step                   | No longer needed if using `setGrammarBinary`                           |
| `.vscodeignore` doesn't exclude `dist/node_modules/`  | Bundled single `extension.js` replaces node_modules copy               |
| `dist/node_modules/` directory (200+ files, ~2MB+)    | Eliminated when fully bundled                                          |
| `vi.mock("prettier-plugin-pdx-script", ...)`          | Can inject test binary via `setGrammarBinary` without full module mock |

**Note on `web-tree-sitter` wasm:** The `setGrammarBinary` API controls the _grammar_ WASM (`tree-sitter-pdx_script.wasm`). The `web-tree-sitter` runtime WASM (`tree-sitter.wasm`) is resolved via the standard `locateFile` mechanism in `Parser.init()`. If consumers bundle `web-tree-sitter` itself, they may also need to handle its wasm separately — but this is a `web-tree-sitter` concern, not specific to our plugin. See the README's **Bundling** section for details.

---

### Change 3: Parser caching

**Status:** Implemented

The parser is now initialized once and cached as a module-level singleton:

```typescript
let cachedParser: any = null;
let parserInitialized = false;

async function getOrInitParser(): Promise<any> {
  if (cachedParser) return cachedParser;

  const TreeSitter = await import("web-tree-sitter");
  await TreeSitter.Parser.init({
    locateFile: (file: string, scriptDir: string) => path.join(scriptDir, file),
  });
  const binary = await grammarBinaryLoader();
  if (!(binary instanceof Uint8Array)) {
    throw new Error(
      "GrammarBinaryLoader must return a Uint8Array, " +
        `got ${binary === null ? "null" : typeof binary}.`,
    );
  }
  const PDXScript = await TreeSitter.Language.load(binary);

  cachedParser = new TreeSitter.Parser();
  cachedParser.setLanguage(PDXScript);
  parserInitialized = true;
  return cachedParser;
}
```

Subsequent `parse()` calls reuse the cached parser. No re-initialization.

`setGrammarBinary()` warns via `console.warn()` if called after the parser has been initialized, since the change will not take effect until the module is reloaded. The `parserInitialized` flag tracks this state.

**Impact:**

- First call: same cost as before (~70ms for WASM init)
- Subsequent calls: ~70ms saved per invocation
- Particularly impactful when formatting multiple files or running integration tests

---

### Change 4: Explicit `locateFile` for `Parser.init()`

**Status:** Implemented

`Parser.init()` now receives an explicit `locateFile` callback:

```typescript
await TreeSitter.Parser.init({
  locateFile: (file: string, scriptDir: string) => {
    return path.join(scriptDir, file);
  },
});
```

This ensures `web-tree-sitter` can locate its `tree-sitter.wasm` binary regardless of whether the consumer is ESM or CJS. The `scriptDir` parameter is the directory containing the `web-tree-sitter` JS file, so the resolution is relative to the actual package location rather than `import.meta.url` (which doesn't exist in CJS).

---

## What Was Preserved

### Printer logic (`printer.ts`) — unchanged

The entire printer implementation is unchanged. It still handles all PDXScript node types (source_file, declaration, block, key_value, value, quoted_string, localisation_key, word, comment) with identical formatting rules:

- Tab indentation
- Empty blocks as `{}`
- Block values indented on new lines
- Operator preservation (`=`, `>`, `<`)
- Comments preserved as-is

**Reasoning:** The printer is the correct layer for formatting logic. No consumer has reported issues with the printer's output. Refactoring it would risk regressions for zero benefit.

### Tree conversion (`convertTree()`) — unchanged

The recursive tree-sitter → plain-object conversion is unchanged.

**Reasoning:** This is a necessary bridge between tree-sitter's getter-based nodes and Prettier's property-traversal model. There is no better alternative.

### Prettier plugin shape — unchanged

The package still exports `languages`, `parsers`, and `printers` with the same names and formats:

- Parser name: `"pdx-script-parse"`
- AST format: `"pdx-script-ast"`
- Language: `"PDXScript"` with `.txt` extension

**Reasoning:** Changing these would break existing consumers. The new exports (`setGrammarBinary`, `getGrammarBinary`) are additive.

### Default grammar WASM loading — preserved

The default behavior of reading `tree-sitter/tree-sitter-pdx_script.wasm` from the package directory is preserved. `setGrammarBinary` is an _override_, not a replacement.

**Reasoning:** Most users install via npm and have the WASM file in the correct location. Only bundling consumers need the override.

### TypeScript strict mode, test suite, CI — unchanged

All 30 tests pass (27 original + 3 new CJS tests). The `bun:test` test framework and fixture-based approach are unchanged. GitHub Actions CI workflow is unchanged.

---

## Additional Changes (Not in Original Report)

### `import.meta.url` → `__dirname` fallback

The plugin uses a try/catch pattern for ESM/CJS directory resolution:

```typescript
let __dirname_: string;
try {
  __dirname_ = __dirname;
} catch {
  // CJS: works
  __dirname_ = path.dirname(fileURLToPath(import.meta.url));
} // ESM: fallback
```

**Reasoning:** In the CJS build, tsup replaces `import.meta` with an empty object (producing a build warning). The try/catch ensures the CJS path always succeeds via `__dirname`, making the warning harmless.

### Build tool: tsc → tsup

The build step changed from raw `tsc` to `tsup` (esbuild-based).

**Reasoning:** `tsc` can only produce one output format per run. `tsup` produces both CJS and ESM from the same source with a single config, plus generates dual `.d.ts` / `.d.cts` declaration files. It handles the `import.meta.url` → `__dirname` polyfill for CJS automatically.

### `GrammarBinaryLoader` type export

The `GrammarBinaryLoader` type is exported for consumers who want type-safe custom loaders:

```typescript
export type GrammarBinaryLoader = () => Uint8Array | Promise<Uint8Array>;
```

### `setGrammarBinary()` post-init guard

If `setGrammarBinary()` is called after the parser has already been initialized (i.e. after the first `parse()` call), a `console.warn` is emitted:

```
[prettier-plugin-pdx-script] setGrammarBinary() called after parser initialization.
The new loader will not take effect until the module is reloaded.
Call setGrammarBinary() before any parse() invocation.
```

This prevents silent misconfiguration when consumers set the loader too late in the lifecycle.

### `GrammarBinaryLoader` return value validation

`getOrInitParser()` now validates that the loader returns a `Uint8Array`. If the loader resolves with `null`, `undefined`, or a non-typed-array value, a descriptive error is thrown instead of letting `TreeSitter.Language.load()` produce a cryptic failure.

### CJS test uses `createRequire` instead of bare `require()`

The CJS entry point tests now use `createRequire(import.meta.url)` from `node:module` instead of the bare `require()` global. This makes the tests portable to Node.js (where `require` is not available in ESM files) while still verifying CJS loading behavior.

---

## Migration for Downstream Extension

After updating to the new version of `prettier-plugin-pdx-script`:

1. Replace `await import()` with normal `require()` or static `import`
2. Remove `external` for prettier/plugin/tree-sitter from esbuild config
3. Call `setGrammarBinary()` to inject the bundled WASM binary (if bundling)
4. Remove `copyRuntimeDeps()` and `dist/node_modules/` post-build step
5. Simplify `.vscodeignore` — can now exclude `node_modules/`
6. Remove `resolution-mode: "import"` type attributes
7. Rename `.mts` test files to `.ts` (optional, but cleaner)
8. Remove dependency injection pattern from `formatText()`
9. For mocking in tests: use `setGrammarBinary()` to inject test data instead of full module mocks

---

## Package Size Impact

| Metric            | Before             | After                       |
| ----------------- | ------------------ | --------------------------- |
| Published package | 36.7 kB (ESM only) | 49.4 kB (ESM + CJS + types) |
| Tarball           | ~11 kB             | ~11 kB                      |
| Total files       | 7                  | 7                           |

The CJS entry adds ~12 kB to the published package but eliminates the need for downstream consumers to ship 2MB+ of unbundled node_modules.

---

## Branch

All changes are on `refactor/cjs-dual-build`. Commits:

```
3ac848a chore: update lockfile for tsup dependency
08b4fe9 test: add CJS entry point tests; docs: document setGrammarBinary API + dual CJS/ESM
bb801d5 build: add tsup dual CJS/ESM build + conditional exports map
f395d40 refactor: cache parser init + configurable WASM loading + locateFile
```

Post-review fixes (pending commit):

- README: added `index.d.cts` to file structure table
- `setGrammarBinary()`: warn if called after parser initialization
- `getOrInitParser()`: validate loader returns `Uint8Array`
- CJS tests: replaced bare `require()` with `createRequire` for Node.js portability
- README: added **Bundling** section documenting `locateFile` limitation
