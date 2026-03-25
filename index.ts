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
 * The `locateFile` callback used to find web-tree-sitter's own runtime WASM
 * can also be overridden via {@link setLocateFile}.
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
 * Resolve the absolute path to the PDXScript grammar WASM file.
 *
 * Returns the path relative to this module's directory, which is captured at
 * load time (before bundlers can rewrite `__dirname`). This works reliably
 * across CJS/ESM and bundled/unbundled environments.
 *
 * Consumers can use this to obtain the WASM path for custom loading scenarios
 * without needing to parse `package.json` exports themselves.
 */
export function getGrammarWasmPath(): string {
  return path.join(__dirname_, "tree-sitter/tree-sitter-pdx_script.wasm");
}

/**
 * Default grammar binary loader: reads the WASM file from the package's
 * `tree-sitter/` directory relative to this module.
 */
function defaultGrammarBinaryLoader(): Uint8Array {
  return readFileSync(getGrammarWasmPath());
}

/** Current grammar binary loader (overridden by {@link setGrammarBinary}). */
let grammarBinaryLoader: GrammarBinaryLoader = defaultGrammarBinaryLoader;

/**
 * Override the grammar WASM binary loader.
 *
 * Use this when bundling the plugin (e.g. in a VS Code extension) where the
 * WASM file cannot be loaded from the plugin's package directory.
 *
 * **Must be called before any `parse()` invocation.** If called after the
 * parser has been initialized, a warning is logged and the new loader will
 * not take effect until the module is reloaded (because the parser singleton
 * is already cached with the previous loader's result).
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
  if (parserInitialized) {
    console.warn(
      "[prettier-plugin-pdx-script] setGrammarBinary() called after parser initialization. " +
        "The new loader will not take effect until the module is reloaded. " +
        "Call setGrammarBinary() before any parse() invocation.",
    );
  }
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
// Configurable locateFile
// ---------------------------------------------------------------------------
// Intent: web-tree-sitter's Parser.init() accepts a locateFile callback to
// resolve its own runtime WASM (tree-sitter.wasm). The default behavior
// (resolve relative to scriptDir) breaks in bundled environments where the
// script directory doesn't contain the WASM file. By exposing this as a
// configurable hook, downstream consumers (e.g. VS Code extensions) can
// resolve the runtime WASM from their own bundled assets without hacky
// workarounds.

/**
 * A callback to resolve file paths relative to web-tree-sitter's script directory.
 *
 * Passed to `web-tree-sitter`'s `Parser.init({ locateFile })` to locate the
 * tree-sitter runtime WASM (`tree-sitter.wasm`).
 *
 * @param fileName  - The file name to resolve (e.g. `"tree-sitter.wasm"`)
 * @param scriptDir - The directory containing the web-tree-sitter JS file
 * @returns The resolved path to the file
 */
export type LocateFileFn = (fileName: string, scriptDir: string) => string;

/**
 * Default locateFile: resolves the file relative to the script directory.
 *
 * This mirrors web-tree-sitter's own default behavior. It works when the
 * plugin is installed normally (node_modules), but may fail when bundled
 * because scriptDir may not point to the correct location.
 */
function defaultLocateFile(fileName: string, scriptDir: string): string {
  return path.join(scriptDir, fileName);
}

/** Current locateFile function (overridden by {@link setLocateFile}). */
let locateFileFn: LocateFileFn = defaultLocateFile;

/**
 * Override the `locateFile` callback used to locate web-tree-sitter's runtime WASM.
 *
 * When this plugin is bundled (e.g. in a VS Code extension), the default
 * `locateFile` may resolve `tree-sitter.wasm` to the wrong directory.
 * Use this function to provide a custom resolver.
 *
 * **Must be called before any `parse()` invocation.** If called after the
 * parser has been initialized, a warning is logged and the new callback will
 * not take effect until the module is reloaded.
 *
 * @example
 * ```ts
 * import { setLocateFile } from "prettier-plugin-pdx-script";
 *
 * setLocateFile((fileName, _scriptDir) => {
 *   return path.join(__dirname, "wasm", fileName);
 * });
 * ```
 *
 * @param fn - A function that resolves `(fileName, scriptDir) → absolute path`
 */
export function setLocateFile(fn: LocateFileFn): void {
  if (parserInitialized) {
    console.warn(
      "[prettier-plugin-pdx-script] setLocateFile() called after parser initialization. " +
        "The new callback will not take effect until the module is reloaded. " +
        "Call setLocateFile() before any parse() invocation.",
    );
  }
  locateFileFn = fn;
}

/**
 * Get the current `locateFile` callback.
 *
 * Returns the function used by `web-tree-sitter` to locate its runtime WASM.
 * Useful for testing or wrapping the default resolver.
 */
export function getLocateFile(): LocateFileFn {
  return locateFileFn;
}

// ---------------------------------------------------------------------------
// Parser name
// ---------------------------------------------------------------------------

/**
 * The parser name registered by this plugin.
 *
 * Exported so consumers can reference the parser without a fragile magic string.
 *
 * @example
 * ```ts
 * import { PARSER_NAME } from "prettier-plugin-pdx-script";
 * prettier.format(text, { parser: PARSER_NAME, plugins: [plugin] });
 * ```
 */
export const PARSER_NAME = "pdx-script-parse";

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
    parsers: [PARSER_NAME],
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
  const converted = node.children.map(convertTree);
  return {
    type: node.type,
    text: node.text,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    isNamed: node.isNamed,
    children: converted,
    namedChildren: converted.filter((n: any) => n.isNamed),
  };
}

// ---------------------------------------------------------------------------
// Cached parser singleton
// ---------------------------------------------------------------------------

/** Cached tree-sitter parser instance (initialized lazily, once). */
let cachedParser: any = null;

/**
 * Whether the tree-sitter parser has been initialized.
 *
 * Used by {@link setGrammarBinary} and {@link setLocateFile} to warn if
 * configuration is changed after init — the cached parser would still use
 * the old settings, causing silent misconfiguration for bundling consumers
 * who call setGrammarBinary() / setLocateFile() too late in the lifecycle.
 */
let parserInitialized = false;

/**
 * Reset the cached tree-sitter parser singleton.
 *
 * Clears the cached parser and resets the initialization flag so the next
 * `parse()` call will re-initialize with the current `grammarBinaryLoader`
 * and `locateFileFn` settings.
 *
 * Useful for test isolation (call in `beforeEach`) or recovering from a
 * bad `setGrammarBinary()` call without reloading the module.
 */
export function resetParser(): void {
  cachedParser = null;
  parserInitialized = false;
}

/**
 * Dispose of the cached tree-sitter parser and free its resources.
 *
 * Calls `parser.delete()` for proper tree-sitter WASM resource cleanup,
 * then clears the singleton. The next `parse()` call will re-initialize.
 *
 * Use this instead of `resetParser()` when you want to ensure tree-sitter's
 * internal WASM memory is released (e.g. in long-running processes).
 */
export function disposeParser(): void {
  if (cachedParser) {
    cachedParser.delete();
    cachedParser = null;
  }
  parserInitialized = false;
}

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

  // Initialize the WASM runtime with the configurable locateFile callback.
  // Intent: web-tree-sitter requires a locateFile callback to find its own
  // runtime WASM (tree-sitter.wasm). The default resolves relative to scriptDir,
  // which works for unbundled use. When bundled (e.g. by a VS Code extension's
  // webpack/esbuild build), scriptDir may point to the bundle output — not the
  // web-tree-sitter package. Letting consumers override locateFile via
  // setLocateFile() eliminates the need for downstream workarounds like
  // manual script injection or dynamic require hacks.
  await TreeSitter.Parser.init({
    locateFile: locateFileFn,
  });

  // Load the PDXScript grammar via the configurable loader.
  // Validate the return type up front: if the loader returns null/undefined
  // (e.g. misconfigured bundler injection), TreeSitter.Language.load() would
  // throw a cryptic WASM error. A clear message here saves debugging time.
  const binary = await grammarBinaryLoader();
  if (!(binary instanceof Uint8Array)) {
    throw new Error(
      "[prettier-plugin-pdx-script] GrammarBinaryLoader must return a Uint8Array, " +
        `got ${binary === null ? "null" : typeof binary}. ` +
        "Check your setGrammarBinary() callback.",
    );
  }
  const PDXScript = await TreeSitter.Language.load(binary);

  cachedParser = new TreeSitter.Parser();
  cachedParser.setLanguage(PDXScript);
  parserInitialized = true;

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
  [PARSER_NAME]: {
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
