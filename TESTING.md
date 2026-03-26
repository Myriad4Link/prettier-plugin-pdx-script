# Testing Strategy

This document outlines the testing architecture, conventions, and planned improvements
for `prettier-plugin-pdx-script`.

## Current State

- **Runner:** Vitest (migrated from `bun:test` for portability)
- **Coverage:** v8 provider via Vitest, enforced at 70% on branches, functions, lines, statements
- **Test file:** `tests/format.test.ts` — 58 tests covering formatting, exports, idempotency, regression, error paths, cursor position, plugin options, parser isolation, and configuration warnings
- **Fixtures:** `tests/__fixtures__/` — 25 input/expected pairs across 7 suites auto-discovered by test runner
- **Test categories:**
  - Idempotency (3 tests)
  - Fixture-based formatting (25 tests, auto-discovered)
  - API shape — PARSER_NAME, getGrammarWasmPath, resetParser, disposeParser (9 tests)
  - CJS entry point (3 tests)
  - Regression — issue #8 OOM on large files (1 test)
  - Parser isolation (2 tests)
  - Error paths (4 tests)
  - Cursor position (2 tests)
  - Plugin options — useTabs (3 tests)
  - Configuration warnings — setGrammarBinary/setLocateFile (6 tests)

## Test Categories

### Fixture-Based Formatting Tests

Each subdirectory under `tests/__fixtures__/` represents a test suite. Each
`<name>_input.txt` / `<name>_expected.txt` pair becomes a test case. The test
formats the input through Prettier with the plugin and asserts exact output
match. Adding a fixture = adding a test. No code changes needed.

### Idempotency Tests

Fundamental property of a well-behaved formatter: formatting twice produces the
same result. Tested explicitly for basic, already-formatted, and empty inputs.

### API Shape Tests

Verify the module exports the correct surface area:
`PARSER_NAME`, `getGrammarWasmPath`, `resetParser`, `disposeParser`,
`setGrammarBinary`, `setLocateFile`, etc.

### CJS Entry Point Tests

Load `dist/index.cjs` and validate the export shape matches the ESM API.
Requires `bun run build` to have been run first.

### Regression Tests

Targeted tests for resolved bugs (e.g. issue #8 — OOM on large files).

### Error-Path Tests

Assert graceful failure for empty input, `GrammarBinaryLoader` returning wrong
type or null, and async loaders returning `Promise<Uint8Array>`.

### Cursor Position Tests

Verify `prettier.formatWithCursor()` works — cursor offset is preserved and
valid within formatted output.

### Plugin Option Tests

Verify `useTabs: false` (spaces), `useTabs: true` (tabs), and default (no
option) produce correct indentation.

### Parser Isolation Tests

Verify `resetParser()` clears parser state so tests remain independent.

### Configuration Warning Tests

Verify `setGrammarBinary()` and `setLocateFile()` warn when called after parser
initialization, and do not warn when called before. Also test `getGrammarBinary()`
and `getLocateFile()` return current values.

## Coverage

### Running

```sh
bun run test:coverage
```

### Enforcement

Coverage thresholds are enforced in CI. The current floor:

| Metric     | Threshold |
| ---------- | --------- |
| Branches   | 70%       |
| Functions  | 70%       |
| Lines      | 70%       |
| Statements | 70%       |

### Reports

- Text summary printed to terminal on every test run
- HTML report generated in `coverage/` when running locally

## Completed Improvements

### Parser Singleton Isolation

Added `beforeEach(() => resetParser())` in isolation-focused tests to ensure
tests are fully independent and parser state cannot leak between test cases.

### Error-Path Tests

Covered:

- Empty input (`""`)
- `GrammarBinaryLoader` returning wrong type (string)
- `GrammarBinaryLoader` returning null
- Async loader returning `Promise<Uint8Array>`

### Cursor Position Tests

Verified `prettier.formatWithCursor()` — cursor offset is preserved and within
valid bounds of the formatted string.

### Plugin Option Tests

Tested `useTabs: false` (spaces), `useTabs: true` (tabs), and default behavior.

### Configuration Warning Branches

Tested `setGrammarBinary()` and `setLocateFile()` warn after init, don't warn
before init, and `getGrammarBinary()` / `getLocateFile()` return current values.

### Coverage Gap Closure

Achieved ~93% statements, ~81% branches, 100% functions, ~93% lines — all well
above 70% thresholds. Key change: simplified the `value` case in `printer.ts`
to delegate to `path.map(print, "children")` instead of gating on block type,
which unblocked coverage of `quoted_string`, `localisation_key`, and `word`
child cases.

## Planned Improvements

### P2 — Medium Priority

#### 1. CI Coverage Integration

- Upload coverage reports as CI artifacts
- Fail CI if coverage drops below threshold
- Optional: integrate with Codecov or similar for trend tracking

#### 2. `printWidth` / Line-Breaking Tests

Prettier's core feature. Add fixtures that test behavior when key-value pairs
exceed the default `printWidth` of 80.

### P3 — Low Priority

#### 3. Mutation Testing

`stryker` could validate that tests catch real behavior changes. Deferred due
to overhead relative to project size.

#### 4. Performance Benchmarks

The OOM regression test is a coarse performance guard. Formal benchmarks
(`bun:test --benchmark` or `tinybench`) would help catch regressions in
parser init time or formatting speed. Deferred until performance is a
concern.

#### 5. Fuzz / Property-Based Testing

Generate random PDXScript-like input, verify:

- Formatter never throws
- Output is valid (can be parsed again)
- Idempotency holds for all generated inputs

Deferred — tree-sitter handles parsing robustness, and the fixture suite
already covers the printer well.

## Conventions

- **No comments in test code** unless necessary for fixture documentation
- **Fixture directories** use snake_case, grouped by semantic category
- **Test names** are descriptive one-liners
- **Imports** use framework-agnostic Vitest API (`describe`, `test`, `expect`)
- **Parser reset** via `beforeEach` where test isolation matters
