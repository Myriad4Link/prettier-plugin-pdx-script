# Testing Strategy

This document outlines the testing architecture, conventions, and planned improvements
for `prettier-plugin-pdx-script`.

## Current State

- **Runner:** Vitest (migrated from `bun:test` for portability)
- **Coverage:** v8 provider via Vitest, enforced at 80% on branches, functions, lines, statements
- **Test file:** `tests/format.test.ts` — 40+ tests covering formatting, exports, idempotency, and regression
- **Fixtures:** `tests/__fixtures__/` — input/expected pairs auto-discovered by test runner

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

## Planned Improvements

### P1 — High Priority

#### 1. Error-Path Tests

Assert graceful failure for:

- Empty input (`""`)
- Null/undefined input
- Malformed PDXScript that tree-sitter cannot parse
- `GrammarBinaryLoader` returning wrong type (e.g. string instead of `Uint8Array`)
- `GrammarBinaryLoader` returning null/undefined

#### 2. Cursor Position Tests

Prettier plugins provide `locStart` / `locEnd` for cursor mapping. Test
`prettier.formatWithCursor()` to verify cursor position is preserved through
formatting.

#### 3. Plugin Option Tests

The plugin registers with Prettier's option system. Test behavior with:

- `useTabs: false` (spaces instead of tabs)
- Edge cases around option propagation from Prettier config

### P2 — Medium Priority

#### 4. Parser Singleton Isolation

Add `beforeEach(() => resetParser())` to ensure tests are fully independent
and parser state cannot leak between test cases.

#### 5. CI Coverage Integration

- Upload coverage reports as CI artifacts
- Fail CI if coverage drops below threshold
- Optional: integrate with Codecov or similar for trend tracking

#### 6. `printWidth` / Line-Breaking Tests

Prettier's core feature. Add fixtures that test behavior when key-value pairs
exceed the default `printWidth` of 80.

### P3 — Low Priority

#### 7. Mutation Testing

`stryker` could validate that tests catch real behavior changes. Deferred due
to overhead relative to project size.

#### 8. Performance Benchmarks

The OOM regression test is a coarse performance guard. Formal benchmarks
(`bun:test --benchmark` or `tinybench`) would help catch regressions in
parser init time or formatting speed. Deferred until performance is a
concern.

#### 9. Fuzz / Property-Based Testing

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
