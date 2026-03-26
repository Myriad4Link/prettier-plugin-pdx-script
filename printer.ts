/**
 * @module printer
 *
 * Prettier printer for the PDXScript AST.
 *
 * This module implements the `print` function that Prettier calls to convert
 * a parsed AST into Prettier Doc format (a tree of primitives, arrays, and
 * special builder objects like `hardline`, `indent`, and `join`).
 *
 * ## Formatting Rules
 *
 * - **Indentation**: Tab characters, one level per nesting depth
 * - **Declarations**: `name = {` on one line, contents indented, `}` on its own line
 * - **Empty blocks**: `name = {}` (single line)
 * - **Key-value pairs**: `key op value` on one line, where op is `=`, `>`, or `<`
 * - **Block values**: `key = {` on one line, contents indented, `}` on its own line
 * - **Comments**: Preserved as-is (prefixed with `#`)
 * - **Top-level**: Declarations separated by blank lines
 *
 * ## PDXScript AST Node Types
 *
 * The tree-sitter grammar defines these node types:
 *
 * | Node Type        | Named? | Description                              |
 * |------------------|--------|------------------------------------------|
 * | source_file      | Yes    | Root; contains declarations and comments |
 * | declaration      | Yes    | `name = block`                           |
 * | block            | Yes    | `{ key_value | comment }`               |
 * | key_value        | Yes    | `key (=|>|<) value`                     |
 * | value            | Yes    | One of: quoted_string, localisation_key, word, or block |
 * | quoted_string    | Yes    | `"..."` literal                         |
 * | localisation_key | Yes    | `[...]` reference                       |
 * | word             | Yes    | Unquoted identifier/value               |
 * | comment          | Yes    | `# ...` line comment                    |
 *
 * @see ../index.ts - Parser that produces the AST consumed here
 */

import type { Doc } from "prettier";
import { doc } from "prettier";

/**
 * Prettier Doc builders used by the printer.
 *
 * - `hardline`: A forced line break (always produces a newline)
 * - `indent`: Increases the indentation level for its content
 * - `join`: Joins an array of Docs with a separator between each element
 */
const { hardline, indent, join } = doc.builders;

// ---------------------------------------------------------------------------
// Print function
// ---------------------------------------------------------------------------

/**
 * The main print function for PDXScript.
 *
 * Called by Prettier for each node in the AST (via `path.map` or `path.call`).
 * Returns a Prettier Doc that represents the formatted output for that node.
 *
 * @param path     - Prettier AstPath pointing to the current node
 * @param _options  - Prettier formatting options (unused; we use tab indentation)
 * @param print    - Recursive callback to print child nodes
 * @returns        - A Prettier Doc (string, array, or builder object)
 */
function print(path: any, _options: any, print: (path: any) => Doc): Doc {
  const node: any = path.node;

  switch (node.type) {
    // -----------------------------------------------------------------------
    // source_file — Root node
    // -----------------------------------------------------------------------

    /**
     * The root node of a PDXScript file. Contains top-level declarations
     * and comments in its `namedChildren` array.
     *
     * Produces: declarations joined by blank lines, trailing newline.
     */
    case "source_file": {
      const docs = path.map(print, "namedChildren") as Doc[];
      return [join(hardline, docs), hardline];
    }

    // -----------------------------------------------------------------------
    // comment — Line comments
    // -----------------------------------------------------------------------

    /**
     * A PDXScript line comment. Starts with `#` and extends to end of line.
     *
     * We strip and re-add the `#` prefix to ensure consistent formatting,
     * though comments are otherwise preserved verbatim.
     *
     * Example output: `# This is a comment`
     */
    case "comment": {
      const text: string = node.text;
      const content = text.replace(/^#/, "");
      return ["#", content];
    }

    // -----------------------------------------------------------------------
    // declaration — Top-level named blocks
    // -----------------------------------------------------------------------

    /**
     * A top-level declaration: `name = { contents }`.
     *
     * Declarations are the primary structural element in PDXScript. They
     * have a name (identifier), an `=` operator, and a block value.
     *
     * Formatting:
     * - Empty blocks: `my_declaration = {}`
     * - Non-empty blocks:
     *   ```
     *   my_declaration = {
     *   	key1 = value1
     *   	key2 = value2
     *   }
     *   ```
     *
     * The name is in `namedChildren[0]`, the block in `namedChildren[1]`.
     * We navigate to the block's `namedChildren` via `path.call` to properly
     * set up the Prettier AstPath for recursive printing.
     */
    case "declaration": {
      const nameNode = node.namedChildren[0];
      const blockDocs = path.call(
        (blockPath: any) => {
          return blockPath.map(print, "namedChildren");
        },
        "namedChildren",
        1,
      ) as Doc[];
      if (blockDocs.length === 0) {
        return [nameNode.text, " = {}"];
      }
      return [
        nameNode.text,
        " = {",
        indent([hardline, join(hardline, blockDocs)]),
        hardline,
        "}",
      ];
    }

    // -----------------------------------------------------------------------
    // block — Curly-brace delimited contents
    // -----------------------------------------------------------------------

    /**
     * A block node: `{ contents }`.
     *
     * Appears standalone in `value` nodes or nested within declarations.
     * Contains `key_value` pairs and `comment` nodes.
     *
     * Formatting:
     * - Empty: `{}`
     * - Non-empty: `{ key = value ... }` (contents indented on new lines)
     *
     * Used for standalone block values (e.g., nested blocks in key-value pairs).
     */
    case "block": {
      const docs = path.map(print, "namedChildren") as Doc[];
      if (docs.length === 0) {
        return "{}";
      }
      return ["{", indent([hardline, join(hardline, docs)]), hardline, "}"];
    }

    // -----------------------------------------------------------------------
    // key_value — Key-operator-value pairs
    // -----------------------------------------------------------------------

    /**
     * A key-value pair: `key op value`.
     *
     * The operator is one of `=`, `>`, or `<` (defined as anonymous tokens
     * in the grammar). The value can be a simple scalar (word, quoted string,
     * localisation key) or a nested block.
     *
     * Formatting for scalar values:
     * ```
     * my_key = my_value
     * my_key > some_number
     * ```
     *
     * Formatting for block values:
     * ```
     * my_key = {
     * 	nested_key = nested_value
     * }
     * ```
     *
     * The operator is **not** in `namedChildren` (it's an anonymous token in
     * tree-sitter). We find it by iterating `node.children` and checking for
     * non-named nodes with text matching `=`, `>`, or `<`.
     *
     * Named children: `key` at index 0, `value` at index 1.
     */
    case "key_value": {
      const keyNode = node.namedChildren[0];
      const valueNode = node.namedChildren[1];

      // Extract the operator (=, >, <) from anonymous children.
      // The grammar's extras pattern /\s+/ makes tree-sitter include whitespace
      // in anonymous children, so we trim to get the raw operator text.
      let op = "=";
      for (const child of node.children) {
        if (!child.isNamed) {
          const t = child.text.trim();
          if (t === "=" || t === ">" || t === "<") {
            op = t;
            break;
          }
        }
      }

      // Check if the value node contains a block (nested block syntax).
      // Block values get special formatting with indentation.
      const isBlockValue =
        valueNode.children &&
        valueNode.children.length > 0 &&
        valueNode.children[0].type === "block";

      if (isBlockValue) {
        // Navigate: key_value.namedChildren[1] → value.children[0] → block.namedChildren
        // Two levels of path.call are needed because the block is inside a value node.
        const blockDocs = path.call(
          (valuePath: any) => {
            return valuePath.call(
              (blockPath: any) => {
                return blockPath.map(print, "namedChildren");
              },
              "children",
              0,
            );
          },
          "namedChildren",
          1,
        ) as Doc[];
        if (blockDocs.length === 0) {
          return [keyNode.text, " ", op, " {}"];
        }
        return [
          keyNode.text,
          " ",
          op,
          " {",
          indent([hardline, join(hardline, blockDocs)]),
          hardline,
          "}",
        ];
      }

      // Scalar value: print key and value on the same line.
      const childDocs = path.map(print, "namedChildren") as Doc[];
      return [keyNode.text, " ", op, " ", childDocs[1]];
    }

    // -----------------------------------------------------------------------
    // value — Value wrapper node
    // -----------------------------------------------------------------------

    /**
     * A value node wraps one of: quoted_string, localisation_key, word, or block.
     *
     * For most value types, this is a thin pass-through: we simply return the
     * node's text as-is. For block values, we delegate to the block printer.
     *
     * The value node itself doesn't add any formatting; it exists as a
     * grammar-level abstraction to allow multiple types at a value position.
     */
    case "value": {
      const childDocs = path.map(print, "children") as Doc[];
      return childDocs[0]!;
    }

    // -----------------------------------------------------------------------
    // quoted_string — String literals
    // -----------------------------------------------------------------------

    /**
     * A quoted string literal: `"some text"`.
     *
     * Preserved verbatim (including quotes). No whitespace normalization
     * is applied inside the string.
     */
    case "quoted_string":
      return node.text;

    // -----------------------------------------------------------------------
    // localisation_key — Localisation references
    // -----------------------------------------------------------------------

    /**
     * A localisation key reference: `[key_name]`.
     *
     * References a localized string in Paradox's localisation system.
     * The brackets are printed explicitly rather than relying on node.text
     * to ensure consistent formatting.
     */
    case "localisation_key": {
      const wordNode = node.namedChildren[0];
      return ["[", wordNode.text, "]"];
    }

    // -----------------------------------------------------------------------
    // word — Identifiers and literal values
    // -----------------------------------------------------------------------

    /**
     * A word token: an identifier, number, or other unquoted value.
     *
     * Matches the regex `/[^\s{}\[\]()=#"<>]+/` in the grammar.
     * Examples: `my_variable`, `42`, `-100`, `YES`.
     */
    case "word":
      return node.text;

    // -----------------------------------------------------------------------
    // default — Fallback for unknown node types
    // -----------------------------------------------------------------------

    /**
     * Fallback handler for any node type not explicitly handled above.
     *
     * Returns the node's raw text. This ensures the plugin doesn't crash
     * if the grammar is extended with new node types before the printer
     * is updated.
     */
    default:
      return node.text ?? "";
  }
}

// ---------------------------------------------------------------------------
// Printer export
// ---------------------------------------------------------------------------

/**
 * Prettier printer export for the PDXScript AST format.
 *
 * The key `"pdx-script-ast"` must match the `astFormat` value set by the
 * parser in `index.ts`. Prettier uses this to connect parsed ASTs to their
 * corresponding printer.
 */
export const printers: Record<string, any> = {
  "pdx-script-ast": {
    print,
  },
};
