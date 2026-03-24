/**
 * @module prettier-plugin-pdx-script
 *
 * Prettier plugin for formatting PDXScript (Paradox game script) files.
 *
 * This plugin uses a tree-sitter WASM parser to parse PDXScript source files
 * into an AST, which is then printed to Prettier Doc format by the printer.
 *
 * ## Architecture
 *
 * 1. **Language definition** - Tells Prettier that `.txt` files are PDXScript
 * 2. **Parser** - Loads tree-sitter, parses input text, converts tree-sitter nodes
 *    to plain objects (tree-sitter uses getters, not plain properties)
 * 3. **Printer** - Walks the plain-object AST and produces Prettier Doc output
 *
 * ## Configurable WASM loading
 *
 * By default the plugin reads the grammar WASM file from its package directory.
 * Consumers can override this via {@link setGrammarBinary} to supply the WASM
 * as a `Uint8Array` — for example when bundling or embedding the plugin.
 *
 * @see https://prettier.io/docs/en/plugins.html - Prettier plugin API
 */

import type { Parser, SupportLanguage } from "prettier";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { printers } from "./printer.js";

// ---------------------------------------------------------------------------
// ESM / CJS directory resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the directory of this module.
 *
 * In ESM, `import.meta.url` is available and `__dirname` is not.
 * In CJS (tsup-compiled), `__dirname` is available and works correctly.
 * We try `__dirname` first (CJS path), then fall back to `import.meta.url` (ESM).
 */
let __dirname_: string;
try {
  __dirname_ = __dirname;
} catch {
  __dirname_ = path.dirname(fileURLToPath(import.meta.url));
}

// ---------------------------------------------------------------------------
// Configurable grammar binary
// ---------------------------------------------------------------------------

/**
 * A function that returns the PDXScript grammar WASM binary.
 *
 * Can return a `Uint8Array` synchronously or a `Promise<Uint8Array>`.
 */
export type GrammarBinaryLoader = () => Uint8Array | Promise<Uint8Array>;

/**
 * Default grammar binary loader: reads the WASM file from the package's
 * `tree-sitter/` directory relative to this module.
 */
function defaultGrammarBinaryLoader(): Uint8Array {
  return readFileSync(
    path.join(__dirname_, "tree-sitter/tree-sitter-pdx_script.wasm"),
  );
}

/** Current grammar binary loader (overridden by {@link setGrammarBinary}). */
let grammarBinaryLoader: GrammarBinaryLoader = defaultGrammarBinaryLoader;

/**
 * Override the grammar WASM binary loader.
 *
 * Use this when bundling the plugin (e.g. in a VS Code extension) where the
 * WASM file cannot be loaded from the plugin's package directory.
 *
 * @example
 * ```ts
 * import { setGrammarBinary } from "prettier-plugin-pdx-script";
 * import wasmBinary from "prettier-plugin-pdx-script/tree-sitter/tree-sitter-pdx_script.wasm";
 *
 * setGrammarBinary(() => wasmBinary);
 * ```
 *
 * @param loader - A function returning the grammar WASM as `Uint8Array`
 */
export function setGrammarBinary(loader: GrammarBinaryLoader): void {
  grammarBinaryLoader = loader;
}

/**
 * Get the current grammar binary loader.
 *
 * Returns the function that will be called to obtain the PDXScript grammar
 * WASM binary. Useful for testing or wrapping the default loader.
 */
export function getGrammarBinary(): GrammarBinaryLoader {
  return grammarBinaryLoader;
}

// ---------------------------------------------------------------------------
// Language definition
// ---------------------------------------------------------------------------

/**
 * PDXScript language registration for Prettier.
 *
 * Associates the `pdx-script-parse` parser with `.txt` files.
 * Paradox game scripts (e.g. Victoria 3, HOI4) use `.txt` as their
 * primary file extension.
 */
export const languages: SupportLanguage[] = [
  {
    name: "PDXScript",
    parsers: ["pdx-script-parse"],
    extensions: [".txt"],
  },
];

// ---------------------------------------------------------------------------
// Tree conversion
// ---------------------------------------------------------------------------

/**
 * Recursively converts a tree-sitter SyntaxNode into a plain JavaScript object.
 *
 * Tree-sitter nodes use JavaScript getters (e.g. `node.children` is a computed
 * property, not a stored array). Prettier's `path.map` and `path.call` traverse
 * node properties directly, so they cannot see tree-sitter getter-based children.
 * By converting to plain objects first, Prettier's path system can navigate the
 * tree normally.
 *
 * @param node - A tree-sitter SyntaxNode (or child node from `node.children`)
 * @returns A plain object with the following shape:
 *   - `type`: Node type string (e.g. "source_file", "declaration", "key_value")
 *   - `text`: The source text span this node covers
 *   - `startIndex`: Byte offset of the start of this node in the source
 *   - `endIndex`: Byte offset of the end of this node in the source
 *   - `isNamed`: Whether this is a named rule in the grammar (vs an anonymous token)
 *   - `children`: All child nodes (named and anonymous), converted recursively
 *   - `namedChildren`: Only the named child nodes, converted recursively
 */
function convertTree(node: any): any {
  return {
    type: node.type,
    text: node.text,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    isNamed: node.isNamed,
    children: node.children.map(convertTree),
    namedChildren: node.namedChildren.map(convertTree),
  };
}

// ---------------------------------------------------------------------------
// Cached parser singleton
// ---------------------------------------------------------------------------

/** Cached tree-sitter parser instance (initialized lazily, once). */
let cachedParser: any = null;

/**
 * Lazily initialize and return the tree-sitter parser singleton.
 *
 * On first call:
 * 1. Imports `web-tree-sitter`
 * 2. Calls `Parser.init()` with an explicit `locateFile` for CJS compatibility
 * 3. Loads the PDXScript grammar WASM (via the configured loader)
 * 4. Creates and caches a `Parser` instance with the grammar set
 *
 * On subsequent calls, returns the cached parser immediately.
 *
 * @returns A tree-sitter `Parser` instance configured for PDXScript
 */
async function getOrInitParser(): Promise<any> {
  if (cachedParser) return cachedParser;

  const TreeSitter = await import("web-tree-sitter");

  // Initialize the WASM runtime with an explicit locateFile callback.
  // This ensures CJS consumers (where import.meta.url is not available)
  // can still locate web-tree-sitter's own wasm binary.
  await TreeSitter.Parser.init({
    locateFile: (file: string, scriptDir: string) => {
      // scriptDir is the directory containing web-tree-sitter.js.
      // We resolve the wasm file relative to it.
      return path.join(scriptDir, file);
    },
  });

  // Load the PDXScript grammar via the configurable loader
  const binary = await grammarBinaryLoader();
  const PDXScript = await TreeSitter.Language.load(binary);

  cachedParser = new TreeSitter.Parser();
  cachedParser.setLanguage(PDXScript);

  return cachedParser;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Prettier parsers for PDXScript.
 *
 * Contains a single parser `"pdx-script-parse"` that:
 * 1. Lazily initializes the tree-sitter WASM runtime (cached after first call)
 * 2. Loads the compiled PDXScript grammar from the WASM file
 * 3. Parses the input text into a tree-sitter AST
 * 4. Converts the tree-sitter AST to plain objects (see `convertTree`)
 *
 * The parser is initialized once and cached for the lifetime of the module.
 * Subsequent `parse()` calls reuse the cached parser, avoiding the ~70ms
 * re-initialization cost.
 */
export const parsers: Record<string, Parser> = {
  "pdx-script-parse": {
    /**
     * Parse PDXScript source text into a plain-object AST.
     *
     * Uses the cached parser singleton (see {@link getOrInitParser}).
     *
     * @param text - Raw PDXScript source code
     * @returns A plain-object representation of the parse tree root node
     */
    parse: async (text) => {
      const parser = await getOrInitParser();
      const tree = parser.parse(text);
      if (!tree) throw new Error("Failed to parse PDXScript input");
      return convertTree(tree.rootNode);
    },

    /** The AST format name that Prettier uses to select the matching printer. */
    astFormat: "pdx-script-ast",

    /** Get the start byte offset of a node (used for cursor positioning). */
    locStart: (node) => node.startIndex,

    /** Get the end byte offset of a node (used for cursor positioning). */
    locEnd: (node) => node.endIndex,
  },
};

// ---------------------------------------------------------------------------
// Printer (re-exported from printer.ts)
// ---------------------------------------------------------------------------

/**
 * Re-export the PDXScript printer from printer.ts.
 *
 * The printer walks the plain-object AST produced by the parser and generates
 * Prettier Doc output. See `printer.ts` for formatting rules and implementation.
 */
export { printers };
