# OOJS — PHP Implementation

PHP 8.1+ port of the [Object-Oriented JSON Schema](../README.md) reference implementation.
No runtime dependencies beyond the PHP standard library.

## Requirements

- PHP 8.1+
- Composer (for development / testing)
- `mbstring` extension (for Unicode-aware string length checks)

## Installation

```bash
cd php/
composer install          # installs PHPUnit for testing
```

For use in your own project, copy the `src/` directory and add the namespace to your autoloader, or reference this package via a path repository in your `composer.json`.

## Quick Start

```php
<?php

require 'vendor/autoload.php';

use Oojs\Registry;
use function Oojs\validate;

$registry = new Registry();
$schema   = $registry->loadFile(__DIR__ . '/../examples/clinical.oojs.json');

$instance = [
    '_type'     => 'Observation',
    'id'        => 'obs-001',
    'timestamp' => '2026-03-29T10:00:00Z',
    'subjectId' => 'patient-42',
    'code'      => '8480-6',
    'value'     => 120,
];

$errors = validate($instance, $schema->types['Observation'], $schema, $registry);

if ($errors) {
    foreach ($errors as $e) {
        echo $e . PHP_EOL;   // /path: [ERROR_CODE] human message
    }
} else {
    echo "valid" . PHP_EOL;
}
```

## API

### `Registry`

Holds loaded schemas and provides O(1) lookup by discriminator value.

```php
use Oojs\Registry;

$registry = new Registry();

// Load from file, JSON string, or PHP array
$schema = $registry->loadFile('/path/to/my.oojs.json');
$schema = $registry->loadJson('{"$oojs":"1.0", ...}');
$schema = $registry->loadDict(['$oojs' => '1.0', ...]);

// Lookup
$schema  = $registry->getSchema('https://example.org/schemas/my');
$typedef = $registry->lookupByDiscriminatorValue('Observation');
$typedef = $registry->resolveType('Observation', $schema);
$typedef = $registry->resolveTypeIn('Observation', $schemaId);
```

Multiple schemas can be loaded into one registry; cross-schema `imports` are resolved automatically.

### `Validator`

```php
use Oojs\Validator;

$validator = new Validator($registry, failFast: false);

// Validate a decoded PHP array
$errors = $validator->validate($instance, $typedef, $schema);

// Validate a JSON string
$errors = $validator->validateJson('{"_type":"Observation",...}', 'Observation', $schema);
```

### `validate()` convenience function

```php
use function Oojs\validate;

$errors = validate($instance, $typedef, $schema, $registry, failFast: false);
```

> **Note:** `validate()` is a namespaced function, not a method. Composer's `files` autoloader ensures it is always available when `vendor/autoload.php` is included.

### Error model

Each `ValidationError` carries:

| Property | Type | Description |
|----------|------|-------------|
| `$path` | `string` | RFC 6901 JSON Pointer to the failing location |
| `$code` | `string` | One of the `ErrorCode` constants (see below) |
| `$message` | `string` | Human-readable description |

```php
foreach ($errors as $e) {
    echo $e . PHP_EOL;       // "/findings/0: [MISSING_REQUIRED] missing required property 'id'"
    echo $e->path    . PHP_EOL;   // "/findings/0"
    echo $e->code    . PHP_EOL;   // "MISSING_REQUIRED"
    echo $e->message . PHP_EOL;   // "missing required property 'id'"
}
```

#### Error codes (`Oojs\ErrorCode`)

| Constant | Trigger |
|----------|---------|
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

Thrown by `Registry` methods when a schema document is structurally invalid.

```php
use Oojs\SchemaError;

try {
    $registry->loadFile('bad.oojs.json');
} catch (SchemaError $e) {
    echo $e->getMessage() . PHP_EOL;
}
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
| `minLength` / `maxLength` | `string` | Unicode code-point count via `mb_strlen($v, 'UTF-8')` |
| `pattern` | `string` | ECMA regex matched with `preg_match` (search semantics, anchors not implicit) |
| `format` | `string` | Informational only — not enforced in v1.0 |
| `enum` | `string`, `integer`, `number` | Allowed values list; loose comparison (`==`) |
| `minimum` / `maximum` | `integer`, `number` | Inclusive bounds |
| `exclusiveMinimum` / `exclusiveMaximum` | `integer`, `number` | Exclusive bounds (mutually exclusive with inclusive counterparts) |
| `multipleOf` | `integer`, `number` | Must be > 0; floating-point safe via `round(fmod(abs($v), $m), 10)` |
| `minItems` / `maxItems` | `array` | Length bounds |
| `uniqueItems` | `array` | JSON-serialization equality with recursively sorted keys |

## Project Structure

```
php/
├── composer.json          Composer manifest (requires PHP 8.1+, PHPUnit for dev)
├── phpunit.xml            PHPUnit configuration
├── src/
│   ├── Model/
│   │   ├── PropertyDef.php        Marker interface for property types
│   │   ├── PrimitiveProperty.php  string/integer/number/boolean/null + constraints
│   │   ├── TypeRefProperty.php    Reference to another named type
│   │   ├── ArrayProperty.php      Array with homogeneous item type
│   │   ├── TypeDef.php            Type definition with inheritance helpers
│   │   └── Schema.php             Schema document (types + imports)
│   ├── SchemaError.php            Thrown on structural schema errors
│   ├── Registry.php               Two-pass loader + discriminator index
│   ├── ErrorCode.php              All 19 error code constants
│   ├── ValidationError.php        path + code + message
│   └── Validator.php              4-phase validator + validate() function
└── tests/
    ├── TestHelpers.php             Shared trait (minimalSchema, makeRegistry, …)
    ├── SchemaLoadingTest.php       §4–6, §10–11: schema parsing rules
    ├── DiscriminatorTest.php       §7, §9.2 phase 1: discriminator resolution
    ├── RequiredTest.php            §5.6, §9.2 phase 2: required properties
    ├── AdditionalPropertiesTest.php §8.4, §9.2 phase 3: closed-world
    ├── StringConstraintsTest.php   §6.1, §9.3: string constraints
    ├── NumericConstraintsTest.php  §6.1, §9.3: numeric constraints
    ├── ArrayConstraintsTest.php    §6.3, §9.2 phase 4: array constraints
    ├── PolymorphicArrayTest.php    §7–8: polymorphic array dispatch
    ├── FailFastTest.php            §9.6: fail-fast mode
    ├── ClinicalExampleTest.php     Integration: reuses examples/ fixtures
    ├── SubtypeCheckTest.php        §9.4: isSubtypeOf
    └── EffectivePropertySetTest.php §9.5: effectiveProperties / effectiveRequired
```

## Running the Tests

```bash
cd php/
composer install
./vendor/bin/phpunit
```

### HTML Report

```bash
/vendor/bin/phpunit --testdox-html test-results.html
```

### HTML Coverage Report

```bash
XDEBUG_MODE=coverage ./vendor/bin/phpunit --coverage-html report-directory
```


Expected output:

```
PHPUnit 11.x.x by Sebastian Bergmann and contributors.

...........................................................................  76 / 76 (100%)

OK (76 tests, 102 assertions)
```

The integration tests (`ClinicalExampleTest`) read directly from `../examples/` so no fixture duplication is needed.

## PHP-specific Notes

- **JSON decoding:** instances are expected as associative PHP arrays (`json_decode($json, true)`). Both JSON objects and arrays decode to PHP arrays; the validator relies on the discriminator check to reject plain lists where objects are expected.
- **String lengths:** `mb_strlen($value, 'UTF-8')` is used so that multi-byte UTF-8 characters count as one code point, matching the Python reference implementation's `len()` semantics.
- **Regex patterns:** `preg_match('~pattern~u', $value)` with the `u` flag for Unicode mode. The `~` delimiter avoids the need to escape `/` in patterns. Invalid patterns yield `PATTERN_MISMATCH` rather than a fatal error.
- **`multipleOf` precision:** `round(fmod(abs($num), $divisor), 10)` mirrors the Python `round(num % m, 10)` approach to avoid floating-point false positives.
- **Function autoloading:** PHP's class autoloader does not cover functions. The `validate()` convenience function lives in `src/Validator.php` and is always loaded via the `"files"` entry in `composer.json`.
