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
import { describe, test, expect } from "bun:test";
import * as prettier from "prettier";
import * as plugin from "../index.ts";

/** Directory containing all fixture subdirectories. */
const FIXTURES_DIR = path.join(import.meta.dir, "__fixtures__");

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
