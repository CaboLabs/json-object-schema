# OOJS — Java Implementation

Java 11+ port of the [Object-Oriented JSON Schema](../README.md) reference implementation.
The only runtime dependency is Jackson for JSON parsing.

## Requirements

- JDK 11+
- Gradle (wrapper included)

## Quick Start

```java
import org.oojs.Registry;
import org.oojs.Validator;
import org.oojs.model.Schema;

Registry registry = new Registry();
Schema schema = registry.loadFile("examples/clinical.oojs.json");

Map<String, Object> instance = Map.of(
    "_type",     "Observation",
    "id",        "obs-001",
    "timestamp", "2026-03-29T10:00:00Z",
    "subjectId", "patient-42",
    "code",      "8480-6",
    "value",     120
);

var errors = new Validator(registry).validate(instance, schema.types.get("Observation"), schema);

if (errors.isEmpty()) {
    System.out.println("valid");
} else {
    errors.forEach(System.out::println);  // /path: [ERROR_CODE] human message
}
```

## API

### `Registry`

Holds loaded schemas and provides O(1) lookup by discriminator value.

```java
Registry registry = new Registry();

// Load from file, JSON string, or Map
Schema schema = registry.loadFile("/path/to/my.oojs.json");
Schema schema = registry.loadJson("{\"$oojs\":\"1.0\", ...}");
Schema schema = registry.loadMap(Map.of("$oojs", "1.0", ...));

// Lookup
Schema  schema  = registry.getSchema("https://example.org/schemas/my");
TypeDef typedef = registry.lookupByDiscriminatorValue("Observation");
TypeDef typedef = registry.resolveType("Observation", schema);
TypeDef typedef = registry.resolveTypeIn("Observation", schemaId);
```

Multiple schemas can be loaded into one registry; cross-schema `imports` are resolved automatically.

### `Validator`

```java
// Default: collect all errors
Validator validator = new Validator(registry);

// Fail-fast: stop after the first error
Validator validator = new Validator(registry, true);

// Validate a decoded Map
List<ValidationError> errors = validator.validate(instance, typedef, schema);

// Validate a JSON string
List<ValidationError> errors = validator.validateJson("{\"_type\":\"Observation\",...}", "Observation", schema);
```

### Error model

Each `ValidationError` carries:

| Field | Type | Description |
|-------|------|-------------|
| `path` | `String` | RFC 6901 JSON Pointer to the failing location |
| `code` | `String` | One of the `ErrorCode` constants (see below) |
| `message` | `String` | Human-readable description |

```java
for (ValidationError e : errors) {
    System.out.println(e);          // "/findings/0: [MISSING_REQUIRED] missing required property 'id'"
    System.out.println(e.path);     // "/findings/0"
    System.out.println(e.code);     // "MISSING_REQUIRED"
    System.out.println(e.message);  // "missing required property 'id'"
}
```

#### Error codes (`ErrorCode`)

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

```java
try {
    registry.loadFile("bad.oojs.json");
} catch (SchemaError e) {
    System.err.println(e.getMessage());
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
| `minLength` / `maxLength` | `string` | Unicode code-point count via `String.codePointCount` |
| `pattern` | `string` | ECMA regex matched with `Pattern.compile` (search semantics, anchors not implicit) |
| `format` | `string` | Informational only — not enforced in v1.0 |
| `enum` | `string`, `integer`, `number` | Allowed values list |
| `minimum` / `maximum` | `integer`, `number` | Inclusive bounds |
| `exclusiveMinimum` / `exclusiveMaximum` | `integer`, `number` | Exclusive bounds (mutually exclusive with inclusive counterparts) |
| `multipleOf` | `integer`, `number` | Must be > 0; floating-point safe via `Math.round(remainder * 1e10) / 1e10` |
| `minItems` / `maxItems` | `array` | Length bounds |
| `uniqueItems` | `array` | JSON-serialization equality with recursively sorted keys |

## Project Structure

```
java/
├── build.gradle           Gradle build (JDK 11+, Jackson, JUnit 5)
├── settings.gradle
├── src/main/java/org/oojs/
│   ├── model/
│   │   ├── PropertyDef.java        Marker interface for property types
│   │   ├── PrimitiveProperty.java  string/integer/number/boolean/null + constraints
│   │   ├── TypeRefProperty.java    Reference to another named type
│   │   ├── ArrayProperty.java      Array with homogeneous item type
│   │   ├── TypeDef.java            Type definition with inheritance helpers
│   │   └── Schema.java             Schema document (types + imports)
│   ├── SchemaError.java            Thrown on structural schema errors
│   ├── Registry.java               Two-pass loader + discriminator index
│   ├── ErrorCode.java              All 20 error code constants
│   ├── ValidationError.java        path + code + message
│   └── Validator.java              4-phase validator
└── src/test/java/org/oojs/
    ├── TestHelpers.java              Shared fixtures and assertion helpers
    ├── SchemaLoadingTest.java        §4–6, §10–11: schema parsing rules
    ├── DiscriminatorTest.java        §7, §9.2 phase 1: discriminator resolution
    ├── RequiredTest.java             §5.6, §9.2 phase 2: required properties
    ├── AdditionalPropertiesTest.java §8.4, §9.2 phase 3: closed-world
    ├── StringConstraintsTest.java    §6.1, §9.3: string constraints
    ├── NumericConstraintsTest.java   §6.1, §9.3: numeric constraints
    ├── ArrayConstraintsTest.java     §6.3, §9.2 phase 4: array constraints
    ├── PolymorphicArrayTest.java     §7–8: polymorphic array dispatch
    ├── FailFastTest.java             §9.6: fail-fast mode
    ├── ClinicalExampleTest.java      Integration: reuses examples/ fixtures
    ├── SubtypeCheckTest.java         §9.4: isSubtypeOf
    ├── EffectivePropertySetTest.java §9.5: effectiveProperties / effectiveRequired
    └── CoverageCompletionTest.java   Edge cases and coverage completion
```

## Running the Tests

```bash
cd java/
./gradlew test
```

Expected output:

```
BUILD SUCCESSFUL
> Task :test
88 tests completed, 0 failed
```

The integration tests (`ClinicalExampleTest`) read directly from `../examples/` so no fixture duplication is needed.

## Java-specific Notes

- **JSON decoding:** Jackson deserialises JSON objects as `Map<String, Object>`, arrays as `List<Object>`, and numbers as `Integer`, `Long`, or `Double` depending on magnitude and presence of a decimal point. The validator handles all three numeric types uniformly via `Number.doubleValue()`.
- **String lengths:** `String.codePointCount(0, s.length())` is used so that supplementary Unicode characters count as one code point, matching the behaviour of the other implementations.
- **Regex patterns:** `Pattern.compile(pattern).matcher(value).find()` uses search semantics (anchors are not implicit), consistent with ECMA regex behaviour. Invalid patterns yield `PATTERN_MISMATCH` rather than a runtime exception.
- **`multipleOf` precision:** `Math.round(remainder * 1e10) / 1e10` mirrors the Python `round(num % m, 10)` approach to avoid floating-point false positives.
- **`uniqueItems`:** objects are compared by serialising them to JSON with recursively sorted keys via Jackson, so `{"a":1,"b":2}` and `{"b":2,"a":1}` are treated as equal.
