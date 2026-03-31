# OOJS — JavaScript (Browser) Implementation

Vanilla ES-module implementation of the **Object-Oriented JSON Schema** (OOJS) validator.
No build step, no Node.js, no TypeScript — runs directly in any modern browser.

## Requirements

Any browser that supports:
- Native ES Modules (`import` / `export`)
- `fetch()` (only needed for `Registry.loadFile()`)
- `Object.freeze`, `Array.from`, spread syntax — i.e. any browser released after ~2018

## Quick Start

Serve the `js/` directory from any static HTTP server (e.g. `python3 -m http.server`) and open `tests/index.html`.

Or import the library from your own ES-module page:

```html
<script type="module">
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
</script>
```

## API

### `Registry`

```js
import { Registry, SchemaError } from './src/index.js';

const r = new Registry();
```

| Method | Description |
|--------|-------------|
| `r.loadDict(obj)` | Parse a plain JS object as a schema. Returns the `Schema`. |
| `r.loadJson(text)` | Parse a JSON string as a schema. Returns the `Schema`. |
| `await r.loadFile(url)` | Fetch a JSON schema from a URL (**async**). Returns the `Schema`. |
| `r.getSchema(id)` | Look up a previously loaded schema by `$id`. Returns `Schema \| null`. |

Throws `SchemaError` if the schema is malformed.

### `Validator` / `validate()`

```js
import { Validator, validate } from './src/index.js';

// Functional form (creates a one-shot Validator):
const errors = validate(instance, typedef, schema, registry, failFast = false);

// Reusable Validator:
const v = new Validator(registry, failFast = false);
const errors = v.validate(instance, typedef, schema);
const errors = v.validateJson(jsonText, typeName, schema);
```

### `ValidationError`

| Field | Type | Description |
|-------|------|-------------|
| `path` | `string` | RFC 6901 JSON Pointer to the error location |
| `code` | `string` | One of the `ErrorCode` constants |
| `message` | `string` | Human-readable description |

`error.toString()` → `"/path: [CODE] message"`

### `ErrorCode`

All error codes are string constants on the frozen `ErrorCode` object:

| Constant | When raised |
|----------|-------------|
| `MISSING_DISCRIMINATOR` | `_type` property absent |
| `INVALID_DISCRIMINATOR_TYPE` | `_type` is not a string |
| `UNKNOWN_TYPE` | `_type` value not registered |
| `ABSTRACT_TYPE` | `_type` names an abstract type |
| `TYPE_MISMATCH` | Wrong JSON kind, or type is not a subtype of the target |
| `MISSING_REQUIRED` | A required property is absent |
| `ADDITIONAL_PROPERTY` | Unknown property in closed-world schema |
| `STRING_TOO_SHORT` | String length < `minLength` |
| `STRING_TOO_LONG` | String length > `maxLength` |
| `PATTERN_MISMATCH` | String does not match `pattern` |
| `ENUM_MISMATCH` | Value not in `enum` list |
| `BELOW_MINIMUM` | Number < `minimum` |
| `ABOVE_MAXIMUM` | Number > `maximum` |
| `BELOW_EXCLUSIVE_MINIMUM` | Number ≤ `exclusiveMinimum` |
| `ABOVE_EXCLUSIVE_MAXIMUM` | Number ≥ `exclusiveMaximum` |
| `NOT_MULTIPLE_OF` | Number is not a multiple of `multipleOf` |
| `NOT_INTEGER` | Value has a fractional part (for `integer` properties) |
| `ARRAY_TOO_SHORT` | Array length < `minItems` |
| `ARRAY_TOO_LONG` | Array length > `maxItems` |
| `ARRAY_DUPLICATE_ITEMS` | Duplicate items when `uniqueItems: true` |

### `SchemaError`

Thrown by `Registry` methods when a schema document is invalid (extends `Error`).

## Project Structure

```
js/
├── src/
│   ├── index.js       Public API barrel (re-exports everything)
│   ├── model.js       PrimitiveProperty, TypeRefProperty, ArrayProperty, TypeDef, Schema
│   ├── registry.js    SchemaError, Registry (loadDict / loadJson / loadFile)
│   └── validator.js   ErrorCode, ValidationError, Validator, validate()
└── tests/
    ├── index.html     Browser test runner page
    ├── runner.js      Minimal async test framework (no dependencies)
    └── validator.test.js  76-test conformance suite (inline data, no server needed)
```

## Running the Tests

1. Start any static HTTP server from the repo root:
   ```sh
   python3 -m http.server 8080
   # or: npx serve .
   ```
2. Open `http://localhost:8080/js/tests/index.html` in your browser.

All tests should show green (✓).

> **Why a server?** Browsers block `import` of `file://` ES modules due to CORS restrictions.
> Any static server works — the tests contain no server-side logic.

## Schema Format

OOJS schemas are JSON objects with:

```json
{
  "$oojs": "1.0",
  "$id": "https://example.org/my-schema",
  "discriminator": "_type",
  "additionalProperties": false,
  "types": { ... }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `$oojs` | yes | Must be `"1.0"` |
| `$id` | yes | Unique schema URI |
| `discriminator` | no | Property name used for type dispatch (default: `_type`) |
| `additionalProperties` | no | `false` = closed-world (default), `true` = open |
| `types` | yes | Map of type name → type definition |

### Type Definition

```json
"MyType": {
  "abstract": false,
  "extends": "ParentType",
  "discriminatorValue": "my-type",
  "title": "...",
  "description": "...",
  "properties": { ... },
  "required": ["prop1", "prop2"]
}
```

### Property Types

| Spec type | JS type | Key constraints |
|-----------|---------|-----------------|
| `string` | `string` | `minLength`, `maxLength`, `pattern`, `format`, `enum` |
| `integer` | `number` (integer) | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `enum` |
| `number` | `number` | same as integer |
| `boolean` | `boolean` | — |
| `null` | `null` | — |
| `array` | `Array` | `items`, `minItems`, `maxItems`, `uniqueItems` |
| `TypeName` | object | validated recursively |
