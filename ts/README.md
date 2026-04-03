# OOJS — TypeScript Implementation

TypeScript implementation of the **Object-Oriented JSON Schema** (OOJS) validator.
Compiles to browser-compatible ES2022 JavaScript via `tsc` (no bundler required).

## Requirements

- **Node.js 18+** — for running tests (Vitest) and compiling
- **TypeScript 5.4+** — included as a dev dependency
- Any **modern browser** for the compiled output (ES2022 target)

## Installation

```sh
cd ts/
npm install
```

## Quick Start

```typescript
import { Registry, validate, ErrorCode } from './src/index.js';

const r = new Registry();
const schema = r.loadDict({
  '$oojs': '1.0',
  '$id': 'https://example.org/schemas/animals',
  types: {
    Animal: {
      abstract: true,
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
    Dog: {
      extends: 'Animal',
      properties: { breed: { type: 'string' } },
      required: ['breed'],
    },
  },
});

const errors = validate(
  { _type: 'Dog', name: 'Rex', breed: 'Labrador' },
  schema.types['Dog'],
  schema,
  r,
);
console.log(errors); // []
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile `src/` → `dist/` (ES2022 modules) |
| `npm run build:browser` | Build browser bundle `dist/oojs.browser.js` (esbuild) |
| `npm run build:all` | Both of the above |
| `npm test` | Run the test suite once with Vitest |
| `npm run test:watch` | Run tests in watch mode |

## Using the Compiled Output

**Node.js / bundler** — use the compiled modules in `dist/`:
```typescript
import { Registry, validate } from '@oojs/core';
```

**Browser (no bundler)** — use the pre-bundled ESM file after `npm run build:browser`:
```html
<script type="module">
  import { Registry, validate } from './dist/oojs.browser.js';
</script>
```

**Direct TypeScript** — import from `src/` with `moduleResolution: bundler`:
```typescript
import { Registry, validate } from './src/index.js';
```

## Building and Publishing (`@oojs/core`)

```sh
cd ts/
npm install

# Build everything (Node modules + browser bundle)
npm run build:all

# Publish to npm (requires npm login)
npm publish --access public
```

The `prepublishOnly` hook runs `build` automatically on `npm publish`.

## API

### `Registry`

```typescript
import { Registry, SchemaError } from './src/index.js';

const r = new Registry();
```

| Method | Returns | Description |
|--------|---------|-------------|
| `r.loadDict(obj)` | `Schema` | Parse a plain JS object as a schema |
| `r.loadJson(text, source?)` | `Schema` | Parse a JSON string as a schema |
| `await r.loadFile(url)` | `Promise<Schema>` | Fetch and load a schema from a URL |
| `r.getSchema(id)` | `Schema \| undefined` | Look up schema by `$id` |

Throws `SchemaError` if the schema is malformed.

### `validate()` / `Validator`

```typescript
import { validate, Validator, ValidationError } from './src/index.js';

// Functional form:
const errors: ValidationError[] = validate(instance, typedef, schema, registry, failFast?);

// Reusable validator:
const v = new Validator(registry, failFast?);
const errors = v.validate(instance, typedef, schema);
const errors = v.validateJson(jsonText, typeName, schema);
```

### `ValidationError`

| Field | Type | Description |
|-------|------|-------------|
| `path` | `string` | RFC 6901 JSON Pointer |
| `code` | `string` | One of the `ErrorCode` constants |
| `message` | `string` | Human-readable description |

### `ErrorCode`

All 20 error codes as a frozen `const` object:

| Constant | When raised |
|----------|-------------|
| `MISSING_DISCRIMINATOR` | `_type` absent |
| `INVALID_DISCRIMINATOR_TYPE` | `_type` is not a string |
| `UNKNOWN_TYPE` | `_type` value not registered |
| `ABSTRACT_TYPE` | `_type` names an abstract type |
| `TYPE_MISMATCH` | Wrong JSON kind, or not a subtype of target |
| `MISSING_REQUIRED` | Required property absent |
| `ADDITIONAL_PROPERTY` | Extra property in closed-world schema |
| `STRING_TOO_SHORT` | String length < `minLength` |
| `STRING_TOO_LONG` | String length > `maxLength` |
| `PATTERN_MISMATCH` | String doesn't match `pattern` |
| `ENUM_MISMATCH` | Value not in `enum` |
| `BELOW_MINIMUM` | Number < `minimum` |
| `ABOVE_MAXIMUM` | Number > `maximum` |
| `BELOW_EXCLUSIVE_MINIMUM` | Number ≤ `exclusiveMinimum` |
| `ABOVE_EXCLUSIVE_MAXIMUM` | Number ≥ `exclusiveMaximum` |
| `NOT_MULTIPLE_OF` | Not a multiple of `multipleOf` |
| `NOT_INTEGER` | Fractional value for `integer` property |
| `ARRAY_TOO_SHORT` | Array length < `minItems` |
| `ARRAY_TOO_LONG` | Array length > `maxItems` |
| `ARRAY_DUPLICATE_ITEMS` | Duplicate items when `uniqueItems: true` |

## Project Structure

```
ts/
├── src/
│   ├── index.ts       Public API barrel
│   ├── model.ts       PrimitiveProperty, TypeRefProperty, ArrayProperty, TypeDef, Schema
│   ├── registry.ts    SchemaError, Registry
│   └── validator.ts   ErrorCode, ValidationError, Validator, validate()
├── tests/
│   └── validator.test.ts  76-test conformance suite (Vitest)
├── dist/              Compiled output (after npm run build)
├── tsconfig.json
└── package.json
```

## Running Tests

```sh
npm test
```

Expected output:
```
 ✓ tests/validator.test.ts  (76 tests)

 Test Files  1 passed (1)
      Tests  76 passed (76)
```

## TypeScript Notes

- `abstract` and `extends` are reserved keywords in TypeScript. The model uses `isAbstract` and `extendsRef` instead — the schema JSON still uses `"abstract"` and `"extends"` as keys; the renaming is internal only.
- `ErrorCode` is typed as `const` so `ErrorCode.MISSING_DISCRIMINATOR` has the precise literal type `"MISSING_DISCRIMINATOR"`.
- The `PropertyDef` union type (`PrimitiveProperty | IdRefProperty | TypeRefProperty | ArrayProperty`) is exported for consumers who need to switch on property kinds.
- `Registry.loadFile()` detects whether the argument is an HTTP(S) URL or a file-system path. URLs use `fetch()`, file paths use `node:fs/promises` (Node.js only via dynamic import).
