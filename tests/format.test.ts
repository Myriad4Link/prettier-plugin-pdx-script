/**
 * @module format.test
 *
 * Fixture-based visual tests for the PDXScript Prettier formatter.
 *
 * Each test reads an `input.txt` and `expected.txt` from the `__fixtures__`
 * directory, formats the input through Prettier with our plugin, and asserts
 * the output matches the expected file exactly.
 *
 * ## Adding new fixtures
 *
 * 1. Create a new subdirectory under `tests/__fixtures__/` (e.g., `my_feature/`)
 * 2. Add `input.txt` with the unformatted PDXScript
 * 3. Add `expected.txt` with the expected formatted output
 * 4. The test runner auto-discovers all fixture directories and runs them
 *
 * ## Naming convention
 *
 * Fixture directories become the test suite name (e.g., `basic` → "basic").
 * Files named `input.txt` / `expected.txt` without a prefix are the default pair.
 * Multiple pairs per directory use the prefix convention: `<name>_input.txt` /
 * `<name>_expected.txt` (e.g., `empty_block_input.txt`).
 */

import * as fs from "node:fs";
import * as path from "node:path";
// createRequire lets us simulate CJS require() from this ESM test file.
// Bare require() is not available in ESM under Node.js (only Bun polyfills it).
import { createRequire } from "node:module";
import { describe, test, expect, vi } from "vitest";
import * as prettier from "prettier";
import * as plugin from "../index.ts";
import type { GrammarBinaryLoader, LocateFileFn } from "../index.ts";

/** Directory containing all fixture subdirectories. */
const FIXTURES_DIR = path.join(import.meta.dirname!, "__fixtures__");

/**
 * Format PDXScript source text using our Prettier plugin.
 *
 * @param input - Raw PDXScript source
 * @returns Formatted PDXScript source
 */
async function format(input: string): Promise<string> {
  return prettier.format(input, {
    parser: "pdx-script-parse",
    plugins: [plugin as any],
    useTabs: true,
  });
}

/**
 * Discover all fixture directories under __fixtures__.
 *
 * Returns an array of { suiteName, fixtures } where each fixture has
 * { name, inputPath, expectedPath }.
 */
function discoverFixtures(): Array<{
  suiteName: string;
  fixtures: Array<{ name: string; inputPath: string; expectedPath: string }>;
}> {
  if (!fs.existsSync(FIXTURES_DIR)) {
    return [];
  }

  const suites: Array<{
    suiteName: string;
    fixtures: Array<{ name: string; inputPath: string; expectedPath: string }>;
  }> = [];

  for (const entry of fs.readdirSync(FIXTURES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const suiteDir = path.join(FIXTURES_DIR, entry.name);
    const files = fs.readdirSync(suiteDir);

    const fixtures: Array<{
      name: string;
      inputPath: string;
      expectedPath: string;
    }> = [];

    // Collect all _input.txt files
    const inputFiles = files.filter((f) => f.endsWith("_input.txt"));

    for (const inputFile of inputFiles) {
      const baseName = inputFile.replace(/_input\.txt$/, "");
      const expectedFile = `${baseName}_expected.txt`;

      if (files.includes(expectedFile)) {
        fixtures.push({
          name: baseName.replace(/_/g, " "),
          inputPath: path.join(suiteDir, inputFile),
          expectedPath: path.join(suiteDir, expectedFile),
        });
      }
    }

    // Also check for default input.txt / expected.txt pair
    if (files.includes("input.txt") && files.includes("expected.txt")) {
      fixtures.push({
        name: "default",
        inputPath: path.join(suiteDir, "input.txt"),
        expectedPath: path.join(suiteDir, "expected.txt"),
      });
    }

    if (fixtures.length > 0) {
      suites.push({ suiteName: entry.name, fixtures });
    }
  }

  return suites;
}

// ---------------------------------------------------------------------------
// Idempotency tests
// ---------------------------------------------------------------------------

/**
 * Idempotency: formatting the same input twice should produce identical output.
 * This is a fundamental property of a well-behaved formatter.
 */
describe("idempotency", () => {
  test("formatting twice produces the same result", async () => {
    const input = `my_decl = {
key = value
}`;
    const result1 = await format(input);
    const result2 = await format(result1);
    expect(result1).toBe(result2);
  });

  test("already-formatted input is preserved", async () => {
    const input = `my_decl = {
	key = value
}
`;
    const result = await format(input);
    expect(result).toBe(input);
  });

  test("empty block idempotency", async () => {
    const input = `empty_decl = {}`;
    const result1 = await format(input);
    const result2 = await format(result1);
    expect(result1).toBe(result2);
  });
});

// ---------------------------------------------------------------------------
// Fixture-based visual tests
// ---------------------------------------------------------------------------

/**
 * Auto-discovered fixture tests.
 *
 * Each fixture directory becomes a describe block. Each input/expected pair
 * becomes a test case. The test formats the input and asserts it matches
 * the expected output exactly.
 */
describe("formatter fixtures", () => {
  const suites = discoverFixtures();

  for (const { suiteName, fixtures } of suites) {
    describe(suiteName, () => {
      for (const { name, inputPath, expectedPath } of fixtures) {
        test(name, async () => {
          const input = fs.readFileSync(inputPath, "utf-8");
          const expected = fs.readFileSync(expectedPath, "utf-8");

          const result = await format(input);

          expect(result).toBe(expected);
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// New exports tests (issues #3, #4, #5)
// ---------------------------------------------------------------------------

describe("PARSER_NAME", () => {
  test("exports the correct parser name", () => {
    expect(plugin.PARSER_NAME).toBe("pdx-script-parse");
  });

  test("PARSER_NAME matches the parsers key", () => {
    expect(plugin.parsers).toHaveProperty(plugin.PARSER_NAME);
  });

  test("PARSER_NAME matches the language parser", () => {
    expect(plugin.languages[0].parsers).toContain(plugin.PARSER_NAME);
  });
});

describe("getGrammarWasmPath", () => {
  test("returns a string path", () => {
    const wasmPath = plugin.getGrammarWasmPath();
    expect(typeof wasmPath).toBe("string");
    expect(wasmPath).toContain("tree-sitter-pdx_script.wasm");
  });

  test("path points to an existing file", () => {
    const wasmPath = plugin.getGrammarWasmPath();
    expect(fs.existsSync(wasmPath)).toBe(true);
  });
});

describe("resetParser", () => {
  test("allows re-initialization with new settings", async () => {
    // Parse once to initialize
    const input1 = "decl1 = { key = value }";
    const result1 = await format(input1);
    expect(result1).toContain("decl1");

    // Reset and verify parsing still works
    plugin.resetParser();
    const input2 = "decl2 = { other = test }";
    const result2 = await format(input2);
    expect(result2).toContain("decl2");
  });

  test("does not throw when called before initialization", () => {
    plugin.resetParser();
    // Should not throw
  });
});

describe("disposeParser", () => {
  test("allows re-initialization after dispose", async () => {
    // Parse once to initialize
    const input1 = "decl1 = { key = value }";
    const result1 = await format(input1);
    expect(result1).toContain("decl1");

    // Dispose and verify parsing still works
    plugin.disposeParser();
    const input2 = "decl2 = { other = test }";
    const result2 = await format(input2);
    expect(result2).toContain("decl2");
  });

  test("does not throw when called before initialization", () => {
    plugin.disposeParser();
    // Should not throw
  });
});

// ---------------------------------------------------------------------------
// CJS entry point tests
// ---------------------------------------------------------------------------

/**
 * Verify the built CJS entry point loads correctly and exports the expected shape.
 *
 * These tests run against `dist/index.cjs` (the tsup-compiled CJS output).
 * They require `bun run build` to have been run first.
 */
describe("CJS entry point", () => {
  const distCjsPath = path.join(
    import.meta.dirname!,
    "..",
    "dist",
    "index.cjs",
  );
  // createRequire produces a require() function scoped to this module's URL.
  // This lets ESM test files load CJS modules portably (works in both Node.js and Bun).
  const cjsRequire = createRequire(import.meta.url);

  test("dist/index.cjs exists", () => {
    expect(fs.existsSync(distCjsPath)).toBe(true);
  });

  test("CJS require() loads and exports expected shape", () => {
    const cjsModule = cjsRequire(distCjsPath);

    expect(cjsModule).toHaveProperty("languages");
    expect(cjsModule).toHaveProperty("parsers");
    expect(cjsModule).toHaveProperty("printers");
    expect(cjsModule).toHaveProperty("setGrammarBinary");
    expect(cjsModule).toHaveProperty("getGrammarBinary");
    // locateFile overrides are also exported so bundled consumers can
    // control web-tree-sitter's runtime WASM resolution.
    expect(cjsModule).toHaveProperty("setLocateFile");
    expect(cjsModule).toHaveProperty("getLocateFile");
    // New exports from issues #3, #4, #5
    expect(cjsModule).toHaveProperty("PARSER_NAME");
    expect(cjsModule).toHaveProperty("getGrammarWasmPath");
    expect(cjsModule).toHaveProperty("resetParser");
    expect(cjsModule).toHaveProperty("disposeParser");

    expect(cjsModule.languages).toHaveLength(1);
    expect(cjsModule.languages[0].name).toBe("PDXScript");
    expect(cjsModule.parsers).toHaveProperty("pdx-script-parse");
    expect(cjsModule.printers).toHaveProperty("pdx-script-ast");
    expect(typeof cjsModule.setGrammarBinary).toBe("function");
    expect(typeof cjsModule.getGrammarBinary).toBe("function");
    expect(typeof cjsModule.setLocateFile).toBe("function");
    expect(typeof cjsModule.getLocateFile).toBe("function");
    expect(cjsModule.PARSER_NAME).toBe("pdx-script-parse");
    expect(typeof cjsModule.getGrammarWasmPath).toBe("function");
    expect(typeof cjsModule.resetParser).toBe("function");
    expect(typeof cjsModule.disposeParser).toBe("function");
  });

  test("CJS module formats PDXScript correctly", async () => {
    const cjsModule = cjsRequire(distCjsPath);
    const prettierMod = cjsRequire("prettier");

    const result = await prettierMod.format("my_decl={key=value}", {
      parser: "pdx-script-parse",
      plugins: [cjsModule],
      useTabs: true,
    });

    expect(result).toBe("my_decl = {\n\tkey = value\n}\n");
  });
});

// ---------------------------------------------------------------------------
// Regression: convertTree() OOM on large files (#8)
// ---------------------------------------------------------------------------
describe("regression: issue #8 – convertTree() OOM on large files", () => {
  const LARGE_FILE = path.join(FIXTURES_DIR, "MWD_decisions.txt");

  test("formats a 15KB+ PDXScript file without OOM", async () => {
    expect(fs.existsSync(LARGE_FILE)).toBe(true);
    const input = fs.readFileSync(LARGE_FILE, "utf-8");

    // Should complete in reasonable time/memory without crashing
    const result = await format(input);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Parser isolation — beforeEach reset
// ---------------------------------------------------------------------------

describe("parser isolation", () => {
  test("resetParser() clears parser state for test independence", () => {
    plugin.resetParser();
  });

  test("resetParser() allows fresh initialization on next format", async () => {
    plugin.resetParser();
    const result = await format("isolated_decl = { key = value }");
    expect(result).toContain("isolated_decl");
    plugin.resetParser();
  });
});

// ---------------------------------------------------------------------------
// Error-path tests
// ---------------------------------------------------------------------------

describe("error paths", () => {
  test("formats empty input without throwing", async () => {
    const result = await format("");
    expect(typeof result).toBe("string");
  });

  test("throws when GrammarBinaryLoader returns a non-Uint8Array", async () => {
    plugin.resetParser();
    plugin.setGrammarBinary(
      (() => "not-a-uint8array") as unknown as GrammarBinaryLoader,
    );
    await expect(format("test = { a = b }")).rejects.toThrow(
      "GrammarBinaryLoader must return a Uint8Array",
    );
    plugin.resetParser();
  });

  test("throws when GrammarBinaryLoader returns null", async () => {
    plugin.resetParser();
    plugin.setGrammarBinary((() => null) as unknown as GrammarBinaryLoader);
    await expect(format("test = { a = b }")).rejects.toThrow(
      "GrammarBinaryLoader must return a Uint8Array",
    );
    plugin.resetParser();
  });

  test("handles GrammarBinaryLoader returning a Promise<Uint8Array>", async () => {
    plugin.resetParser();
    const wasmBuffer = fs.readFileSync(plugin.getGrammarWasmPath());
    plugin.setGrammarBinary(() => Promise.resolve(new Uint8Array(wasmBuffer)));
    const result = await format("promise_decl = { key = value }");
    expect(result).toContain("promise_decl");
    plugin.resetParser();
  });
});

// ---------------------------------------------------------------------------
// Cursor position tests — locStart / locEnd
// ---------------------------------------------------------------------------

describe("cursor position", () => {
  test("preserves cursor position through formatting", async () => {
    const input = "decl = { key = value }";
    const result = await prettier.formatWithCursor(input, {
      parser: "pdx-script-parse",
      plugins: [plugin as any],
      useTabs: true,
      cursorOffset: 0,
    });
    expect(typeof result.formatted).toBe("string");
    expect(result.cursorOffset).toBeTypeOf("number");
    expect(result.cursorOffset).toBeGreaterThanOrEqual(0);
  });

  test("cursor offset is valid within formatted output", async () => {
    const input = "decl = { key = value }";
    const cursorPos = 8;
    const result = await prettier.formatWithCursor(input, {
      parser: "pdx-script-parse",
      plugins: [plugin as any],
      cursorOffset: cursorPos,
      useTabs: true,
    });
    expect(result.cursorOffset).toBeLessThanOrEqual(result.formatted.length);
  });
});

// ---------------------------------------------------------------------------
// Plugin option tests
// ---------------------------------------------------------------------------

describe("plugin options", () => {
  test("useTabs: false produces space-indented output", async () => {
    const input = "decl = { key = value }";
    const result = await prettier.format(input, {
      parser: "pdx-script-parse",
      plugins: [plugin as any],
      useTabs: false,
    });
    expect(result).not.toContain("\t");
    expect(result).toContain("  key = value");
  });

  test("useTabs: true produces tab-indented output", async () => {
    const input = "decl = { key = value }";
    const result = await prettier.format(input, {
      parser: "pdx-script-parse",
      plugins: [plugin as any],
      useTabs: true,
    });
    expect(result).toContain("\tkey = value");
  });

  test("default option (no useTabs) produces space-indented output", async () => {
    plugin.resetParser();
    const input = "decl = { key = value }";
    const result = await prettier.format(input, {
      parser: "pdx-script-parse",
      plugins: [plugin as any],
    });
    expect(result).toContain("  key = value");
    plugin.resetParser();
  });
});

// ---------------------------------------------------------------------------
// setGrammarBinary / setLocateFile warning branches
// ---------------------------------------------------------------------------

describe("configuration warning branches", () => {
  test("setGrammarBinary() warns when called after parser initialization", async () => {
    plugin.resetParser();
    await format("warmup = { key = value }");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    plugin.setGrammarBinary(() => new Uint8Array());
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "setGrammarBinary() called after parser initialization",
      ),
    );
    warnSpy.mockRestore();
    plugin.setGrammarBinary(() => fs.readFileSync(plugin.getGrammarWasmPath()));
    plugin.resetParser();
  });

  test("setLocateFile() warns when called after parser initialization", async () => {
    plugin.disposeParser();
    await format("warmup2 = { key = value }");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    plugin.setLocateFile(
      (fileName: string, scriptDir: string) => `${scriptDir}/${fileName}`,
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "setLocateFile() called after parser initialization",
      ),
    );
    warnSpy.mockRestore();
    plugin.resetParser();
  });

  test("setGrammarBinary() does not warn when called before initialization", () => {
    plugin.resetParser();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    plugin.setGrammarBinary(() => new Uint8Array());
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    plugin.setGrammarBinary(() => fs.readFileSync(plugin.getGrammarWasmPath()));
    plugin.resetParser();
  });

  test("setLocateFile() does not warn when called before initialization", () => {
    plugin.resetParser();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    plugin.setLocateFile(
      (fileName: string, scriptDir: string) => `${scriptDir}/${fileName}`,
    );
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    plugin.resetParser();
  });

  test("getLocateFile() returns the current locateFile function", () => {
    const fn = plugin.getLocateFile();
    expect(typeof fn).toBe("function");
  });

  test("getGrammarBinary() returns the current grammar binary loader", () => {
    const loader = plugin.getGrammarBinary();
    expect(typeof loader).toBe("function");
  });
});
