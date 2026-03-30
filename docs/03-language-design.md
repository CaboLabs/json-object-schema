# Phase 3: Language Design

## 1. Overview

OOJS schemas are expressed in JSON. A schema file uses the `.oojs.json` extension. This document defines the complete syntax and semantics of OOJS v1.0.

---

## 2. Schema Document Structure

```json
{
  "$oojs":   "<version>",
  "$id":     "<uri>",
  "title":   "<string>",
  "description": "<string>",
  "imports": { "<alias>": "<uri>", ... },
  "discriminator": "<property-name>",
  "types":   { "<TypeName>": <TypeDefinition>, ... }
}
```

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `$oojs` | yes | string | OOJS version. Must be `"1.0"` for this specification. |
| `$id` | yes | string (URI) | Unique identifier for this schema. |
| `title` | no | string | Human-readable name. |
| `description` | no | string | Human-readable description. |
| `imports` | no | object | Map of alias → schema URI for external type references. |
| `discriminator` | no | string | Name of the discriminator property. Default: `"_type"`. |
| `types` | yes | object | Map of type name → type definition. Must contain at least one entry. |

---

## 3. Type Definition

```json
{
  "extends":     "<TypeName>",
  "abstract":    false,
  "discriminatorValue": "<string>",
  "title":       "<string>",
  "description": "<string>",
  "properties":  { "<propName>": <PropertyDefinition>, ... },
  "required":    ["<propName>", ...]
}
```

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `extends` | no | string | Name of the supertype. May be `"<alias>.<TypeName>"` for imported types. |
| `abstract` | no | boolean | If `true`, this type cannot be instantiated. Default: `false`. |
| `discriminatorValue` | no | string | Override the discriminator value for this type. Default: the type name. |
| `title` | no | string | Human-readable name. |
| `description` | no | string | Human-readable description. |
| `properties` | no | object | Properties declared directly on this type (not inherited). |
| `required` | no | array | Names of required properties declared on this type. |

**Notes:**
- Property names must be unique within the type's own `properties` map.
- A type must not declare a property with the same name as an inherited property.
- The discriminator property name is reserved and must not appear in `properties`.
- The effective required set of a type is the union of its own `required` list and its supertype's effective required set.

---

## 4. Property Definition

A property definition is one of:

### 4.1 Primitive property

```json
{
  "type":        "<primitive>",
  "title":       "<string>",
  "description": "<string>",
  <constraints>
}
```

Where `<primitive>` is one of: `"string"`, `"integer"`, `"number"`, `"boolean"`, `"null"`.

#### String constraints

| Keyword | Type | Description |
|---------|------|-------------|
| `minLength` | integer ≥ 0 | Minimum number of Unicode code points |
| `maxLength` | integer ≥ 0 | Maximum number of Unicode code points |
| `pattern` | string (regex) | ECMA-262 regular expression the value must match |
| `enum` | array of strings | Value must be one of the listed strings |
| `format` | string | Semantic format hint (e.g., `"date"`, `"email"`, `"uri"`) — informational only in v1.0 |

#### Integer / Number constraints

| Keyword | Type | Description |
|---------|------|-------------|
| `minimum` | number | Inclusive lower bound |
| `maximum` | number | Inclusive upper bound |
| `exclusiveMinimum` | number | Exclusive lower bound |
| `exclusiveMaximum` | number | Exclusive upper bound |
| `multipleOf` | number > 0 | Value must be a multiple of this number |
| `enum` | array of numbers | Value must be one of the listed numbers |

### 4.2 Type reference property

```json
{
  "type":        "<TypeName>",
  "title":       "<string>",
  "description": "<string>"
}
```

Where `<TypeName>` is a type declared in this schema or an imported schema (using `<alias>.<TypeName>` syntax). The property accepts instances of the referenced type **or any concrete subtype** (polymorphic dispatch via discriminator).

### 4.3 Array property

```json
{
  "type":       "array",
  "items":      <PrimitiveProperty | TypeReferenceProperty>,
  "minItems":   <integer ≥ 0>,
  "maxItems":   <integer ≥ 0>,
  "uniqueItems": <boolean>,
  "title":       "<string>",
  "description": "<string>"
}
```

| Keyword | Required | Type | Description |
|---------|----------|------|-------------|
| `type` | yes | `"array"` | Marks this as an array property |
| `items` | yes | property def | Defines the item type (primitive or type reference) |
| `minItems` | no | integer ≥ 0 | Minimum array length |
| `maxItems` | no | integer ≥ 0 | Maximum array length |
| `uniqueItems` | no | boolean | If `true`, all items must be distinct |

---

## 5. Instance Format

An OOJS instance is a JSON object. Every instance of a non-abstract type must include the discriminator property:

```json
{
  "_type": "<TypeName>",
  ...
}
```

The discriminator value is:
- The `discriminatorValue` of the type (if overridden), otherwise
- The type's name as declared in the schema

Cross-schema instances use the qualified name: `"<alias>.<TypeName>"` or the full `$id`-prefixed form `"<schemaId>#<TypeName>"` (both must be supported by validators; the alias form requires the validator to have loaded the relevant schema).

---

## 6. Validation Rules

A validator checks an instance `I` against a type `T` as follows:

**Step 1 — Discriminator resolution**

1. Read the discriminator property from `I` (e.g., `I["_type"]`). Call this value `D`.
2. If `D` is absent: validation fails with "missing discriminator".
3. Resolve `D` to a type definition `C` in the schema registry.
4. If `C` is not found: validation fails with "unknown type `D`".
5. If `C` is abstract: validation fails with "type `D` is abstract and cannot be instantiated".
6. Verify that `C` is `T` or a descendant of `T`. If not: validation fails with "type `D` is not a subtype of `T`".

**Step 2 — Required properties**

7. Compute the effective required set of `C`: union of all `required` lists in the inheritance chain from the root to `C`.
8. For each name in the effective required set, verify it is present in `I`. If missing: validation fails with "missing required property `<name>`".

**Step 3 — Property validation**

9. For each key `k` in `I` (excluding the discriminator):
   - If `k` is not declared on `C` or any of its supertypes: validation fails with "unexpected property `k`" (if closed-world mode is active; skip this check in open-world mode).
   - Otherwise, validate `I[k]` against the property definition of `k` on `C` (or its supertype where declared).

**Step 4 — Property-level validation**

10. For primitive properties: check all declared constraints (minLength, minimum, pattern, etc.).
11. For type-reference properties: recursively apply validation (back to Step 1) with the property value as the new instance and the declared type as `T`.
12. For array properties: check minItems/maxItems/uniqueItems; validate each item.

---

## 7. Schema Registry and Imports

A **schema registry** is a map from schema `$id` URI to loaded schema. Validators maintain a registry to resolve cross-schema references.

Import resolution:

1. On loading a schema, read the `imports` map.
2. For each `alias → uri` entry, load the schema at `uri` and register it under the alias.
3. Type references of the form `<alias>.<TypeName>` are resolved by looking up the alias in the registry.
4. Circular imports (schema A imports schema B which imports schema A) are permitted but type definitions must not create circular inheritance chains.

---

## 8. Naming Rules

- **Type names** must start with an uppercase letter and contain only alphanumeric characters and underscores (`[A-Z][A-Za-z0-9_]*`).
- **Property names** must start with a lowercase letter or underscore and contain only alphanumeric characters and underscores (`[a-z_][A-Za-z0-9_]*`).
- **Schema aliases** follow the same rules as property names.
- Names are case-sensitive.

---

## 9. Reserved Keywords

The following strings are reserved and must not be used as type names or property names:

`array`, `string`, `integer`, `number`, `boolean`, `null`

---

## 10. Complete Example

### Schema: `clinical.oojs.json`

```json
{
  "$oojs": "1.0",
  "$id": "https://example.org/schemas/clinical",
  "title": "Clinical Entries",
  "discriminator": "_type",
  "types": {
    "ClinicalEntry": {
      "abstract": true,
      "title": "Clinical Entry",
      "description": "Base type for all clinical entries.",
      "properties": {
        "id":        { "type": "string", "minLength": 1 },
        "timestamp": { "type": "string", "format": "date-time" },
        "subjectId": { "type": "string" }
      },
      "required": ["id", "timestamp", "subjectId"]
    },

    "Observation": {
      "extends": "ClinicalEntry",
      "title": "Observation",
      "properties": {
        "code":  { "type": "string" },
        "value": { "type": "number" },
        "unit":  { "type": "string" }
      },
      "required": ["code", "value"]
    },

    "Diagnosis": {
      "extends": "ClinicalEntry",
      "properties": {
        "icdCode":     { "type": "string", "pattern": "^[A-Z][0-9]{2}(\\.[0-9]{1,4})?$" },
        "description": { "type": "string" },
        "certainty":   { "type": "string", "enum": ["confirmed", "probable", "possible"] }
      },
      "required": ["icdCode", "certainty"]
    },

    "Encounter": {
      "title": "Encounter",
      "properties": {
        "id":       { "type": "string" },
        "patientId":{ "type": "string" },
        "findings": {
          "type": "array",
          "items": { "type": "ClinicalEntry" },
          "minItems": 0
        }
      },
      "required": ["id", "patientId"]
    }
  }
}
```

### Valid instance

```json
{
  "_type": "Observation",
  "id": "obs-001",
  "timestamp": "2026-03-29T10:00:00Z",
  "subjectId": "patient-42",
  "code": "8480-6",
  "value": 120,
  "unit": "mmHg"
}
```

### Invalid instance (abstract type)

```json
{
  "_type": "ClinicalEntry",
  "id": "entry-001",
  "timestamp": "2026-03-29T10:00:00Z",
  "subjectId": "patient-42"
}
```
Error: `ClinicalEntry` is abstract and cannot be instantiated.

### Invalid instance (missing required inherited property)

```json
{
  "_type": "Diagnosis",
  "id": "dx-001",
  "icdCode": "J18.9",
  "certainty": "confirmed"
}
```
Error: missing required property `timestamp` (inherited from `ClinicalEntry`).

---

## 11. Comparison with JSON Schema

The following table shows the OOJS equivalent for common JSON Schema patterns:

| JSON Schema pattern | OOJS equivalent |
|---------------------|-----------------|
| `allOf` + `$ref` for inheritance | `"extends": "SuperType"` |
| Re-declared `type: object` in subtype | Not needed — implied by being a type definition |
| Re-declared `required` in subtype | Not needed — inherited automatically |
| `oneOf` + `discriminator` for polymorphism | Implicit — any type-reference property is polymorphic |
| Manual discriminator mapping | Not needed — resolved from `discriminator` + type name |
| `$defs` for named types | `types` map at schema root |
| `$ref` for type reference | `"type": "TypeName"` in property definition |
| No abstract concept | `"abstract": true` |

---

## 12. JSON Schema Compatibility Output

A conforming OOJS processor may emit equivalent JSON Schema (draft 2020-12). The mapping is:

- Each OOJS type → a `$defs` entry in the output
- `extends` → `allOf: [{ "$ref": "..." }, { "type": "object", "properties": {...} }]`
- `abstract: true` → `if/then` construction that rejects the discriminator value matching the type name (or left to implementation)
- Polymorphic type reference → `oneOf` over all concrete subtypes in the hierarchy
- Discriminator property → added explicitly to each type's `properties` with `const` equal to the type name
- Inherited `required` → merged into each subtype's `required` array
