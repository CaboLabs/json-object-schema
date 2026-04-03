# OOJS — Python Implementation

Reference implementation of the [Object-Oriented JSON Schema](../README.md) language.
Requires Python 3.10+ and no third-party dependencies.

## Installation

```bash
# From PyPI
pip install oojs

# Or editable install from repo root (for development)
pip install -e .
```

Or just copy the `python/` directory into your project and import as `oojs` — it has zero dependencies.

## Quick Start

```python
from oojs import Registry, validate

registry = Registry()
schema   = registry.load_file("examples/clinical.oojs.json")

instance = {
    "_type":     "Observation",
    "id":        "obs-001",
    "timestamp": "2026-03-29T10:00:00Z",
    "subjectId": "patient-42",
    "code":      "8480-6",
    "value":     120,
}

errors = validate(instance, schema.types["Observation"], schema, registry)
if errors:
    for e in errors:
        print(e)   # /path: [ERROR_CODE] human message
else:
    print("valid")
```

## API

### `Registry`

Holds loaded schemas and provides O(1) lookup by discriminator value.

```python
registry = Registry()

# Load from file, JSON string, or plain dict
schema = registry.load_file("my.oojs.json")
schema = registry.load_json('{"$oojs":"1.0", ...}')
schema = registry.load_dict({"$oojs": "1.0", ...})

# Lookup
schema    = registry.get_schema("https://example.org/schemas/my")
typedef   = registry.lookup_by_discriminator_value("Observation")
typedef   = registry.resolve_type("Observation", schema)
typedef   = registry.resolve_type_in("Observation", schema_id)
```

Multiple schemas can be loaded into one registry; cross-schema `imports` are resolved automatically.

### `Validator`

```python
from oojs import Validator

validator = Validator(registry, fail_fast=False)

# Validate a decoded Python dict
errors = validator.validate(instance, typedef, schema)

# Validate a JSON string
errors = validator.validate_json('{"_type":"Observation",...}', "Observation", schema)
```

### `validate()` convenience function

```python
from oojs import validate

errors = validate(instance, typedef, schema, registry, fail_fast=False)
```

### Error model

Each `ValidationError` carries:

| Field | Type | Description |
|-------|------|-------------|
| `path` | `str` | RFC 6901 JSON Pointer to the failing location |
| `code` | `str` | One of the `ErrorCode` constants (see below) |
| `message` | `str` | Human-readable description |

```python
for e in errors:
    print(e)            # "/findings/0: [MISSING_REQUIRED] missing required property 'id'"
    print(e.path)       # "/findings/0"
    print(e.code)       # "MISSING_REQUIRED"
    print(e.message)    # "missing required property 'id'"
```

#### Error codes

| Code | Trigger |
|------|---------|
| `MISSING_DISCRIMINATOR` | Discriminator property absent from instance |
| `INVALID_DISCRIMINATOR_TYPE` | Discriminator value is not a string |
| `UNKNOWN_TYPE` | Discriminator value maps to no loaded type |
| `ABSTRACT_TYPE` | Discriminator names an abstract type |
| `TYPE_MISMATCH` | Concrete type is not a subtype of the expected type |
| `MISSING_REQUIRED` | A required property is absent |
| `ADDITIONAL_PROPERTY` | An undeclared property is present in closed-world mode |
| `STRING_TOO_SHORT` | String length < `minLength` |
| `STRING_TOO_LONG` | String length > `maxLength` |
| `PATTERN_MISMATCH` | String does not match `pattern` |
| `ENUM_MISMATCH` | Value not in `enum` list |
| `BELOW_MINIMUM` | Number < `minimum` |
| `ABOVE_MAXIMUM` | Number > `maximum` |
| `BELOW_EXCLUSIVE_MINIMUM` | Number ≤ `exclusiveMinimum` |
| `ABOVE_EXCLUSIVE_MAXIMUM` | Number ≥ `exclusiveMaximum` |
| `NOT_MULTIPLE_OF` | Number is not a multiple of `multipleOf` |
| `NOT_INTEGER` | Float value has a non-zero fractional part for an `integer` field |
| `ARRAY_TOO_SHORT` | Array length < `minItems` |
| `ARRAY_TOO_LONG` | Array length > `maxItems` |
| `ARRAY_DUPLICATE_ITEMS` | Non-unique items with `uniqueItems: true` |

### `SchemaError`

Raised by `Registry` methods when a schema document is structurally invalid.

```python
from oojs import SchemaError

try:
    registry.load_file("bad.oojs.json")
except SchemaError as e:
    print(e)
```

## Command-line Interface

```
python -m oojs <command> [options]
```

### `validate`

```bash
python -m oojs validate \
    --schema examples/clinical.oojs.json \
    --type   Observation \
    instance.json

# Read instance from stdin
echo '{"_type":"Observation",...}' | python -m oojs validate \
    --schema examples/clinical.oojs.json \
    --type   Observation -

# Stop after first error
python -m oojs validate --schema ... --type ... --fail-fast instance.json

# Pre-load an imported schema
python -m oojs validate --schema main.oojs.json --type Foo \
    --import base=base.oojs.json instance.json
```

Exit codes: `0` = valid, `1` = validation errors, `2` = file/parse errors.

### `inspect`

```bash
# List all types in a schema
python -m oojs inspect examples/clinical.oojs.json

# Show a single type
python -m oojs inspect examples/clinical.oojs.json --type Observation
```

## Schema Format (brief reference)

```json
{
  "$oojs": "1.0",
  "$id": "https://example.org/schemas/my",
  "title": "Optional title",
  "discriminator": "_type",
  "additionalProperties": false,
  "imports": {
    "base": "https://example.org/schemas/base"
  },
  "types": {
    "MyBase": {
      "abstract": true,
      "properties": {
        "id":    { "type": "string", "minLength": 1 },
        "score": { "type": "number", "minimum": 0, "maximum": 100 }
      },
      "required": ["id"]
    },
    "MyConcrete": {
      "extends": "MyBase",
      "discriminatorValue": "concrete",
      "properties": {
        "tags":   { "type": "array", "items": { "type": "string" }, "uniqueItems": true },
        "status": { "type": "string", "enum": ["active", "inactive"] },
        "ref":    { "type": "base.SomeType" }
      },
      "required": ["status"]
    }
  }
}
```

### Naming rules

| Element | Pattern | Examples |
|---------|---------|---------|
| Type names | `^[A-Z][A-Za-z0-9_]*$` | `Observation`, `ClinicalEntry` |
| Property names | `^[a-z_][A-Za-z0-9_]*$` | `subject_id`, `icdCode` |
| Import aliases | same as property names | `base`, `clinical` |

### Primitive property constraints

| Constraint | Applies to | Description |
|-----------|-----------|-------------|
| `minLength` / `maxLength` | `string` | Unicode code-point count bounds |
| `pattern` | `string` | ECMA regex; `re.search` semantics (anchors not implicit) |
| `format` | `string` | Informational only — not enforced in v1.0 |
| `enum` | `string`, `integer`, `number` | Allowed values list |
| `minimum` / `maximum` | `integer`, `number` | Inclusive bounds |
| `exclusiveMinimum` / `exclusiveMaximum` | `integer`, `number` | Exclusive bounds (mutually exclusive with inclusive counterparts) |
| `multipleOf` | `integer`, `number` | Must be > 0 |
| `minItems` / `maxItems` | `array` | Length bounds |
| `uniqueItems` | `array` | JSON-serialization equality |

## Running the Tests

```bash
# From the repository root
pip install pytest
pytest python/tests/
```

The test suite covers all schema-loading rules, all validation phases, all constraint types, polymorphic dispatch, fail-fast mode, and the clinical integration example.

## Building and Publishing (`oojs` on PyPI)

```bash
# Install build tools (once)
pip install build twine

# Build sdist + wheel from the repo root
python3 -m build

# Upload to PyPI (requires a PyPI account + token)
python3 -m twine upload dist/oojs-*
```

The package source lives in `python/` and is exposed as the `oojs` namespace via `pyproject.toml`.
The automated script `scripts/publish.sh` handles versioning and uploading.
