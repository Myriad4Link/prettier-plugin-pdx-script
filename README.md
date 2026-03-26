# prettier-plugin-pdx-script

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://prettier.io/)

A [Prettier](https://prettier.io/) plugin for formatting [PDXScript](https://en.wikipedia.org/wiki/Paradox_Interactive) (Paradox game script) files. Powered by [tree-sitter-pdx_script](https://github.com/Myriad4Link/tree-sitter-pdx_script).

## Overview

PDXScript is the scripting language used in Paradox Interactive games such as Victoria 3, Hearts of Iron IV, Stellaris, Europa Universalis IV, and Crusader Kings III. These scripts are distributed as `.txt` files with nested key-value and block structures.

This plugin provides automatic, consistent formatting for PDXScript files using Prettier. It uses a [tree-sitter](https://tree-sitter.github.io/tree-sitter/) WASM parser to reliably parse PDXScript, then applies opinionated formatting rules. The parser is compiled from [tree-sitter-pdx_script](https://github.com/Myriad4Link/tree-sitter-pdx_script), a tree-sitter grammar for Paradox script files.

## Startup

### 1. Install

```bash
npm install --save-dev prettier-plugin-pdx-script
```

Prettier automatically discovers plugins from your project's dependencies. No explicit plugin registration is needed.

### 2. Configure

Create a `.prettierrc` (or `.prettierrc.json`) in your project root:

```json
{
  "plugins": ["prettier-plugin-pdx-script"]
}
```

If you don't need to change any formatting defaults, the empty config `{}` also works — Prettier will still auto-detect the plugin.

### 3. Format

Run Prettier against your `.txt` script files:

```bash
# Format a single file
npx prettier --write path/to/file.txt

# Check formatting without writing
npx prettier --check path/to/file.txt

# Format all .txt files in a directory
npx prettier --write "path/to/scripts/**/*.txt"
```

That's it — your PDXScript files will be formatted with tab-based indentation, compact empty blocks, and consistent spacing.

### 4. VS Code (optional)

Install the [Prettier extension](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) and add to your `.vscode/settings.json`:

```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "[plaintext]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  }
}
```

This tells VS Code to use Prettier for `.txt` files.

### 5. Bundling (optional)

When bundling this plugin (e.g. in a VS Code extension or webpack/esbuild build), the default WASM loading may fail. Two WASM files need to be located:

1. **tree-sitter runtime** — `tree-sitter.wasm`, loaded via the `locateFile` callback
2. **grammar** — `tree-sitter-pdx_script.wasm`, loaded via `setGrammarBinary()`

Override their resolution before any parse call:

```ts
import { setGrammarBinary, setLocateFile } from "prettier-plugin-pdx-script";

// Supply the grammar WASM directly
setGrammarBinary(() => myWasmBinary);

// Tell tree-sitter where to find its runtime WASM
setLocateFile((fileName, _scriptDir) => path.join(__dirname, "wasm", fileName));
```

The grammar WASM is also accessible via `require.resolve()`:

```ts
const wasmPath =
  require.resolve("prettier-plugin-pdx-script/dist/tree-sitter/tree-sitter-pdx_script.wasm");
```

## Formatting Rules

| Rule         | Before                   | After                                                      |
| ------------ | ------------------------ | ---------------------------------------------------------- |
| Indentation  | 4 spaces or mixed        | Tabs (one per nesting level)                               |
| Empty blocks | `my_decl = { }`          | `my_decl = {}`                                             |
| Block values | `key = { nested = val }` | `key = {`<br>&nbsp;&nbsp;&nbsp;&nbsp;`nested = val`<br>`}` |
| Comments     | `  # comment`            | `# comment`                                                |
| Operators    | Preserved as-is          | `=`, `>`, `<` all supported                                |

### Example

**Input:**

```
my_declaration={
    key1= value1
    key2 =value2
    nested={
        inner_key = "hello world"
    }
    # a comment
}
another_decl = { }
```

**Output:**

```
my_declaration = {
	key1 = value1
	key2 = value2
	nested = {
		inner_key = "hello world"
	}
	# a comment
}
another_decl = {}
```

## Architecture

The plugin follows the standard Prettier plugin architecture with three components:

```
Input Text
    │
    ▼
┌──────────────┐
│   Parser     │  tree-sitter WASM parser + AST conversion
│  (index.ts)  │  Converts tree-sitter SyntaxNodes → plain objects
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Printer     │  Walks the AST, produces Prettier Doc output
│(printer.ts)  │  Handles each node type with specific formatting rules
└──────┬───────┘
       │
       ▼
  Formatted Text
```

### Key Design Decisions

1. **Tree-to-plain-object conversion**: Tree-sitter nodes use JavaScript getters (e.g., `node.children` is computed), but Prettier's `path.map`/`path.call` traverse node properties directly. The `convertTree()` function in `index.ts` converts the tree-sitter AST to plain objects that Prettier can navigate.

2. **Tab indentation**: Paradox script files conventionally use tab indentation, which is preserved in this plugin.

3. **Operator preservation**: The `=`, `>`, and `<` operators in key-value pairs are preserved from the source. They are anonymous tokens in tree-sitter (not in `namedChildren`) and are found by iterating `node.children`.

## API

### `setGrammarBinary(loader)`

Override the grammar WASM binary loader. Use this when bundling the plugin (e.g. in a VS Code extension) where the WASM file cannot be loaded from the plugin's package directory.

```ts
import { setGrammarBinary } from "prettier-plugin-pdx-script";

// Load from a bundled Uint8Array
setGrammarBinary(() => myWasmBinary);
```

### `getGrammarBinary()`

Get the current grammar binary loader function. Useful for wrapping the default loader or testing.

### `setLocateFile(fn)`

Override the `locateFile` callback used to locate web-tree-sitter's own runtime WASM (`tree-sitter.wasm`). This is passed directly to `web-tree-sitter`'s `Parser.init({ locateFile })`.

Use this when bundling the plugin and the default resolution (relative to `scriptDir`) does not point to the correct location.

```ts
import { setLocateFile } from "prettier-plugin-pdx-script";

setLocateFile((fileName, _scriptDir) => {
  return path.join(__dirname, "wasm", fileName);
});
```

**Important:** `setLocateFile()` must be called before any `parse()` invocation (same constraint as `setGrammarBinary()`).

### `getLocateFile()`

Get the current `locateFile` callback. Useful for wrapping the default resolver or testing.

### `resetParser()`

Clears the cached tree-sitter parser so the next `parse()` call re-initializes with the current `grammarBinaryLoader` and `locateFileFn` settings. Useful for test isolation (call in `beforeEach`) or recovering from a bad `setGrammarBinary()` call without reloading the module.

```ts
import { resetParser } from "prettier-plugin-pdx-script";

resetParser();
```

### `disposeParser()`

Same as `resetParser()` but also calls `parser.delete()` to release WASM resources. Use this for full cleanup when the parser is no longer needed.

```ts
import { disposeParser } from "prettier-plugin-pdx-script";

disposeParser();
```

### `getGrammarWasmPath()`

Resolves the grammar WASM file path relative to the module's directory. Works reliably across CJS/ESM and bundled/unbundled environments.

```ts
import { getGrammarWasmPath } from "prettier-plugin-pdx-script";

const wasmPath = getGrammarWasmPath();
```

### `PARSER_NAME`

The parser name string `"pdx-script-parse"`, exported as a named constant. Useful for referencing the parser in Prettier plugin configurations.

```ts
import { PARSER_NAME } from "prettier-plugin-pdx-script";

console.log(PARSER_NAME); // "pdx-script-parse"
```

### Parser Caching

The tree-sitter parser is initialized once and cached for the lifetime of the module. `Parser.init()` and `Language.load()` are only called on the first `parse()` invocation; subsequent calls reuse the cached parser (~70ms saved per call).

To clear the cache, call `resetParser()` (re-initializes on next parse) or `disposeParser()` (also releases WASM resources).

## File Structure

```
prettier-plugin-pdx-script/
├── index.ts                  # Plugin entry point: language definition, parser, API
├── printer.ts                # Prettier printer: AST → Doc formatting
├── tsup.config.ts            # tsup build config (dual CJS/ESM)
├── package.json              # Package metadata and dependencies
├── README.md                 # This file
├── tree-sitter/
│   └── tree-sitter-pdx_script.wasm   # Compiled tree-sitter WASM parser
├── tests/
│   ├── format.test.ts        # Fixture-based formatting tests
│   └── __fixtures__/         # Test fixtures (input/expected pairs)
│       └── MWD_decisions.txt # Large file regression fixture (OOM guard)
└── dist/                     # Compiled output (generated by build)
    ├── index.js              # ESM entry point
    ├── index.cjs             # CJS entry point
    ├── index.d.ts            # TypeScript declarations (ESM)
    ├── index.d.cts           # TypeScript declarations (CJS)
    └── tree-sitter/
        └── tree-sitter-pdx_script.wasm
```

### Source Files

| File             | Purpose                                                                                                                                                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`       | Exports `languages`, `parsers`, `printers`, `PARSER_NAME` for Prettier. Defines the parser with caching, configurable WASM loading (`setGrammarBinary`, `setLocateFile`, `getGrammarWasmPath`), ESM/CJS `__dirname` resolution, and lifecycle control (`resetParser`, `disposeParser`). |
| `printer.ts`     | Exports the `printers` object with a `print` function that walks the AST and produces formatted Prettier Doc output. Handles all PDXScript node types.                                                                                                                                  |
| `tsup.config.ts` | Build configuration for tsup — produces dual CJS/ESM output with TypeScript declarations.                                                                                                                                                                                               |

## PDXScript Language Reference

### Grammar

```
source_file  → (declaration | comment)*
declaration  → name = block
block        → { (key_value | comment)* }
key_value    → key (= | > | <) value
value        → quoted_string | localisation_key | word | block
quoted_string → "..."
localisation_key → [word]
comment      → #.*$
word         → [^\s{}\[\]()=#"<>]+
```

### Node Types

| Node Type          | Description                                                         | Example               |
| ------------------ | ------------------------------------------------------------------- | --------------------- |
| `source_file`      | Root node containing all declarations                               | —                     |
| `declaration`      | Top-level named block                                               | `my_event = { ... }`  |
| `block`            | Curly-brace delimited contents                                      | `{ key = value }`     |
| `key_value`        | Key-operator-value pair                                             | `key = value`         |
| `value`            | Wrapper for one of: quoted string, localisation key, word, or block | —                     |
| `quoted_string`    | Double-quoted string literal                                        | `"hello world"`       |
| `localisation_key` | Localisation reference                                              | `[MY_KEY]`            |
| `word`             | Identifier, number, or unquoted value                               | `my_var`, `42`        |
| `comment`          | Line comment starting with `#`                                      | `# this is a comment` |

## Dependencies

- **prettier** `^3.8.1` — Code formatter plugin API
- **web-tree-sitter** `^0.26.7` — WASM runtime for tree-sitter parsers

## Building the WASM parser

The `tree-sitter-pdx_script.wasm` file is pre-compiled and included in the package. The grammar lives in a separate repository: [tree-sitter-pdx_script](https://github.com/Myriad4Link/tree-sitter-pdx_script).

To rebuild the WASM file (e.g., after modifying the grammar):

```bash
git clone https://github.com/Myriad4Link/tree-sitter-pdx_script
cd tree-sitter-pdx_script
npx tree-sitter build --wasm
cp tree-sitter-pdx_script.wasm /path/to/prettier-plugin-pdx-script/tree-sitter/
```

## Development

Build the compiled output (ESM + CJS via tsup):

```bash
bun run build
```

Run the test suite:

```bash
bun test
```

## License

MIT
