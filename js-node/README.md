# OOJS — JavaScript (Node.js) Implementation

Vanilla ES-module implementation of the **Object-Oriented JSON Schema** (OOJS) validator for Node.js.
No build step, no TypeScript, no runtime dependencies — pure Node.js.

Published as **`@oojs/node`** on npm.

## Requirements

- **Node.js 18+** (uses `node:fs/promises` and `node:test`)

## Installation

```sh
npm install @oojs/node
```

## Quick Start

```js
import { Registry, validate, ErrorCode } from '@oojs/node';

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

### Loading from a file

```js
// File path (Node.js)
const schema = await r.loadFile('./examples/my-schema.oojs.json');

// URL (http/https)
const schema = await r.loadFile('https://example.org/schema.json');
```

`loadFile` detects the argument type automatically: HTTP(S) URLs use `fetch()`, file paths use `node:fs/promises`.

## API

### `Registry`

| Method | Returns | Description |
|--------|---------|-------------|
| `r.loadDict(obj)` | `Schema` | Parse a plain JS object as a schema |
| `r.loadJson(text, source?)` | `Schema` | Parse a JSON string as a schema |
| `await r.loadFile(pathOrUrl)` | `Promise<Schema>` | Load from file path or URL |
| `r.getSchema(id)` | `Schema \| undefined` | Look up schema by `$id` |

### `validate()` / `Validator`

```js
import { Validator, validate } from '@oojs/node';

// Functional:
const errors = validate(instance, typedef, schema, registry, failFast?);

// Reusable:
const v = new Validator(registry, failFast?);
const errors = v.validate(instance, typedef, schema);
```

### `ValidationError`

| Field | Type | Description |
|-------|------|-------------|
| `path` | `string` | RFC 6901 JSON Pointer |
| `code` | `string` | One of the `ErrorCode` constants |
| `message` | `string` | Human-readable description |

## Project Structure

```
js-node/
├── src/
│   ├── index.js       Public API barrel
│   ├── model.js       PrimitiveProperty, IdRefProperty, TypeRefProperty, ArrayProperty, TypeDef, Schema
│   ├── registry.js    SchemaError, Registry (loadDict / loadJson / loadFile)
│   └── validator.js   ErrorCode, ValidationError, Validator, validate()
├── tests/
│   ├── runner.js          node:test adapter (same API as browser runner)
│   └── validator.test.js  185-test conformance suite
└── package.json
```

## Running the Tests

```sh
npm test
# or directly:
node --test tests/validator.test.js
```

Expected:
```
# tests 185
# pass 185
# fail 0
```

## Relationship to Other Packages

| Package | Target | Source |
|---------|--------|--------|
| `@oojs/browser` | Browsers (ES modules) | `js/` |
| **`@oojs/node`** | **Node.js 18+** | **`js-node/`** |
| `@oojs/core` | Node.js + bundlers (TypeScript) | `ts/` |

All three implement the same OOJS spec. Choose based on your runtime and language preference.

## Publishing (`@oojs/node`)

```sh
npm login
cd js-node/
node --test tests/validator.test.js   # verify tests pass
npm publish --access public
```

The automated script at `scripts/publish.sh` handles versioning and publishing all packages at once.
