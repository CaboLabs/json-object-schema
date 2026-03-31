# Object-Oriented JSON Schema (OOJS) Specification

**Version:** 1.0-draft
**Status:** Draft
**Date:** 2026-03-29

---

## Abstract

This document specifies the Object-Oriented JSON Schema (OOJS) language, version 1.0. OOJS is a JSON-based schema language for expressing object-oriented type hierarchies with single inheritance, abstract types, and polymorphic dispatch. It is designed to address the structural limitations of JSON Schema when modeling class hierarchies and to produce output compatible with JSON Schema draft 2020-12.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conventions and Terminology](#2-conventions-and-terminology)
3. [Data Model](#3-data-model)
4. [Schema Document](#4-schema-document)
5. [Type Definitions](#5-type-definitions)
6. [Property Definitions](#6-property-definitions)
7. [Discriminator](#7-discriminator)
8. [Instance Model](#8-instance-model)
9. [Validation](#9-validation)
10. [Schema Registry and Imports](#10-schema-registry-and-imports)
11. [Naming Rules](#11-naming-rules)
12. [Conformance](#12-conformance)
13. [JSON Schema Compatibility](#13-json-schema-compatibility)
14. [IANA Considerations](#14-iana-considerations)
15. [Security Considerations](#15-security-considerations)

---

## 1. Introduction

### 1.1 Motivation

JSON Schema [JSON-SCHEMA] is widely used for validating JSON documents. However, it offers no first-class support for object-oriented modeling concepts: inheritance, abstract types, and polymorphic dispatch require verbose workarounds using `allOf`, `oneOf`, and OpenAPI-vendor-extensions. These workarounds have well-documented failure modes:

- `additionalProperties: false` combined with `allOf`-based inheritance rejects subtype properties as "additional", requiring the `unevaluatedProperties` keyword (the most complex keyword in JSON Schema) to fix.
- `oneOf`-based polymorphism validates all branches sequentially (O(N) in the number of subtypes), producing unactionable error messages when validation fails.
- No mechanism exists to declare a type as abstract (non-instantiable).
- Inherited `required` constraints are not automatically propagated to subtypes.

OOJS provides a compact, formally specified alternative with these constructs as first-class concepts.

### 1.2 Design Principles

1. **Minimal syntax** — express OO constructs with the fewest keywords possible.
2. **Unambiguous semantics** — every schema has exactly one valid interpretation.
3. **O(1) polymorphic dispatch** — type identification via a discriminator field, not exhaustive branch matching.
4. **JSON Schema compatibility** — a conforming OOJS processor can emit equivalent JSON Schema 2020-12.
5. **JSON format** — schemas are valid JSON documents requiring no new parser.
6. **Decidable validation** — validation of any finite instance against any schema terminates.

### 1.3 Scope

This specification defines:
- The OOJS schema document format
- Type and property definition syntax
- Discriminator and polymorphic dispatch rules
- Instance validity conditions
- Cross-schema import and reference rules
- Mapping to JSON Schema 2020-12

Out of scope for v1.0:
- Multiple inheritance / mixin types
- Generics / parameterized types
- Property overriding / restriction in subtypes
- Cross-property invariants
- Binary or non-JSON encodings

---

## 2. Conventions and Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC2119].

**JSON**: The JavaScript Object Notation data interchange format, as specified in [RFC8259].

**JSON value**: One of: JSON object, JSON array, JSON string, JSON number, JSON boolean (`true` or `false`), or `null`.

**Schema**: A JSON document conforming to this specification that defines a set of named types.

**Type**: A named structural definition in a schema.

**Instance**: A JSON value being validated against a schema.

**Supertype**: A type from which another type inherits.

**Subtype**: A type that inherits from another type.

**Concrete type**: A type that is not abstract; instances may claim this type.

**Abstract type**: A type that cannot be directly instantiated; it serves only as a base for subtypes.

**Discriminator property**: A JSON object property that carries the type name of an instance.

**Validator**: A processor that checks an instance against a schema.

**Schema registry**: A collection of loaded schemas indexed by their `$id` URI.

**Effective required set**: For a type T, the union of all `required` arrays in T's inheritance chain (from root to T inclusive).

**Effective property set**: For a type T, the union of all `properties` maps in T's inheritance chain.

---

## 3. Data Model

### 3.1 Primitive Types

OOJS defines the following primitive types, aligned with the JSON type system:

| OOJS type | JSON representation | Notes |
|-----------|--------------------|----|
| `string`  | JSON string | Unicode (UTF-8) |
| `integer` | JSON number with no fractional part | Arbitrary precision |
| `number`  | JSON number | IEEE 754 double or arbitrary precision |
| `boolean` | `true` or `false` | |
| `null`    | `null` | |

A JSON number `42` is valid for both `integer` and `number`. A JSON number `42.5` is valid only for `number`.

### 3.2 Array Types

An array type is an ordered, homogeneous collection of values of a single item type. The item type may be a primitive type or a named type reference.

### 3.3 Type References

A type reference names a type defined in the current schema or in an imported schema. References are resolved by the schema registry at schema load time. A type reference in a property definition enables polymorphic dispatch: the property accepts instances of the referenced type or any concrete subtype thereof.

### 3.4 Type Hierarchy

Types within a schema form a type hierarchy — a forest of directed trees where each edge connects a subtype to its supertype. The following conditions MUST hold:

1. A type has at most one declared supertype (single inheritance).
2. The supertype relation is acyclic (no type is its own ancestor).
3. Abstract types may appear anywhere in the hierarchy.
4. Concrete types may extend abstract or concrete types.

---

## 4. Schema Document

### 4.1 Structure

An OOJS schema document MUST be a JSON object with the following members:

```
{
  "$oojs":        <string>,              REQUIRED
  "$id":          <string>,              REQUIRED
  "title":        <string>,              OPTIONAL
  "description":  <string>,              OPTIONAL
  "imports":      <object>,              OPTIONAL
  "discriminator": <string>,             OPTIONAL, default: "_type"
  "types":        <object>               REQUIRED
}
```

Additional members not defined in this specification SHOULD be ignored by conforming processors (open extension model at the document level).

### 4.2 `$oojs`

The value MUST be the string `"1.0"`. A processor that does not support the declared version MUST report a schema load error.

### 4.3 `$id`

The value MUST be a URI as defined in [RFC3986]. It MUST be unique within any schema registry. Two schemas with the same `$id` MUST NOT be loaded into the same registry simultaneously.

The `$id` URI SHOULD use the `https` scheme for publicly accessible schemas and MAY use any URI scheme for private schemas.

### 4.4 `imports`

When present, the value MUST be a JSON object whose:
- Keys are alias strings (see §11 for naming rules).
- Values are URI strings identifying schemas to import.

Example:
```json
"imports": {
  "core": "https://example.org/schemas/core",
  "fhir": "https://example.org/schemas/fhir-base"
}
```

An imported schema's types are accessible as `<alias>.<TypeName>` in property definitions and `extends` declarations.

### 4.5 `discriminator`

The discriminator property name used by this schema. MUST be a valid JSON string. The default value is `"_type"`.

The discriminator name MUST NOT collide with any property name declared in any type within the schema.

### 4.6 `types`

MUST be a JSON object with at least one member. Each key is a type name (see §11). Each value is a type definition object (see §5).

Type names MUST be unique within a schema.

---

## 5. Type Definitions

### 5.1 Structure

A type definition is a JSON object with the following members:

```
{
  "extends":            <string>,        OPTIONAL
  "abstract":           <boolean>,       OPTIONAL, default: false
  "discriminatorValue": <string>,        OPTIONAL
  "title":              <string>,        OPTIONAL
  "description":        <string>,        OPTIONAL
  "properties":         <object>,        OPTIONAL
  "required":           <array>,         OPTIONAL, default: []
}
```

A type definition with no `properties` and no `extends` is valid (an empty concrete type).

### 5.2 `extends`

When present, the value MUST be one of:
- A type name declared in the same schema: `"Animal"`
- A qualified type name from an imported schema: `"<alias>.<TypeName>"` (e.g., `"core.Entity"`)

The referenced type MUST exist in the schema registry. The `extends` relationship MUST NOT create a cycle.

**Semantics**: All properties and effective required set of the supertype are available on the subtype.

### 5.3 `abstract`

When `true`, no instance MAY claim this type as its discriminator value. The type serves only as a base for subtypes.

An abstract type MAY be used as the declared type of a property. In that case, only concrete subtypes of that abstract type are valid values for the property.

### 5.4 `discriminatorValue`

Overrides the discriminator value for this type. When absent, the discriminator value is the type name as declared in the `types` map.

For a type imported via alias, the discriminator value follows the same alias-qualified form unless overridden.

The discriminator value MUST be unique across all types in the combined registry (same schema + all imports). Two types with the same discriminator value MUST NOT appear in the same registry.

### 5.5 `properties`

A JSON object whose keys are property names (see §11) and values are property definitions (see §6).

The following conditions MUST hold:
- A property name MUST NOT be the same as the schema's discriminator property name.
- A property name declared in a type MUST NOT be the same as any property name in the type's effective property set (inherited from the supertype chain). Redeclaration is not permitted in v1.0.
- A property name MUST be unique within the type's own `properties` object.

### 5.6 `required`

An array of strings. Each string MUST be the name of a property declared in this type's own `properties` map. Listing inherited property names in a subtype's `required` is NOT permitted (they are already required if declared required in the parent).

The effective required set of a type T is computed as:

```
effectiveRequired(T) =
  if T has no supertype:
    T.required
  else:
    effectiveRequired(T.supertype) ∪ T.required
```

---

## 6. Property Definitions

A property definition is a JSON object whose `"type"` member determines its kind.

### 6.1 Primitive Property

```json
{
  "type":        "<primitive>",
  "title":       "<string>",
  "description": "<string>",
  <constraints>
}
```

Where `<primitive>` ∈ { `"string"`, `"integer"`, `"number"`, `"boolean"`, `"null"` }.

#### 6.1.1 String Constraints

| Keyword | Type | Constraint |
|---------|------|-----------|
| `minLength` | integer ≥ 0 | `len(value) >= minLength` (Unicode code points) |
| `maxLength` | integer ≥ 0 | `len(value) <= maxLength` |
| `pattern` | string | ECMA-262 regex; value must produce a match |
| `enum` | non-empty array of strings | value must equal one element |
| `format` | string | Semantic hint; informational in v1.0 |

When both `minLength` and `maxLength` are present, `minLength` MUST be ≤ `maxLength`.

#### 6.1.2 Number / Integer Constraints

| Keyword | Type | Constraint |
|---------|------|-----------|
| `minimum` | number | `value >= minimum` |
| `maximum` | number | `value <= maximum` |
| `exclusiveMinimum` | number | `value > exclusiveMinimum` |
| `exclusiveMaximum` | number | `value < exclusiveMaximum` |
| `multipleOf` | number > 0 | `value % multipleOf == 0` |
| `enum` | non-empty array of numbers | value must equal one element |

`minimum` and `exclusiveMinimum` MUST NOT both be present. `maximum` and `exclusiveMaximum` MUST NOT both be present.

When both a lower bound and upper bound are present, the lower bound MUST be less than the upper bound.

#### 6.1.3 Boolean and Null Constraints

No constraints are defined for `boolean` or `null` primitive types.

### 6.2 Type Reference Property

```json
{
  "type":        "<TypeName>",
  "title":       "<string>",
  "description": "<string>"
}
```

`<TypeName>` MUST resolve to a type in the schema registry. It MAY be:
- A name declared in the current schema: `"Animal"`
- A qualified name from an imported schema: `"core.Entity"`

**Polymorphism**: A type reference property is implicitly polymorphic. The property accepts any instance whose discriminator value resolves to the referenced type or any concrete subtype thereof.

### 6.3 Array Property

```json
{
  "type":        "array",
  "items":       <PrimitiveProperty | TypeReferenceProperty>,
  "minItems":    <integer ≥ 0>,
  "maxItems":    <integer ≥ 0>,
  "uniqueItems": <boolean>,
  "title":       "<string>",
  "description": "<string>"
}
```

| Keyword | Required | Notes |
|---------|----------|-------|
| `type` | REQUIRED | Must be `"array"` |
| `items` | REQUIRED | Item type definition (inline primitive or type ref) |
| `minItems` | OPTIONAL | Default: 0 |
| `maxItems` | OPTIONAL | Default: unbounded |
| `uniqueItems` | OPTIONAL | Default: `false` |

When both `minItems` and `maxItems` are present, `minItems` MUST be ≤ `maxItems`.

The `items` object MUST NOT itself be an array property (no nested arrays in v1.0).

---

## 7. Discriminator

### 7.1 Purpose

The discriminator is the mechanism by which a validator identifies the actual type of an instance when the declared property type is abstract or has concrete subtypes.

### 7.2 Discriminator Property

Every instance that is validated as a named type MUST include a property whose name matches the schema's `discriminator` value (default `"_type"`).

The discriminator property is implicitly part of every type's effective property set. Processors MUST treat it as a required, string-valued property. Validators MUST reject an instance that lacks the discriminator property.

### 7.3 Discriminator Value

For type `T`, the discriminator value is:
1. The value of `T.discriminatorValue` if present.
2. Otherwise, the key under which `T` is declared in the `types` map.

For types imported from another schema, the discriminator value defaults to `"<alias>.<TypeName>"`. This may be overridden by `discriminatorValue`.

### 7.4 Uniqueness

Discriminator values MUST be unique across the combined set of all types in all schemas loaded into the same registry. A registry loader MUST report an error if a collision is detected.

### 7.5 Dispatch Algorithm

Given an instance `I` and a target type `T`:

1. Read `I[discriminator]` → value `D`.
2. Locate type `C` in the registry where `C.discriminatorValue == D`.
3. Verify that `C` is `T` or a subtype of `T` (C appears in the subtree rooted at T in the type hierarchy).
4. Validate `I` against `C`.

The complexity of step 2 is O(1) when the registry indexes types by discriminator value (RECOMMENDED).

---

## 8. Instance Model

### 8.1 Instance

An OOJS instance is a JSON object. JSON arrays, strings, numbers, booleans, and `null` are not valid standalone instances (they may appear as property values).

### 8.2 Discriminator Presence

Every instance validated as a named type MUST include the discriminator property. Its value MUST be a JSON string.

### 8.3 Property Set

The valid properties of an instance of type C are:
- All properties in the effective property set of C (see §5.5).
- The discriminator property.

### 8.4 Closed-World Mode (default)

By default, OOJS operates in closed-world mode: a property present in the instance but not in C's effective property set causes a validation failure.

### 8.5 Open-World Mode

A schema MAY declare `"additionalProperties": true` at the schema level (not on individual types) to enable open-world mode. In open-world mode, unknown properties are silently ignored.

---

## 9. Validation

### 9.1 Entry Point

`validate(instance I, type T, registry R) → ValidationResult`

A `ValidationResult` is either `valid` or a non-empty list of `ValidationError` objects. Each `ValidationError` has:
- `path`: JSON Pointer [RFC6901] to the offending location in the instance.
- `code`: A machine-readable error code (see §9.7).
- `message`: A human-readable description.

### 9.2 Validation Algorithm

**Phase 1 — Discriminator resolution**

```
D = I[schema.discriminator]
if D is absent:
    error(path="/", code=MISSING_DISCRIMINATOR)
if D is not a string:
    error(path="/" + schema.discriminator, code=INVALID_DISCRIMINATOR_TYPE)
C = R.lookupByDiscriminatorValue(D)
if C is null:
    error(path="/" + schema.discriminator, code=UNKNOWN_TYPE, message="unknown type: D")
if C.abstract == true:
    error(path="/" + schema.discriminator, code=ABSTRACT_TYPE)
if not isSubtypeOf(C, T, R):
    error(path="/" + schema.discriminator, code=TYPE_MISMATCH,
          message="C is not a subtype of T")
```

**Phase 2 — Required properties**

```
for name in effectiveRequired(C):
    if name not in I:
        error(path="/", code=MISSING_REQUIRED, message="missing required property: name")
```

**Phase 3 — Property validation**

```
effectiveProps = effectivePropertySet(C)
for key in I:
    if key == schema.discriminator:
        continue
    if key not in effectiveProps:
        if schema.closedWorld:
            error(path="/" + key, code=ADDITIONAL_PROPERTY)
        else:
            continue
    propDef = effectiveProps[key]
    validateProperty(I[key], propDef, key, R)
```

**Phase 4 — Property-level validation (`validateProperty`)**

```
function validateProperty(value V, propertyDefinition P, path, registry R):
    if P.type == "array":
        if V is not a JSON array:
            error(path, code=TYPE_MISMATCH)
        if len(V) < P.minItems:
            error(path, code=ARRAY_TOO_SHORT)
        if P.maxItems defined and len(V) > P.maxItems:
            error(path, code=ARRAY_TOO_LONG)
        if P.uniqueItems == true and V contains duplicates:
            error(path, code=ARRAY_DUPLICATE_ITEMS)
        for i, item in V:
            validateProperty(item, P.items, path + "/" + i, R)

    else if P.type in PRIMITIVE_TYPES:
        validatePrimitive(V, P, path)

    else:  # type reference
        if V is not a JSON object:
            error(path, code=TYPE_MISMATCH)
        refType = R.lookupByName(P.type)
        validate(V, refType, R)   # recursive call (Phase 1–4)
```

### 9.3 Primitive Validation (`validatePrimitive`)

```
function validatePrimitive(value V, propertyDefinition P, path):
    expectedKind = kindOf(P.type)  # string/integer/number/boolean/null
    if not jsonKindMatches(V, expectedKind):
        error(path, code=TYPE_MISMATCH)
        return  # do not check further constraints on wrong type

    if P.type == "string":
        if P.minLength defined and unicodeLength(V) < P.minLength:
            error(path, code=STRING_TOO_SHORT)
        if P.maxLength defined and unicodeLength(V) > P.maxLength:
            error(path, code=STRING_TOO_LONG)
        if P.pattern defined and not regexMatch(P.pattern, V):
            error(path, code=PATTERN_MISMATCH)
        if P.enum defined and V not in P.enum:
            error(path, code=ENUM_MISMATCH)

    if P.type in ("integer", "number"):
        if P.minimum defined and V < P.minimum:
            error(path, code=BELOW_MINIMUM)
        if P.maximum defined and V > P.maximum:
            error(path, code=ABOVE_MAXIMUM)
        if P.exclusiveMinimum defined and V <= P.exclusiveMinimum:
            error(path, code=BELOW_EXCLUSIVE_MINIMUM)
        if P.exclusiveMaximum defined and V >= P.exclusiveMaximum:
            error(path, code=ABOVE_EXCLUSIVE_MAXIMUM)
        if P.multipleOf defined and V % P.multipleOf != 0:
            error(path, code=NOT_MULTIPLE_OF)
        if P.enum defined and V not in P.enum:
            error(path, code=ENUM_MISMATCH)

    if P.type == "integer":
        if V has fractional part:
            error(path, code=NOT_INTEGER)
```

### 9.4 Subtype Check

`isSubtypeOf(C, T, registry)` is true if and only if:
- `C` equals `T`, or
- `C.supertype` is defined and `isSubtypeOf(C.supertype, T, registry)` is true.

This check is O(depth of hierarchy) and terminates because the hierarchy is acyclic.

### 9.5 Effective Property Set

`effectivePropertySet(T)`:
- If T has no supertype: T.properties
- Else: effectivePropertySet(T.supertype) ∪ T.properties

Properties from the supertype take precedence in the union key set (subtype cannot re-declare; this is enforced at schema load time, not at validation time).

### 9.6 Validation Modes

A validator MUST support two modes:

- **Fail-fast**: Return after the first validation error.
- **Full**: Collect all validation errors before returning.

The default mode is RECOMMENDED to be full. Implementations SHOULD allow callers to choose.

### 9.7 Error Codes

| Code | Meaning |
|------|---------|
| `MISSING_DISCRIMINATOR` | Instance has no discriminator property |
| `INVALID_DISCRIMINATOR_TYPE` | Discriminator property value is not a string |
| `UNKNOWN_TYPE` | Discriminator value does not match any type in the registry |
| `ABSTRACT_TYPE` | Discriminator value refers to an abstract type |
| `TYPE_MISMATCH` | Value's JSON kind does not match the declared type |
| `MISSING_REQUIRED` | A required property is absent |
| `ADDITIONAL_PROPERTY` | An undeclared property is present (closed-world mode) |
| `STRING_TOO_SHORT` | String length is below `minLength` |
| `STRING_TOO_LONG` | String length is above `maxLength` |
| `PATTERN_MISMATCH` | String does not match `pattern` |
| `ENUM_MISMATCH` | Value is not in `enum` list |
| `BELOW_MINIMUM` | Number is below `minimum` |
| `ABOVE_MAXIMUM` | Number is above `maximum` |
| `BELOW_EXCLUSIVE_MINIMUM` | Number is not above `exclusiveMinimum` |
| `ABOVE_EXCLUSIVE_MAXIMUM` | Number is not below `exclusiveMaximum` |
| `NOT_MULTIPLE_OF` | Number is not a multiple of `multipleOf` |
| `NOT_INTEGER` | Number has a fractional part where integer is required |
| `ARRAY_TOO_SHORT` | Array length is below `minItems` |
| `ARRAY_TOO_LONG` | Array length is above `maxItems` |
| `ARRAY_DUPLICATE_ITEMS` | Array contains duplicate items but `uniqueItems` is true |

---

## 10. Schema Registry and Imports

### 10.1 Registry

A schema registry is a stateful store indexed by schema `$id` URI. Processors MUST maintain a registry for the lifetime of a validation session.

### 10.2 Loading

When loading a schema:

1. Parse the JSON document. If parsing fails, report a load error.
2. Validate the schema document structure against this specification (§4, §5, §6).
3. Check `$id` uniqueness in the registry. If already loaded, skip (idempotent) or error (strict mode).
4. Resolve `imports`: for each alias → URI, load the target schema (recursively) and register the alias mapping.
5. Resolve all `extends` references and type references within `properties`. Report unresolved references as load errors.
6. Build the type hierarchy. Detect and report cycles.
7. Check discriminator value uniqueness across all loaded schemas.
8. Index types by discriminator value (O(1) lookup).

### 10.3 Circular Imports

Two schemas MAY import each other (A imports B, B imports A) provided that:
- No type in A extends a type in B that extends a type back in A (no circular inheritance).
- The loader detects import cycles and does not enter infinite recursion (mark schemas as "loading in progress").

### 10.4 Cross-Schema Type References

A property of type `"core.Entity"` refers to the type named `Entity` in the schema loaded under the alias `core`. The discriminator value for that type is determined by the `core` schema's type definition (either `Entity` or the `discriminatorValue` override, prefixed with `core.` unless overridden).

---

## 11. Naming Rules

### 11.1 Type Names

Type names MUST match the regular expression: `[A-Z][A-Za-z0-9_]*`

Examples of valid type names: `Animal`, `Dog`, `ClinicalEntry`, `FHIR_Observation`

### 11.2 Property Names

Property names MUST match the regular expression: `[a-z_][A-Za-z0-9_]*`

Examples of valid property names: `name`, `icdCode`, `_internalRef`, `startTime`

### 11.3 Schema Aliases

Schema aliases MUST match the same regular expression as property names: `[a-z_][A-Za-z0-9_]*`

### 11.4 Reserved Type Names

The following strings MUST NOT be used as type names:

`array`, `string`, `integer`, `number`, `boolean`, `null`

These are reserved primitive type identifiers.

### 11.5 Case Sensitivity

All names are case-sensitive. `Animal` and `animal` are different identifiers.

---

## 12. Conformance

### 12.1 Conformance Levels

This specification defines two conformance levels:

**Conformance Level 1 — Core Validator**

A Core Validator:
- MUST load and parse OOJS schema documents per §4.
- MUST resolve `extends`, type references, and imports per §10.
- MUST validate instances per §9.
- MUST report all error codes defined in §9.7.
- MUST implement both fail-fast and full validation modes (§9.6).
- MUST support all primitive types and constraints (§6.1).
- MUST implement closed-world validation by default (§8.4).

**Conformance Level 2 — Compatible Processor**

A Compatible Processor:
- MUST satisfy all requirements of a Core Validator.
- MUST emit equivalent JSON Schema 2020-12 output for any OOJS schema (§13).
- The emitted JSON Schema MUST produce identical validation results for all instances that are valid OOJS instances.

### 12.2 Conformance Test Suite

Implementations MUST pass the official OOJS conformance test suite (to be published as a companion document). The test suite includes:
- Schema load tests (valid schemas, invalid schemas, error detection)
- Instance validation tests (valid instances, each error code triggered)
- Cross-schema import and reference tests
- Inheritance chain tests (depth ≥ 3)

---

## 13. JSON Schema Compatibility

A Compatible Processor (§12.1 Level 2) produces JSON Schema 2020-12 [JSON-SCHEMA] output according to the following mapping.

### 13.1 Schema Document → JSON Schema Root

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "<oojs.$id>",
  "title": "<oojs.title>",
  "description": "<oojs.description>",
  "$defs": { ... }
}
```

### 13.2 Type Definition → `$defs` Entry

For each type `T`:

```json
"T": {
  "type": "object",
  "title": "<T.title>",
  "description": "<T.description>",
  "properties": {
    "<discriminator>": { "type": "string", "const": "<T.discriminatorValue>" },
    <own properties of T>
  },
  "required": [ "<discriminator>", <effective required set of T> ],
  "unevaluatedProperties": false,
  "allOf": [ { "$ref": "#/$defs/<T.supertype>" } ]   // omit if no supertype
}
```

Notes:
- `unevaluatedProperties: false` is used (not `additionalProperties`) to correctly handle inherited properties.
- The discriminator property is emitted as a `const` to enable discriminated-union tooling.
- Inherited required fields are merged into the `required` array.

### 13.3 Abstract Types

Abstract types are marked with a JSON Schema `if`/`then`/`else` pattern that rejects instances whose discriminator equals the abstract type's own value:

```json
"ClinicalEntry": {
  "type": "object",
  "if": {
    "properties": { "_type": { "const": "ClinicalEntry" } },
    "required": ["_type"]
  },
  "then": { "not": {} },
  ...
}
```

Alternatively, processors MAY omit the abstract guard in the generated schema and rely on discriminated-union routing to never route to the abstract type directly. This is semantically equivalent when all subtypes are enumerated.

### 13.4 Polymorphic Type Reference → `oneOf` + `$ref`

A property `"type": "ClinicalEntry"` becomes:

```json
{
  "oneOf": [
    { "$ref": "#/$defs/Observation" },
    { "$ref": "#/$defs/Diagnosis" },
    { "$ref": "#/$defs/Procedure" }
  ],
  "discriminator": {
    "propertyName": "_type",
    "mapping": {
      "Observation": "#/$defs/Observation",
      "Diagnosis":   "#/$defs/Diagnosis",
      "Procedure":   "#/$defs/Procedure"
    }
  }
}
```

The `discriminator` object is emitted as an OpenAPI 3.x extension hint. Processors targeting pure JSON Schema 2020-12 MAY omit it.

---

## 14. IANA Considerations

### 14.1 Media Type

This specification registers the following media type:

- Type name: `application`
- Subtype name: `oojs+json`
- Required parameters: none
- Optional parameters: `version` (e.g., `version=1.0`)
- Encoding considerations: Same as `application/json` [RFC8259]
- File extension: `.oojs.json`

---

## 15. Security Considerations

### 15.1 Recursive Schemas

Schemas with recursive type references (a type that directly or indirectly has a property of its own type) are valid and common (e.g., tree structures). Validators MUST implement cycle detection in the instance being validated to avoid infinite recursion. A maximum recursion depth SHOULD be configurable.

### 15.2 Schema Injection

Schema `$id` URIs and import URIs are processed by schema loaders. Implementations that resolve URIs by fetching remote resources MUST:
- Restrict URI schemes to a configured allowlist (e.g., `https` only).
- Implement timeouts and size limits on remote schema fetches.
- Validate fetched content against this specification before trusting it.

### 15.3 Denial of Service via Large Schemas

An adversarially crafted schema with very deep inheritance chains or very large numbers of subtypes may cause O(N) or O(depth) operations to be expensive. Implementations SHOULD enforce limits on:
- Maximum inheritance depth (RECOMMENDED: 64)
- Maximum number of types per schema (RECOMMENDED: 1024)
- Maximum number of properties per type (RECOMMENDED: 256)

---

## References

### Normative References

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- **[RFC3986]** Berners-Lee, T., Fielding, R., and Masinter, L., "Uniform Resource Identifier (URI): Generic Syntax", RFC 3986, January 2005.
- **[RFC6901]** Bryan, P., Ed., Zyp, K., and Nottingham, M., Ed., "JavaScript Object Notation (JSON) Pointer", RFC 6901, April 2013.
- **[RFC8259]** Bray, T., Ed., "The JavaScript Object Notation (JSON) Data Interchange Format", RFC 8259, December 2017.
- **[JSON-SCHEMA]** Wright, A., Andrews, H., Hutton, B., "JSON Schema: A Media Type for Describing JSON Documents", draft-bhutton-json-schema-01, December 2020.

### Informative References

- **[OPENAPI]** OpenAPI Initiative, "OpenAPI Specification 3.1.0", February 2021.
- **[XSD]** W3C, "XML Schema Part 1: Structures Second Edition", October 2004.
- **[AVRO]** Apache Software Foundation, "Apache Avro Specification", 2023.
