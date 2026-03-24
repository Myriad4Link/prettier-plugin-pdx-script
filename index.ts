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
 * @see https://prettier.io/docs/en/plugins.html - Prettier plugin API
 */

import type { Parser, SupportLanguage } from "prettier";
import * as path from "node:path";
import { printers } from "./printer.ts";

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
// Parser
// ---------------------------------------------------------------------------

/**
 * Prettier parsers for PDXScript.
 *
 * Contains a single parser `"pdx-script-parse"` that:
 * 1. Initializes the tree-sitter WASM runtime (lazy-loaded via `require`)
 * 2. Loads the compiled PDXScript grammar from the WASM file
 * 3. Parses the input text into a tree-sitter AST
 * 4. Converts the tree-sitter AST to plain objects (see `convertTree`)
 *
 * The parser is re-initialized on each `parse()` call. This is acceptable for
 * typical usage but could be optimized with caching if performance becomes a
 * concern (e.g. when formatting many files).
 */
export const parsers: Record<string, Parser> = {
  "pdx-script-parse": {
    /**
     * Parse PDXScript source text into a plain-object AST.
     *
     * @param text - Raw PDXScript source code
     * @returns A plain-object representation of the parse tree root node
     */
    parse: async (text) => {
      // Import web-tree-sitter. Note: require() returns the module namespace
      // object {Parser, Language, Tree, ...}, not the Parser class directly.
      // We use `TreeSitter` as the namespace variable name.
      const TreeSitter = require("web-tree-sitter");

      // Initialize the WASM runtime (must be called before using any API)
      await TreeSitter.Parser.init();

      // Load the pre-compiled PDXScript grammar from the bundled WASM file.
      // __dirname resolves to the plugin's install directory.
      const PDXScript = await TreeSitter.Language.load(
        path.join(__dirname, "tree-sitter/tree-sitter-pdx_script.wasm"),
      );

      // Create a parser instance and set it to use the PDXScript language
      const parser = new TreeSitter.Parser();
      parser.setLanguage(PDXScript);

      // Parse the source text into a tree-sitter Tree, then convert the
      // root node from tree-sitter's getter-based nodes to plain objects.
      const tree = parser.parse(text);
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
