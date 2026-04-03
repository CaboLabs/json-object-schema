# Object-Oriented JSON Schema (OOJS) Specification

**Version:** 1.0-draft
**Status:** Draft
**Date:** 2026-03-31

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
   - 8.1 [Instance](#81-instance)
   - 8.2 [Discriminator Presence](#82-discriminator-presence)
   - 8.3 [Property Set](#83-property-set)
   - 8.4 [Closed-World Mode (default)](#84-closed-world-mode-default)
   - 8.5 [Open-World Mode](#85-open-world-mode)
   - 8.6 [Object Relationships](#86-object-relationships)
   - 8.7 [Has-One and Has-Many](#87-has-one-and-has-many)
   - 8.8 [Vertical Relationships (Hierarchical / Embedded)](#88-vertical-relationships-hierarchical--embedded)
   - 8.9 [Horizontal Relationships (Non-Hierarchical / Reference by ID)](#89-horizontal-relationships-non-hierarchical--reference-by-id)
   - 8.10 [Choosing Between Vertical and Horizontal](#810-choosing-between-vertical-and-horizontal)
   - 8.11 [Unidirectional and Bidirectional Relationships](#811-unidirectional-and-bidirectional-relationships)
   - 8.12 [Graph Document Format](#812-graph-document-format)
   - 8.13 [Cycles in the Object Model](#813-cycles-in-the-object-model)
9. [Validation](#9-validation)
10. [Schema Registry and Imports](#10-schema-registry-and-imports)
11. [Naming Rules](#11-naming-rules)
12. [Conformance](#12-conformance)
13. [JSON Schema Compatibility](#13-json-schema-compatibility)
14. [IANA Considerations](#14-iana-considerations)
15. [Security Considerations](#15-security-considerations)

---

<a id="sec-1"></a>
## 1. Introduction

<a id="sec-1-1"></a>
### 1.1 Motivation

JSON Schema [JSON-SCHEMA] is widely used for validating JSON documents. However, it offers no first-class support for object-oriented modeling concepts: inheritance, abstract types, and polymorphic dispatch require verbose workarounds using `allOf`, `oneOf`, and OpenAPI-vendor-extensions. These workarounds have well-documented failure modes:

- `additionalProperties: false` combined with `allOf`-based inheritance rejects subtype properties as "additional", requiring the `unevaluatedProperties` keyword (the most complex keyword in JSON Schema) to fix.
- `oneOf`-based polymorphism validates all branches sequentially (O(N) in the number of subtypes), producing unactionable error messages when validation fails.
- No mechanism exists to declare a type as abstract (non-instantiable).
- Inherited `required` constraints are not automatically propagated to subtypes.
- JSON and JSON Schema assume all inter-object relationships are expressed through embedding: a child object is always nested inside its parent. This conflates two distinct OO concepts — composition (the parent owns the child) and association (the parent merely references an independently-existing object). Non-owning associations, where the referenced object has its own lifecycle and may be shared across multiple owners, cannot be expressed structurally in JSON without reducing the reference to an opaque identifier whose type and validity are invisible to the schema.

OOJS provides a compact, formally specified alternative with these constructs as first-class concepts.

<a id="sec-1-2"></a>
### 1.2 Design Principles

1. **Minimal syntax** — express OO constructs with the fewest keywords possible.
2. **Unambiguous semantics** — every schema has exactly one valid interpretation.
3. **O(1) polymorphic dispatch** — type identification via a discriminator field, not exhaustive branch matching.
4. **JSON Schema compatibility** — a conforming OOJS processor can emit equivalent JSON Schema 2020-12.
5. **JSON format** — schemas are valid JSON documents requiring no new parser.
6. **Decidable validation** — validation of any finite instance against any schema terminates.

<a id="sec-1-3"></a>
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

<a id="sec-2"></a>
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

<a id="sec-3"></a>
## 3. Data Model

<a id="sec-3-1"></a>
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

The primitive type names and the `integer`/`number` distinction are adopted directly from [JSON-SCHEMA]. The underlying JSON value types (`string`, `number`, `boolean`, `null`) are defined in [RFC8259].

<a id="sec-3-2"></a>
### 3.2 Array Types

An array type is an ordered, homogeneous collection of values of a single item type. The item type may be a primitive type or a named type reference. JSON arrays are defined in [RFC8259]; OOJS restricts them to a single item type (homogeneous arrays), which is a stricter constraint than JSON itself imposes.

<a id="sec-3-3"></a>
### 3.3 Type References

A type reference names a type defined in the current schema or in an imported schema. References are resolved by the schema registry at schema load time. A type reference in a property definition enables polymorphic dispatch: the property accepts instances of the referenced type or any concrete subtype thereof.

<a id="sec-3-4"></a>
### 3.4 Type Hierarchy

Types within a schema form a type hierarchy — a forest of directed trees where each edge connects a subtype to its supertype. The following conditions MUST hold:

1. A type has at most one declared supertype (single inheritance).
2. The supertype relation is acyclic (no type is its own ancestor).
3. Abstract types may appear anywhere in the hierarchy.
4. Concrete types may extend abstract or concrete types.

---

<a id="sec-4"></a>
## 4. Schema Document

<a id="sec-4-1"></a>
### 4.1 Structure

An OOJS schema document MUST be a JSON object with the following members:

```
{
  "$oojs":                <string>,      REQUIRED
  "$id":                  <string>,      REQUIRED
  "title":                <string>,      OPTIONAL
  "description":          <string>,      OPTIONAL
  "imports":              <object>,      OPTIONAL
  "discriminator":        <string>,      OPTIONAL, default: "_type"
  "additionalProperties": <boolean>,     OPTIONAL, default: false
  "types":                <object>       REQUIRED
}
```

The `title` and `description` fields are adopted from [JSON-SCHEMA] with the same semantics: they are human-readable annotations and do not affect validation.

`additionalProperties: false` (the default) enables closed-world validation: properties not declared in the effective property set are rejected (see [§8.4](#sec-8-4)). `additionalProperties: true` enables open-world mode: undeclared properties are silently ignored (see [§8.5](#sec-8-5)). This field applies to all types in the schema. Individual types cannot override it in v1.0.

Additional members not defined in this specification SHOULD be ignored by conforming processors (open extension model at the document level).

<a id="sec-4-2"></a>
### 4.2 `$oojs`

The value MUST be the string `"1.0"`. A processor that does not support the declared version MUST report a schema load error.

<a id="sec-4-3"></a>
### 4.3 `$id`

The value MUST be a URI as defined in [RFC3986]. It MUST be unique within any schema registry. Two schemas with the same `$id` MUST NOT be loaded into the same registry simultaneously.

The `$id` URI SHOULD use the `https` scheme for publicly accessible schemas and MAY use any URI scheme for private schemas.

<a id="sec-4-4"></a>
### 4.4 `imports`

When present, the value MUST be a JSON object whose:
- Keys are alias strings (see [§11](#sec-11) for naming rules).
- Values are URI strings identifying schemas to import.

Example:
```json
"imports": {
  "core": "https://example.org/schemas/core",
  "fhir": "https://example.org/schemas/fhir-base"
}
```

An imported schema's types are accessible as `<alias>.<TypeName>` in property definitions and `extends` declarations.

<a id="sec-4-5"></a>
### 4.5 `discriminator`

The discriminator property name used by this schema. MUST be a valid JSON string. The default value is `"_type"`.

The discriminator name MUST NOT be the same as any property name declared in any type within the schema (see also [§5.5](#sec-5-5)).

<a id="sec-4-6"></a>
### 4.6 `types`

MUST be a JSON object with at least one member. Each key is a type name (see [§11](#sec-11)). Each value is a type definition object (see [§5](#sec-5)).

Type names MUST be unique within a schema.

---

<a id="sec-5"></a>
## 5. Type Definitions

<a id="sec-5-1"></a>
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

<a id="sec-5-2"></a>
### 5.2 `extends`

When present, the value MUST be one of:
- A type name declared in the same schema: `"Animal"`
- A qualified type name from an imported schema: `"<alias>.<TypeName>"` (e.g., `"core.Entity"`)

The referenced type MUST exist in the schema registry. The `extends` relationship MUST NOT create a cycle.

**Semantics**: All properties and effective required set of the supertype are available on the subtype.

<a id="sec-5-3"></a>
### 5.3 `abstract`

When `true`, no instance MAY claim this type as its discriminator value. The type serves only as a base for subtypes.

An abstract type MAY be used as the declared type of a property. In that case, only concrete subtypes of that abstract type are valid values for the property.

<a id="sec-5-4"></a>
### 5.4 `discriminatorValue`

Overrides the discriminator value for this type. When absent, the discriminator value defaults to the type name as declared in the `types` map (or `"<alias>.<TypeName>"` for imported types; see [§7.3](#sec-7-3)).

The discriminator value MUST be unique across all types in the combined registry (same schema + all imports). Two types with the same discriminator value MUST NOT appear in the same registry (see [§7.4](#sec-7-4) for the uniqueness rule and [§10.2](#sec-10-2) for when it is enforced).

<a id="sec-5-5"></a>
### 5.5 `properties`

A JSON object whose keys are property names (see [§11](#sec-11)) and values are property definitions (see [§6](#sec-6)). The keyword `properties` is adopted from [JSON-SCHEMA] with the same meaning: a map from property name to property definition. Unlike [JSON-SCHEMA], OOJS does not allow property re-declaration across the inheritance chain.

The following conditions MUST hold:
- A property name MUST NOT be the same as the schema's discriminator property name.
- A property name declared in a type MUST NOT be the same as any property name in the type's effective property set (inherited from the supertype chain). Redeclaration is not permitted in v1.0.
- A property name MUST be unique within the type's own `properties` object.

<a id="sec-5-6"></a>
### 5.6 `required`

An array of strings. Each string MUST be the name of a property declared in this type's own `properties` map. Listing inherited property names in a subtype's `required` is NOT permitted (they are already required if declared required in the parent).

The keyword `required` is adopted from [JSON-SCHEMA]. The key difference is that in OOJS `required` lists only properties declared on this specific type; inherited required constraints are automatically propagated through the `effectiveRequired` computation (see [§9.5](#sec-9-5)) rather than being repeated in subtype definitions.

The effective required set of a type T is computed as:

```
effectiveRequired(T) =
  if T has no supertype:
    T.required
  else:
    effectiveRequired(T.supertype) ∪ T.required
```

---

<a id="sec-6"></a>
## 6. Property Definitions

A property definition is a JSON object whose kind is determined by one of two mutually exclusive keywords:

- **`"type"`** — present in `PrimitiveProperty`, `TypeRefProperty`, and `ArrayProperty`.
- **`"refType"`** — present exclusively in `IdRefProperty`.

A property definition MUST contain exactly one of `"type"` or `"refType"`. A definition that contains both or neither is a schema error.

<a id="sec-6-1"></a>
### 6.1 Primitive Property

```json
{
  "type":        "<primitive>",
  "title":       "<string>",
  "description": "<string>",
  <constraints>
}
```

Where `<primitive>` ∈ { `"string"`, `"integer"`, `"number"`, `"boolean"`, `"null"` }. These type names are the same as in [JSON-SCHEMA]. The `title` and `description` fields are adopted from [JSON-SCHEMA] as human-readable annotations.

<a id="sec-6-1-1"></a>
#### 6.1.1 String Constraints

All string constraint keywords are adopted from [JSON-SCHEMA] with identical semantics and the same type requirements.

| Keyword | Type | Constraint | JSON Schema ref |
|---------|------|-----------|----------------|
| `minLength` | integer ≥ 0 | `len(value) >= minLength` (Unicode code points) | [JSON-SCHEMA §6.3.1](https://json-schema.org/draft/2020-12/json-schema-validation.html#section-6.3.1) |
| `maxLength` | integer ≥ 0 | `len(value) <= maxLength` | [JSON-SCHEMA §6.3.2](https://json-schema.org/draft/2020-12/json-schema-validation.html#section-6.3.2) |
| `pattern` | string | ECMA-262 [ECMA-262] regex; value must produce a match | [JSON-SCHEMA §6.3.3](https://json-schema.org/draft/2020-12/json-schema-validation.html#section-6.3.3) |
| `enum` | non-empty array of strings | value must equal one element | [JSON-SCHEMA §6.1.2](https://json-schema.org/draft/2020-12/json-schema-validation.html#section-6.1.2) |
| `format` | string | Semantic hint; informational in v1.0 | [JSON-SCHEMA §7.3](https://json-schema.org/draft/2020-12/json-schema-validation.html#section-7.3) |

String length is measured in Unicode code points, consistent with [JSON-SCHEMA]. The `pattern` value MUST be a valid ECMA-262 [ECMA-262] regular expression.

When both `minLength` and `maxLength` are present, `minLength` MUST be ≤ `maxLength`.

<a id="sec-6-1-2"></a>
#### 6.1.2 Number / Integer Constraints

All numeric constraint keywords are adopted from [JSON-SCHEMA] with identical semantics.

| Keyword | Type | Constraint | JSON Schema ref |
|---------|------|-----------|----------------|
| `minimum` | number | `value >= minimum` | [JSON-SCHEMA §6.2.4](https://json-schema.org/draft/2020-12/json-schema-validation.html#section-6.2.4) |
| `maximum` | number | `value <= maximum` | [JSON-SCHEMA §6.2.2](https://json-schema.org/draft/2020-12/json-schema-validation.html#section-6.2.2) |
| `exclusiveMinimum` | number | `value > exclusiveMinimum` | [JSON-SCHEMA §6.2.5](https://json-schema.org/draft/2020-12/json-schema-validation.html#section-6.2.5) |
| `exclusiveMaximum` | number | `value < exclusiveMaximum` | [JSON-SCHEMA §6.2.3](https://json-schema.org/draft/2020-12/json-schema-validation.html#section-6.2.3) |
| `multipleOf` | number > 0 | `value % multipleOf == 0` | [JSON-SCHEMA §6.2.1](https://json-schema.org/draft/2020-12/json-schema-validation.html#section-6.2.1) |
| `enum` | non-empty array of numbers | value must equal one element | [JSON-SCHEMA §6.1.2](https://json-schema.org/draft/2020-12/json-schema-validation.html#section-6.1.2) |

`minimum` and `exclusiveMinimum` MUST NOT both be present. `maximum` and `exclusiveMaximum` MUST NOT both be present.

When both a lower bound and upper bound are present, the lower bound MUST be less than the upper bound.

<a id="sec-6-1-3"></a>
#### 6.1.3 Boolean and Null Constraints

No constraints are defined for `boolean` or `null` primitive types. This is consistent with [JSON-SCHEMA], which also defines no validation keywords specific to these types.

<a id="sec-6-2"></a>
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

<a id="sec-6-3"></a>
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

The keywords `items`, `minItems`, `maxItems`, and `uniqueItems` are adopted from [JSON-SCHEMA §6.4](https://json-schema.org/draft/2020-12/json-schema-validation.html#section-6.4) with identical semantics.

| Keyword | Required | Notes | JSON Schema ref |
|---------|----------|-------|----------------|
| `type` | REQUIRED | Must be `"array"` | — |
| `items` | REQUIRED | Item type definition (inline primitive or type ref) | [JSON-SCHEMA §10.3.1.2](https://json-schema.org/draft/2020-12/json-schema-core.html#section-10.3.1.2) |
| `minItems` | OPTIONAL | Default: 0 | [JSON-SCHEMA §6.4.2](https://json-schema.org/draft/2020-12/json-schema-validation.html#section-6.4.2) |
| `maxItems` | OPTIONAL | Default: unbounded | [JSON-SCHEMA §6.4.3](https://json-schema.org/draft/2020-12/json-schema-validation.html#section-6.4.3) |
| `uniqueItems` | OPTIONAL | Default: `false` | [JSON-SCHEMA §6.4.1](https://json-schema.org/draft/2020-12/json-schema-validation.html#section-6.4.1) |

When both `minItems` and `maxItems` are present, `minItems` MUST be ≤ `maxItems`.

The `items` object MUST NOT itself be an array property (no nested arrays in v1.0).

The `items` object MAY be an `IdRefProperty` (see [§6.4](#sec-6-4)), in which case each array element is a string ID rather than an embedded object.

<a id="sec-6-4"></a>
### 6.4 Id Reference Property

```json
{
  "refType":     "<TypeName>",
  "title":       "<string>",
  "description": "<string>",
  "minLength":   <integer ≥ 0>,
  "maxLength":   <integer ≥ 0>,
  "pattern":     "<string>"
}
```

An `IdRefProperty` declares a **typed horizontal reference**: the property value in a JSON instance is a string identifier that refers to an instance of `<TypeName>` stored outside the current document (or elsewhere in a graph document). The schema records the target type explicitly; the validator checks the string value but does NOT validate the referenced object.

`<TypeName>` follows the same resolution rules as `type` in [§6.2](#sec-6-2):
- A name declared in the current schema: `"Car"`
- A qualified name from an imported schema: `"fleet.Car"`

The target type MUST exist in the schema registry. Unresolved `refType` references are reported as load errors, exactly like unresolved `type` references (see [§10.2](#sec-10-2) step 5).

**String constraints** from [§6.1.1](#sec-6-1-1) (`minLength`, `maxLength`, `pattern`) MAY be applied to constrain the format of the ID string. `enum` is intentionally excluded — individual ID values are application data, not schema-level constants.

**Has-many via `refType`**: an array whose items are `IdRefProperty` expresses a typed has-many horizontal relationship. Each array element is a string ID:

```json
"cars": {
  "type":  "array",
  "items": { "refType": "Car" }
}
```

A valid instance value: `"cars": ["car-001", "car-002"]`

**Rationale**: without `IdRefProperty`, a horizontal relationship can only be expressed as a plain `{ "type": "string" }` property. This loses the target type from the schema, forces an `xxxId` naming convention that diverges from the OO model, and prevents tooling from understanding the relationship. `IdRefProperty` keeps the OO property name, records the target type, and still validates only the string ID.

---

<a id="sec-7"></a>
## 7. Discriminator

<a id="sec-7-1"></a>
### 7.1 Purpose

The discriminator is the mechanism by which a validator identifies the actual type of an instance when the declared property type is abstract or has concrete subtypes.

<a id="sec-7-2"></a>
### 7.2 Discriminator Property

Every instance that is validated as a named type MUST include a property whose name matches the schema's `discriminator` value (default `"_type"`).

The discriminator property is implicitly part of every type's effective property set. Processors MUST treat it as a required, string-valued property. Validators MUST reject an instance that lacks the discriminator property.

<a id="sec-7-3"></a>
### 7.3 Discriminator Value

For type `T`, the discriminator value is:
1. The value of `T.discriminatorValue` if present.
2. Otherwise, the key under which `T` is declared in the `types` map.

For types imported from another schema, the discriminator value defaults to `"<alias>.<TypeName>"`. This may be overridden by `discriminatorValue`.

<a id="sec-7-4"></a>
### 7.4 Uniqueness

Discriminator values MUST be unique across the combined set of all types in all schemas loaded into the same registry. A registry loader MUST report an error if a collision is detected.

<a id="sec-7-5"></a>
### 7.5 Dispatch Algorithm

Given an instance `I` and a target type `T`:

1. Read `I[discriminator]` → value `D`. If absent or not a string, report an error and stop.
2. Locate type `C` in the registry where `C.discriminatorValue == D`. If not found, report `UNKNOWN_TYPE`.
3. Verify that `C` is not abstract. If `C.abstract == true`, report `ABSTRACT_TYPE`.
4. Verify that `C` is `T` or a subtype of `T` (C appears in the subtree rooted at T in the type hierarchy). If not, report `TYPE_MISMATCH`.
5. Validate `I` against `C`.

The complexity of step 2 is O(1) when the registry indexes types by discriminator value (RECOMMENDED).

---

<a id="sec-8"></a>
## 8. Instance Model

<a id="sec-8-1"></a>
### 8.1 Instance

An OOJS instance is a JSON object. JSON arrays, strings, numbers, booleans, and `null` are not valid standalone instances (they may appear as property values).

<a id="sec-8-2"></a>
### 8.2 Discriminator Presence

Every instance validated as a named type MUST include the discriminator property. Its value MUST be a JSON string.

<a id="sec-8-3"></a>
### 8.3 Property Set

The valid properties of an instance of type C are:
- All properties in the effective property set of C (see [§5.5](#sec-5-5)).
- The discriminator property.

<a id="sec-8-4"></a>
### 8.4 Closed-World Mode (default)

By default, OOJS operates in closed-world mode: a property present in the instance but not in C's effective property set causes a validation failure.

<a id="sec-8-5"></a>
### 8.5 Open-World Mode

A schema MAY declare `"additionalProperties": true` at the schema level (see [§4.1](#sec-4-1)) to enable open-world mode. In open-world mode, properties present in an instance but not declared in the type's effective property set are silently ignored rather than rejected.

The `additionalProperties` field is a schema-level setting; it applies uniformly to all types in the schema and cannot be overridden per type in v1.0. When absent it defaults to `false` (closed-world). The validation algorithm refers to this as `schema.closedWorld`, where `closedWorld` is `true` when `additionalProperties` is `false` (the default) and `false` when `additionalProperties` is `true`.

---

<a id="sec-8-6"></a>
### 8.6 Object Relationships

OOJS types can be associated with one another in ways that go beyond inheritance. A **relationship** is a runtime connection between instances of two types. Relationships are expressed through property definitions ([§6](#sec-6)) and fall along two independent axes:

- **Cardinality**: how many instances of the associated type are involved (has-one or has-many).
- **Structure**: whether the associated instance is embedded inside the owning instance (vertical) or referenced by identifier from a separate location (horizontal).

These axes are orthogonal: any combination of cardinality and structure is valid.

The type hierarchy ([§3.4](#sec-3-4)) describes what a type *is*. Relationships describe what a type *has*. The two concepts are independent: a `Dog` IS-A `Animal` (inheritance); an `Encounter` HAS-MANY `ClinicalEntry` values (relationship).

---

<a id="sec-8-7"></a>
### 8.7 Has-One and Has-Many

**Has-one** — the owning type holds a reference to exactly one instance of the associated type (or a concrete subtype thereof). In OOJS, has-one is expressed as a type reference property ([§6.2](#sec-6-2)) or a string property holding an ID ([§8.9](#sec-8-9)).

**Has-many** — the owning type holds zero or more instances of the associated type. In OOJS, has-many is expressed as an array property ([§6.3](#sec-6-3)) whose `items` is either a type reference (for embedded objects) or a primitive string type (for ID references).

The `minItems` and `maxItems` constraints on an array property ([§6.3](#sec-6-3)) allow a schema author to further restrict cardinality — for example, `"minItems": 1` expresses a "has-one-or-more" constraint, and equal `minItems` and `maxItems` express an exact count.

| Cardinality | OOJS representation |
|-------------|---------------------|
| Has-one (vertical) | TypeRefProperty: `"b": { "type": "B" }` |
| Has-many (vertical) | ArrayProperty with TypeRef items: `"bs": { "type": "array", "items": { "type": "B" } }` |
| Has-one (horizontal) | IdRefProperty: `"b": { "refType": "B" }` |
| Has-many (horizontal) | ArrayProperty with IdRef items: `"bs": { "type": "array", "items": { "refType": "B" } }` |

A plain `{ "type": "string" }` property MAY still be used for horizontal references whose target type is not modelled in the schema (opaque/external IDs). `IdRefProperty` is RECOMMENDED whenever the target type is known.

---

<a id="sec-8-8"></a>
### 8.8 Vertical Relationships (Hierarchical / Embedded)

A **vertical relationship** (also called *hierarchical* or *composition*) embeds the associated object directly inside the owning object's JSON representation. In this relationship, the embedded instance:

- carries its own discriminator property and is fully validated by the OOJS validator as part of its owner's validation;
- exists only within the scope of its owner's JSON document;
- has no independent identity within that document (though it MAY carry an application-level identifier as a plain property).

> **Note — this is a property of the relationship, not the type.** The target type definition is not restricted to vertical use. The same type MAY also appear as the target of a horizontal relationship declared by a different source type ([§8.9](#sec-8-9)). The choice between vertical and horizontal belongs to each individual property declaration, not to the target type itself.

**Has-one vertical** — expressed as a TypeRefProperty ([§6.2](#sec-6-2)):

```json
"Motor": {
  "properties": {
    "horsepower": { "type": "number", "minimum": 1 },
    "cylinders":  { "type": "integer", "minimum": 1 }
  },
  "required": ["horsepower", "cylinders"]
},
"Car": {
  "properties": {
    "make":  { "type": "string" },
    "model": { "type": "string" },
    "motor": { "type": "Motor" }
  },
  "required": ["make", "model", "motor"]
}
```

A valid `Car` instance embeds the `Motor` object directly:

```json
{
  "_type": "Car",
  "make":  "Acme",
  "model": "Roadster",
  "motor": { "_type": "Motor", "horsepower": 220, "cylinders": 4 }
}
```

**Has-many vertical (polymorphic)** — expressed as an ArrayProperty ([§6.3](#sec-6-3)) whose item type is abstract, accepting any concrete subtype:

```json
"Encounter": {
  "properties": {
    "id":       { "type": "string" },
    "findings": {
      "type":  "array",
      "items": { "type": "ClinicalEntry" }
    }
  },
  "required": ["id"]
}
```

A valid `Encounter` instance embeds mixed-type `ClinicalEntry` subtypes inline:

```json
{
  "_type": "Encounter",
  "id":    "enc-001",
  "findings": [
    { "_type": "Observation", "id": "obs-001", "timestamp": "...", "subjectId": "p-1", "code": "8480-6", "value": 120 },
    { "_type": "Diagnosis",   "id": "dx-001",  "timestamp": "...", "subjectId": "p-1", "icdCode": "J18.9", "certainty": "confirmed" }
  ]
}
```

Each item in the array is validated independently by the discriminator dispatch algorithm ([§7.5](#sec-7-5)). This is the primary mechanism for polymorphic collections in OOJS.

**Characteristics of vertical relationships:**

- The validator enforces the full structure of every embedded object automatically.
- The entire object graph is self-contained in one JSON document.
- Embedded objects do not need a globally unique identifier (though they MAY have one).
- Appropriate for **ownership/composition**: when the embedded object's lifecycle is tied to its owner in this specific relationship.
- Not appropriate for a property whose value must be independently shareable across multiple owners — use a horizontal relationship for that property instead.

---

<a id="sec-8-9"></a>
### 8.9 Horizontal Relationships (Non-Hierarchical / Reference by ID)

A **horizontal relationship** (also called *non-hierarchical* or *association by reference*) stores only an opaque identifier that points to an associated object. In this relationship, the associated object is NOT embedded in the JSON; it resides in a separate location (another document, a database row, an API response).

> **Note — this is a property of the relationship, not the type.** The target type definition is not restricted to horizontal use. The same type MAY also appear as the target of a vertical (embedded) relationship declared by a different source type ([§8.8](#sec-8-8)). The choice between horizontal and vertical belongs to each individual property declaration, not to the target type itself.

**Has-one horizontal** — expressed as an `IdRefProperty` ([§6.4](#sec-6-4)):

```json
"Car": {
  "properties": {
    "carId": { "type": "string" },
    "make":  { "type": "string" },
    "model": { "type": "string" },
    "owner": { "refType": "Person" }
  },
  "required": ["carId", "make", "model", "owner"]
}
```

A valid `Car` instance carries the owner's ID string, not the owner's full object:

```json
{
  "_type": "Car",
  "carId": "car-001",
  "make":  "Acme",
  "model": "Roadster",
  "owner": "person-007"
}
```

The property is named `owner` (matching the OO model's `owner: Person` declaration), not `ownerId`. The target type `Person` is explicit in the schema; the validator confirms the value is a string and does not follow the reference.

**Has-many horizontal** — expressed as an array with `IdRefProperty` items:

```json
"Fleet": {
  "properties": {
    "fleetId": { "type": "string" },
    "name":    { "type": "string" },
    "cars":    { "type": "array", "items": { "refType": "Car" } },
    "persons": { "type": "array", "items": { "refType": "Person" } }
  },
  "required": ["fleetId", "name"]
}
```

A valid `Fleet` instance holds only IDs; the `Car` and `Person` objects are fetched separately:

```json
{
  "_type":   "Fleet",
  "fleetId": "fleet-001",
  "name":    "City Fleet",
  "cars":    ["car-001", "car-002", "car-003"],
  "persons": ["person-007", "person-008"]
}
```

**Characteristics of horizontal relationships:**

- OOJS validates only the structural type of the ID property (it is a string); referential integrity — whether the referenced object actually exists — is outside the scope of this specification and MUST be enforced by the application layer.
- In this relationship, the associated object is treated as having an independent lifecycle; it can be updated, transferred, or deleted without affecting the owner's JSON document.
- The same object instance can be referenced by multiple owners simultaneously (many-to-many patterns).
- The JSON document remains small even when many objects are associated.
- Appropriate for **associations**: when, in the context of this specific relationship, the referenced object exists independently and may be shared.

> **Important — validation coverage**: Because a horizontal relationship stores only a string ID, the OOJS validator never inspects or validates the structure of the referenced object — it only confirms the ID property is a string. If the same target type is also used in a vertical relationship elsewhere in the schema, those embedded instances ARE fully validated. The same type therefore has different validation coverage depending on which relationship style each source type chooses. This is by design; schema authors should account for it.

> **Note — same-document references**: The referenced objects in a horizontal relationship do not have to reside in a separate document or data store. When it is useful to serialize a complete object graph in one JSON file, the **Graph Document format** ([§8.12](#sec-8-12)) allows referenced objects to be co-located in the same document and linked via `{ "$ref-id": "<id>" }` expressions instead of bare ID strings. This preserves object independence (no embedding) while enabling atomic transport and validation of the whole graph.

---

<a id="sec-8-10"></a>
### 8.10 Choosing Between Vertical and Horizontal

The following guidelines assist schema authors in selecting the appropriate relationship style **for each individual property declaration**. They are advisory, not normative.

These questions are evaluated **per relationship** (i.e., per property on the source type), not as a global classification of the target type. The same target type may give different answers depending on which source type is declaring the relationship and for what purpose.

| Question (evaluate for this specific relationship) | Vertical (embed) | Horizontal (ID ref) |
|----------|-----------------|---------------------|
| In this relationship, does the associated instance have an independent identity? | No → embed | Yes → reference |
| Can the same instance be referenced by multiple owners simultaneously? | No → embed | Yes → reference |
| Must the entire graph be validated in one pass? | Yes → embed | No → reference |
| Is the document size a concern with large collections? | No → embed | Yes → reference |
| Is referential integrity enforced by the schema? | Yes (automatically) | No (application responsibility) |
| Does the associated object outlive its owner in this relationship? | No → embed | Yes → reference |

**Mixing styles freely — including for the same target type.** A single schema may freely mix vertical and horizontal relationships, and the same target type MAY be used in both styles by different source types. For example, a schema might declare:

- `Car` embeds `Motor` vertically — the motor has no existence outside this car instance.
- `ServiceRecord` references `Motor` horizontally by ID — the motor is an independently-existing entity that the service record points to.

Both relationships are valid in the same schema. `Motor` is not locked into one style. Each source type (`Car`, `ServiceRecord`) independently decides how it relates to `Motor` based on the semantics of that particular relationship.

**What MUST NOT be done**: a source type MUST NOT mix vertical and horizontal in the same property. A property is either a TypeRefProperty (vertical) or a string property (horizontal) — not both. The choice is made once, per property, at schema definition time.

---

<a id="sec-8-11"></a>
### 8.11 Unidirectional and Bidirectional Relationships

<a id="sec-8-11-1"></a>
#### 8.11.1 Definitions

A relationship between types A and B has a **direction**: the side that holds the reference is called the **source** and the side being pointed to is called the **target**.

- A **unidirectional relationship** is navigable in one direction only. The source type declares a property that references the target, but the target type declares no corresponding back-reference. Navigation from target back to source requires a separate query or index maintained by the application.

- A **bidirectional relationship** is navigable in both directions. Both types declare properties that reference each other, forming a pair of complementary references. Either side can be used as a starting point to reach the other.

Directionality is a schema design choice, not a constraint enforced by OOJS. The validator treats each property independently; it has no knowledge of whether two properties in different types are intended to form a bidirectional pair.

<a id="sec-8-11-2"></a>
#### 8.11.2 Unidirectional Relationships

In a unidirectional relationship, only one type declares the reference.

**Example — unidirectional horizontal has-one**: `Invoice` references its `Customer` by ID. `Customer` has no knowledge of its invoices.

```json
"Customer": {
  "properties": {
    "customerId": { "type": "string" },
    "name":       { "type": "string" }
  },
  "required": ["customerId", "name"]
},
"Invoice": {
  "properties": {
    "invoiceId":  { "type": "string" },
    "amount":     { "type": "number", "minimum": 0 },
    "customerId": {
      "type":        "string",
      "description": "UNIDIRECTIONAL HAS-ONE HORIZONTAL → Customer. Navigate: Invoice → Customer. No back-reference on Customer."
    }
  },
  "required": ["invoiceId", "amount", "customerId"]
}
```

Instances:

```json
{ "_type": "Customer", "customerId": "cust-1", "name": "Acme Corp" }

{ "_type": "Invoice", "invoiceId": "inv-001", "amount": 450.00, "customerId": "cust-1" }
```

To find all invoices for a given customer the application must query for `Invoice` instances where `customerId` equals the customer's ID. The schema alone does not express this navigation path.

**Characteristics of unidirectional relationships:**

- Simpler schema — only one property to declare and maintain.
- The target type is unaware it is being referenced; it can be updated independently without touching the reference-holder type.
- No consistency to enforce between the two ends — there is only one end.
- Suitable when navigation is needed in only one direction, or when the target type is shared across many schemas (avoiding coupling).

<a id="sec-8-11-3"></a>
#### 8.11.3 Bidirectional Relationships

In a bidirectional relationship, both types declare properties that reference each other. This allows navigation from either end without a secondary lookup.

**Example — bidirectional horizontal has-one / has-many**: `Person` holds a list of car IDs (`carIds`); `Car` holds a single owner ID (`ownerId`). Both sides reference the other.

```json
"Person": {
  "properties": {
    "personId": { "type": "string" },
    "name":     { "type": "string" },
    "carIds": {
      "type":  "array",
      "items": { "type": "string" },
      "description": "BIDIRECTIONAL HAS-MANY HORIZONTAL ↔ Car. This is the inverse side: navigate Person → [Car]."
    }
  },
  "required": ["personId", "name"]
},
"Car": {
  "properties": {
    "carId":   { "type": "string" },
    "make":    { "type": "string" },
    "ownerId": {
      "type":        "string",
      "description": "BIDIRECTIONAL HAS-ONE HORIZONTAL ↔ Person. This is the owning side: navigate Car → Person."
    }
  },
  "required": ["carId", "make", "ownerId"]
}
```

Instances (showing both sides of the same relationship):

```json
{ "_type": "Person", "personId": "person-1", "name": "Alice", "carIds": ["car-1", "car-2"] }

{ "_type": "Car", "carId": "car-1", "make": "Acme", "ownerId": "person-1" }
{ "_type": "Car", "carId": "car-2", "make": "ZipCar", "ownerId": "person-1" }
```

**Consistency in bidirectional relationships** — OOJS validates each instance independently and does not cross-check the two ends of a bidirectional pair. The following inconsistent state passes OOJS validation without error:

```json
{ "_type": "Person", "personId": "person-1", "name": "Alice", "carIds": ["car-1"] }

{ "_type": "Car", "carId": "car-1", "make": "Acme", "ownerId": "person-2" }
```

Here `Person` claims to own `car-1` but `Car` claims its owner is `person-2`. OOJS reports no validation error because each object is individually structurally valid. **Maintaining bidirectional consistency is the application's responsibility.** Schema authors SHOULD document which side is considered authoritative (the *owning side*) when the two ends disagree.

**Owning side convention**: In horizontal bidirectional relationships it is RECOMMENDED to designate one side as the owning side — the side whose property is the authoritative source of truth for the relationship. By convention:

- For has-one / has-many pairs, the "many" side (the one with the foreign key scalar) is typically the owning side (`Car.ownerId` in the example above).
- For many-to-many pairs, either side may be chosen; the choice SHOULD be documented in the schema's `description` fields.

**Example — bidirectional vertical has-many / unidirectional back-reference**: A vertical relationship (embedded array) can carry a back-reference ID on the embedded object to make it navigable in both directions, even though the embedded object cannot literally point to its container.

```json
"Report": {
  "properties": {
    "reportId": { "type": "string" },
    "sections": {
      "type":  "array",
      "items": { "type": "Section" },
      "description": "HAS-MANY VERTICAL (owning side): Sections are embedded in the Report."
    }
  },
  "required": ["reportId", "sections"]
},
"Section": {
  "properties": {
    "sectionId": { "type": "string" },
    "title":     { "type": "string" },
    "reportId": {
      "type":        "string",
      "description": "BACK-REFERENCE (horizontal): the ID of the Report this Section belongs to, stored redundantly to enable navigation from Section → Report without parsing the full Report document."
    }
  },
  "required": ["sectionId", "title", "reportId"]
}
```

A valid `Report` with back-references embedded in each `Section`:

```json
{
  "_type":    "Report",
  "reportId": "rpt-001",
  "sections": [
    { "_type": "Section", "sectionId": "sec-001", "title": "Introduction", "reportId": "rpt-001" },
    { "_type": "Section", "sectionId": "sec-002", "title": "Findings",     "reportId": "rpt-001" }
  ]
}
```

As before, OOJS does not verify that `section.reportId` matches the ID of the enclosing `Report`. That invariant is enforced by the application.

**Characteristics of bidirectional relationships:**

- Navigation is possible from either side without a secondary query.
- Both ends must be kept in sync when the relationship changes — this is an application responsibility.
- One side should be designated the *owning side* to resolve conflicts and guide update logic.
- Not applicable to vertical relationships in their pure form (an embedded object cannot hold a JSON reference to its container object); a back-reference ID on the embedded object approximates bidirectionality for horizontal navigation.

<a id="sec-8-11-4"></a>
#### 8.11.4 Summary Table

| | Unidirectional | Bidirectional |
|---|---|---|
| Properties declared | One side only | Both sides |
| Navigation | Source → Target only | Either direction |
| Consistency to maintain | None (single source of truth) | Application must keep both ends in sync |
| Schema complexity | Lower | Higher |
| Coupling between types | Weaker | Stronger |
| OOJS enforcement | N/A | None — each object is validated independently |
| Applicable to vertical? | Yes (normal case) | Back-reference ID only (not pure embedding) |
| Applicable to horizontal? | Yes | Yes |

---

<a id="sec-8-12"></a>
### 8.12 Graph Document Format

A **graph document** is a single JSON file that contains multiple interconnected OOJS instances. Rather than storing one object per file, a graph document collects a set of objects and their inter-references within one JSON envelope, enabling a complete object graph to be serialized, transported, and validated atomically.

<a id="sec-8-12-1"></a>
#### 8.12.1 Motivation

In horizontal relationships ([§8.9](#sec-8-9)), referenced objects normally reside outside the current JSON document — in a separate file, database row, or API response. However, it is often useful to serialize a complete object graph into one document without embedding every object vertically inside a single root. Vertical embedding ([§8.8](#sec-8-8)) would either duplicate shared objects or force an arbitrary nesting hierarchy. The graph document format avoids both problems:

- Each object retains its independent identity via a `$id` field.
- References between objects use `{ "$ref-id": "<id>" }` — typed and navigable, but not embedded.
- Shared objects are stored exactly once regardless of how many other objects reference them.
- The entire graph can be validated and transmitted as a single unit.

<a id="sec-8-12-2"></a>
#### 8.12.2 Document Structure

A graph document is a JSON object with the following top-level fields:

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `$oojs` | Yes | string | OOJS version string (e.g. `"1.0"`). The same version as the schema's `$oojs` field ([§4.2](#sec-4-2)); both refer to the OOJS specification version. |
| `roots` | Yes | array | Entry-point objects of the graph. Every object MUST have a `$id` and `$type`. |
| `objects` | No | object | Map of `"$id" → object` for non-root objects. When absent it is treated as empty. |

`$id` values MUST be unique across the entire graph document — including both `roots` and `objects`. A `$ref-id` MAY target any object regardless of whether it appears in `roots` or `objects`.

Example — two employees sharing one department:

```json
{
  "$oojs": "1.0",
  "roots": [
    {
      "$type": "Employee",
      "$id": "emp-alice",
      "name": "Alice",
      "employeeId": "E-001",
      "department": { "$ref-id": "dept-eng" }
    },
    {
      "$type": "Employee",
      "$id": "emp-bob",
      "name": "Bob",
      "employeeId": "E-002",
      "department": { "$ref-id": "dept-eng" }
    }
  ],
  "objects": {
    "dept-eng": {
      "$type": "Department",
      "$id": "dept-eng",
      "name": "Engineering"
    }
  }
}
```

Both `emp-alice` and `emp-bob` reference the same `dept-eng` object. The Department object is stored once and shared — a pattern that cannot be expressed with pure vertical embedding, which would require duplicating the embedded object in every parent.

<a id="sec-8-12-3"></a>
#### 8.12.3 Object Identity Fields

Every object within a graph document carries two OOJS-reserved metadata fields:

| Field | Description |
|-------|-------------|
| `$type` | The type name of this object, as registered in the schema. **In graph documents the discriminator key is always the literal string `$type`**, regardless of the schema's `discriminator` setting (which applies only to standalone instances). |
| `$id` | Graph-scoped unique identifier for this object; used as the target of `$ref-id` references. |

`$id` values MUST be unique within the graph document. They are opaque string labels; they do not need to match any persistent storage key, but SHOULD correspond to the object's domain identifier when one exists (e.g., a database primary key or a slug).

> **`$id` naming note**: The `$id` field on a graph-document object is a graph-scoped identity label. It is unrelated to the `$id` field on a schema document ([§4.3](#sec-4-3)), which is a schema URI. The two `$id` fields appear in different contexts and are never confused by a processor.

<a id="sec-8-12-4"></a>
#### 8.12.4 References — `$ref-id`

A reference to another object within the same graph document is expressed as a JSON object containing exactly one field:

```json
{ "$ref-id": "dept-eng" }
```

A `$ref-id` expression MAY appear in any property position where a TypeRef (`{ "type": "SomeType" }` in the schema) is expected. The value MUST be the `$id` of an object that appears in either `roots` or `objects` within the same graph document.

Schema definition corresponding to the employee example above:

```json
"Employee": {
  "properties": {
    "employeeId": { "type": "string" },
    "name":       { "type": "string" },
    "department":  { "type": "Department" }
  },
  "required": ["employeeId", "name", "department"]
},
"Department": {
  "properties": {
    "name": { "type": "string" }
  },
  "required": ["name"]
}
```

When validating a graph document, a `{ "$ref-id": "dept-eng" }` value in `Employee.department` is resolved to the `Department` object with `"$id": "dept-eng"` and validated against the `Department` type definition.

<a id="sec-8-12-5"></a>
#### 8.12.5 Validation of Graph Documents

Validation of a graph document proceeds in two passes:

**Pass 1 — Reference resolution**: Build an index of all objects in `roots` (and `objects` if present) keyed by their `$id`. A `$ref-id` may target any object in `roots` or `objects`. Verify that every `$ref-id` target exists in the index; emit `UNRESOLVED_REFERENCE` ([§9.7](#sec-9-7)) errors for any that do not.

**Pass 2 — Per-object validation**: For each object in `roots` (and `objects` if present), in any order:

1. Read `$type` to determine the type name, then look up the corresponding type definition in the schema registry. If `$type` is absent or the type is unknown, emit the appropriate error and skip this object.
2. Construct a synthetic standalone instance by copying the object, replacing `$type` with the schema's discriminator key (e.g., `"_type": "Employee"` if the schema's discriminator is `"_type"`), and removing `$id`. This synthetic instance is what the standard validation algorithm ([§9.2](#sec-9-2)) receives.
3. Before invoking [§9.2](#sec-9-2), substitute each `$ref-id` expression in the synthetic instance's properties: look up the target object in the index and type-check it against the property's declared TypeRef type. Do **not** recursively re-validate the target object inline — it will be (or has been) validated independently in this same Pass 2 loop. This approach makes cycle handling implicit: no visited-set tracking is required.
4. Run the standard validation algorithm ([§9.2](#sec-9-2)) on the synthetic instance.
5. Report errors with paths that identify the object by `$id` and position (e.g. `roots[0]/$id=emp-alice/department`).

Cross-object consistency (bidirectional pairs, referential completeness) remains the application's responsibility, as it is in standalone-instance validation.

<a id="sec-8-12-6"></a>
#### 8.12.6 Comparison with Other Serialization Styles

| Style | Objects per document | References | Embedding | Shared objects |
|-------|---------------------|------------|-----------|----------------|
| Standalone instances | One | Bare ID strings | No | N/A |
| Vertical (embedded) | One root + owned children | N/A | Yes (deep nesting) | No — duplicated per parent |
| Graph document | Many | `{ "$ref-id": "..." }` | No | Yes — stored once, referenced many times |

Use a graph document when:
- The domain model contains shared objects (many-to-many or fan-out relationships).
- Atomic validation of the whole graph is required.
- Avoiding duplication of embedded objects is important.
- The full graph needs to be transmitted in one payload.

Use standalone instances (with bare ID strings) when:
- Objects are retrieved and validated independently (API pagination, lazy loading).
- The associated objects live in a separate data store.
- Graph completeness at document level is not required.

---

<a id="sec-8-13"></a>
### 8.13 Cycles in the Object Model

A **cycle** (also called a loop or circular reference) occurs when a chain of relationships leads back to a type or object that already appeared in the chain. OOJS explicitly permits cycles at both the schema level and the instance level.

<a id="sec-8-13-1"></a>
#### 8.13.1 Cycles in the Schema (Class Model)

A cycle in the schema arises when the type-reference chain in *property definitions* contains a type that references itself, directly or indirectly:

- **Self-referential**: `Employee.manager` is a TypeRef to `Employee`. An employee can have a manager who is also an employee.
- **Two-type cycle**: `Employee.department` is a TypeRef to `Department`, and `Department.head` is a TypeRef to `Employee`. Each type references the other.
- **N-type cycle**: `A.b` → `B`, `B.c` → `C`, `C.a` → `A`. The chain closes after N hops.

> **Important distinction**: [§3.4](#sec-3-4) prohibits cycles in the *inheritance* (`extends`) chain — a type must not be its own ancestor. That prohibition does not apply to TypeRef properties. TypeRef properties form a directed graph that may contain cycles; the `extends` relation forms a directed forest (no cycles). These two graphs are independent.

These are all valid OOJS schemas. A schema parser processes only the type *names* (strings) when loading type definitions; it never expands a TypeRef recursively during loading. As a result schema loading always terminates regardless of how many cycles the type graph contains.

```json
"Employee": {
  "properties": {
    "employeeId": { "type": "string" },
    "name":       { "type": "string" },
    "manager":    { "type": "Employee" }
  },
  "required": ["employeeId", "name"]
},
"Department": {
  "properties": {
    "departmentId": { "type": "string" },
    "name":         { "type": "string" },
    "head":         { "type": "Employee" }
  },
  "required": ["departmentId", "name"]
}
```

The `Employee ↔ Department` cycle above is perfectly valid. Both types load without error; the TypeRef strings are resolved only at validation time.

<a id="sec-8-13-2"></a>
#### 8.13.2 Cycles in Graph Document Instances

In a graph document ([§8.12](#sec-8-12)), objects are connected by `$ref-id` references. Those references can form cycles in the instance data as well:

```json
{
  "$oojs": "1.0",
  "roots": [
    {
      "$type": "Employee",
      "$id":   "emp-alice",
      "employeeId": "E-001",
      "name":  "Alice",
      "manager": { "$ref-id": "emp-bob" }
    }
  ],
  "objects": {
    "emp-bob": {
      "$type": "Employee",
      "$id":   "emp-bob",
      "employeeId": "E-002",
      "name":  "Bob",
      "manager": { "$ref-id": "emp-alice" }
    }
  }
}
```

Here Alice's manager is Bob and Bob's manager is Alice — a two-node cycle. Longer cycles (A → B → C → A) are equally valid.

OOJS validators MUST handle cycles in graph document instances without entering an infinite loop. Cycle safety is achieved structurally by the validation algorithm ([§8.12.5](#sec-8-12-5) Pass 2): each object in the graph is validated exactly once in the top-level loop, and `$ref-id` expressions are only type-checked against their target's `$type` — the target object is never re-validated inline. Because no recursive traversal of `$ref-id` references occurs during validation, cycles require no visited-set tracking and impose no special handling. Validation terminates in O(N) time where N is the number of objects in the graph, regardless of cycle depth or count.

> **Note**: cycles are only possible in horizontal relationships ([§8.9](#sec-8-9)) and graph documents. Vertical (embedded) relationships cannot form cycles because JSON itself cannot represent a value that contains itself — a JSON value tree is always a DAG.

<a id="sec-8-13-3"></a>
#### 8.13.3 Cycles in Standalone Instances

In standalone instances that use bare ID strings for horizontal references ([§8.9](#sec-8-9)), no object traversal occurs during validation — the validator checks only that the ID property is a string of the correct type. Cycles therefore have no special meaning and require no special handling: each instance is validated independently without following any references.

---

<a id="sec-9"></a>
## 9. Validation

<a id="sec-9-1"></a>
### 9.1 Entry Point

`validate(instance I, type T, registry R) → ValidationResult`

A `ValidationResult` is either `valid` or a non-empty list of `ValidationError` objects. Each `ValidationError` has:
- `path`: JSON Pointer [RFC6901] to the offending location in the instance.
- `code`: A machine-readable error code (see [§9.7](#sec-9-7)).
- `message`: A human-readable description.

<a id="sec-9-2"></a>
### 9.2 Validation Algorithm

**Phase 1 — Discriminator resolution**

Paths in error objects follow JSON Pointer [RFC6901] syntax. The root of the instance is represented by the empty string `""`. A property `foo` at the root is `"/foo"`.

```
D = I[schema.discriminator]
if D is absent:
    error(path="", code=MISSING_DISCRIMINATOR)
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
        error(path="/" + name, code=MISSING_REQUIRED, message="missing required property: name")
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
    if P is IdRefProperty:          # refType — typed horizontal reference
        if V is not a string:
            error(path, code=TYPE_MISMATCH)
            return
        if P.minLength defined and unicodeLength(V) < P.minLength:
            error(path, code=STRING_TOO_SHORT)
        if P.maxLength defined and unicodeLength(V) > P.maxLength:
            error(path, code=STRING_TOO_LONG)
        if P.pattern defined and not regexMatch(P.pattern, V):
            error(path, code=PATTERN_MISMATCH)
        return   # do NOT follow the reference; do NOT validate the target object

    else if P.type == "array":
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

    else:  # TypeRefProperty — embedded type reference
        if V is not a JSON object:
            error(path, code=TYPE_MISMATCH)
        refType = P.resolvedType   # resolved at load time
        validate(V, refType, R)   # recursive call (Phase 1–4)
```

<a id="sec-9-3"></a>
### 9.3 Primitive Validation (`validatePrimitive`)

All constraint checks in this section correspond directly to the validation keywords adopted from [JSON-SCHEMA] ([§6.1](#sec-6-1) String Constraints, [§6.1.2](#sec-6-1-2) Numeric Constraints). String length is measured in Unicode code points as specified in [JSON-SCHEMA §6.3.2](https://json-schema.org/draft/2020-12/json-schema-validation.html#section-6.3.2)–6.3.3. The `pattern` keyword uses ECMA-262 [ECMA-262] regular expression syntax, matching the behaviour defined in [JSON-SCHEMA §6.3.3](https://json-schema.org/draft/2020-12/json-schema-validation.html#section-6.3.3).

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

<a id="sec-9-4"></a>
### 9.4 Subtype Check

`isSubtypeOf(C, T, registry)` is true if and only if:
- `C` equals `T`, or
- `C.supertype` is defined and `isSubtypeOf(C.supertype, T, registry)` is true.

This check is O(depth of hierarchy) and terminates because the hierarchy is acyclic.

<a id="sec-9-5"></a>
### 9.5 Effective Property Set

`effectivePropertySet(T)`:
- If T has no supertype: T.properties
- Else: effectivePropertySet(T.supertype) ∪ T.properties

The union is well-defined because [§5.5](#sec-5-5) prohibits a subtype from re-declaring a property already declared in any ancestor. This constraint is enforced at schema load time; the validator may assume no key collisions exist in the effective property set.

<a id="sec-9-6"></a>
### 9.6 Validation Modes

A validator MUST support two modes:

- **Fail-fast**: Return after the first validation error.
- **Full**: Collect all validation errors before returning.

The default mode is RECOMMENDED to be full. Implementations SHOULD allow callers to choose.

<a id="sec-9-7"></a>
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
| `UNRESOLVED_REFERENCE` | A `$ref-id` value in a graph document does not match any `$id` in the same document ([§8.12.5](#sec-8-12-5)) |

---

<a id="sec-10"></a>
## 10. Schema Registry and Imports

<a id="sec-10-1"></a>
### 10.1 Registry

A schema registry is a stateful store indexed by schema `$id` URI. Processors MUST maintain a registry for the lifetime of a validation session.

<a id="sec-10-2"></a>
### 10.2 Loading

When loading a schema:

1. Parse the JSON document. If parsing fails, report a load error.
2. Validate the schema document structure against this specification ([§4](#sec-4), [§5](#sec-5), [§6](#sec-6)).
3. Check `$id` uniqueness in the registry. If already loaded, skip (idempotent) or error (strict mode). See **Note** below.
4. Resolve `imports`: for each alias → URI, load the target schema (recursively) and register the alias mapping.
5. Resolve all `extends` references, `type` references (TypeRefProperty), and `refType` references (IdRefProperty) within `properties`. Report unresolved references as load errors.
6. Build the type hierarchy. Detect and report cycles.
7. Check discriminator value uniqueness across all loaded schemas.
8. Index types by discriminator value (O(1) lookup).

> **Note — $id collision behaviour**: Step 3 allows two strategies. Idempotent mode (skip if already loaded) is the RECOMMENDED default because it allows schemas to be loaded in any order without tracking dependencies. Strict mode (error on duplicate) is valid but places the ordering burden on the caller. What MUST NOT happen in either mode is silently replacing an already-registered schema with a different schema that shares its `$id` — this would invalidate previously resolved type references and produce undefined validator behaviour. Implementations SHOULD document which mode they implement.

<a id="sec-10-3"></a>
### 10.3 Circular Imports

Two schemas MAY import each other (A imports B, B imports A) provided that:
- No type in A extends a type in B that extends a type back in A (no circular inheritance).
- The loader detects import cycles and does not enter infinite recursion (mark schemas as "loading in progress").

<a id="sec-10-4"></a>
### 10.4 Cross-Schema Type References

A property of type `"core.Entity"` refers to the type named `Entity` in the schema loaded under the alias `core`. The discriminator value for that type follows the rule in [§7.3](#sec-7-3): if the `core` schema's `Entity` type definition sets `discriminatorValue`, that value is used as-is; otherwise the discriminator value defaults to `"core.Entity"` (the alias followed by a dot followed by the type name as declared in the source schema). The prefix used is the **local alias** as declared in the importing schema's `imports` map, not any canonical prefix from the source schema.

---

<a id="sec-11"></a>
## 11. Naming Rules

<a id="sec-11-1"></a>
### 11.1 Type Names

Type names MUST match the regular expression: `[A-Z][A-Za-z0-9_]*`

Examples of valid type names: `Animal`, `Dog`, `ClinicalEntry`, `FHIR_Observation`

<a id="sec-11-2"></a>
### 11.2 Property Names

Property names MUST match the regular expression: `[a-z_][A-Za-z0-9_]*`

Examples of valid property names: `name`, `icdCode`, `_internalRef`, `startTime`

<a id="sec-11-3"></a>
### 11.3 Schema Aliases

Schema aliases MUST match the same regular expression as property names: `[a-z_][A-Za-z0-9_]*`

<a id="sec-11-4"></a>
### 11.4 Reserved Type Names

The following strings MUST NOT be used as type names:

`array`, `string`, `integer`, `number`, `boolean`, `null`

These are reserved primitive type identifiers. Although the type name regex ([§11.1](#sec-11-1)) already requires an uppercase first character and therefore structurally excludes all of these lowercase strings, they are listed here explicitly to document the reserved set and to guard against any future extension that might relax the regex.

<a id="sec-11-5"></a>
### 11.5 Case Sensitivity

All names are case-sensitive. `Animal` and `animal` are different identifiers.

---

<a id="sec-12"></a>
## 12. Conformance

<a id="sec-12-1"></a>
### 12.1 Conformance Levels

This specification defines two conformance levels:

**Conformance Level 1 — Core Validator**

A Core Validator:
- MUST load and parse OOJS schema documents per [§4](#sec-4).
- MUST resolve `extends`, type references, and imports per [§10](#sec-10).
- MUST validate instances per [§9](#sec-9).
- MUST report all error codes defined in [§9.7](#sec-9-7).
- MUST implement both fail-fast and full validation modes ([§9.6](#sec-9-6)).
- MUST support all primitive types and constraints ([§6.1](#sec-6-1)).
- MUST implement closed-world validation by default ([§8.4](#sec-8-4)).
- MUST support open-world mode (`additionalProperties: true`) per [§8.5](#sec-8-5).
- MUST validate graph documents per [§8.12](#sec-8-12).

**Conformance Level 2 — Compatible Processor**

A Compatible Processor:
- MUST satisfy all requirements of a Core Validator.
- MUST emit equivalent JSON Schema 2020-12 output for any OOJS schema ([§13](#sec-13)).
- The emitted JSON Schema MUST produce identical validation results for all instances that are valid OOJS instances.

<a id="sec-12-2"></a>
### 12.2 Conformance Test Suite

Implementations MUST pass the official OOJS conformance test suite (to be published as a companion document). The test suite includes:
- Schema load tests (valid schemas, invalid schemas, error detection)
- Instance validation tests (valid instances, each error code triggered)
- Cross-schema import and reference tests
- Inheritance chain tests (depth ≥ 3)

---

<a id="sec-13"></a>
## 13. JSON Schema Compatibility

A Compatible Processor ([§12.1](#sec-12-1) Level 2) produces JSON Schema 2020-12 [JSON-SCHEMA] output according to the following mapping.

<a id="sec-13-1"></a>
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

<a id="sec-13-2"></a>
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

<a id="sec-13-3"></a>
### 13.3 Abstract Types

Abstract types are marked with a JSON Schema `if`/`then` pattern that rejects instances whose discriminator equals the abstract type's own value:

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

In this pattern, `"not": {}` always fails (since `{}` always validates to true), causing any instance that claims `_type: "ClinicalEntry"` to be rejected. An `else` branch is not needed — instances that do not match the `if` condition are not affected by the `then`.

Alternatively, processors MAY omit the abstract guard in the generated schema and rely on discriminated-union routing to never route to the abstract type directly. This is semantically equivalent when all subtypes are enumerated.

<a id="sec-13-4"></a>
### 13.4 Polymorphic Type Reference → `oneOf` + `$ref`

A property `"type": "ClinicalEntry"` (where `ClinicalEntry` has concrete subtypes `Observation`, `Diagnosis`, and `Procedure`) becomes:

```json
{
  "oneOf": [
    { "$ref": "#/$defs/Observation" },
    { "$ref": "#/$defs/Diagnosis" },
    { "$ref": "#/$defs/Procedure" }
  ]
}
```

The `oneOf` list includes all concrete subtypes of `ClinicalEntry` known at generation time. The emitted JSON Schema is valid for the closed set of schemas loaded when the Compatible Processor runs; adding new subtypes in a later schema load requires re-generating the JSON Schema output.

Processors targeting OpenAPI 3.x tooling MAY additionally emit a `discriminator` object as a hint for tooling that supports it:

```json
{
  "oneOf": [ ... ],
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

The `discriminator` object is an OpenAPI 3.x extension [OPENAPI] and is not part of JSON Schema 2020-12. Emitting it does not affect the JSON Schema validity of the output document; it is purely advisory for OpenAPI tooling.

<a id="sec-13-5"></a>
### 13.5 Id Reference Property → `{ "type": "string" }`

An `IdRefProperty` (`refType`) maps to a JSON Schema string property. The `refType` target type name has no JSON Schema equivalent — it is OOJS metadata used for type-checking at schema load time and for tooling. String constraints (`minLength`, `maxLength`, `pattern`) are emitted directly.

Example OOJS:
```json
"owner": { "refType": "Person", "minLength": 1 }
```

Emitted JSON Schema:
```json
"owner": { "type": "string", "minLength": 1 }
```

The target type annotation (`Person`) is intentionally dropped in the JSON Schema output because JSON Schema has no concept of typed string references. Tooling that needs the target type MUST consume the OOJS schema directly rather than the derived JSON Schema.

---

<a id="sec-14"></a>
## 14. IANA Considerations

<a id="sec-14-1"></a>
### 14.1 Media Type

This specification registers the following media type:

- Type name: `application`
- Subtype name: `oojs+json`
- Required parameters: none
- Optional parameters: `version` (e.g., `version=1.0`)
- Encoding considerations: Same as `application/json` [RFC8259]
- File extension: `.oojs.json`

---

<a id="sec-15"></a>
## 15. Security Considerations

<a id="sec-15-1"></a>
### 15.1 Recursive Schemas and Cycle Safety

Schemas with recursive type references — where a type directly or indirectly has a property of its own type — are valid and common (e.g., tree structures, self-referential hierarchies).

For **standalone instances** ([§8.1](#sec-8-1)), the JSON value is always a finite tree; there is no mechanism for a JSON value to contain itself. Recursive validation of TypeRef properties therefore always terminates naturally with the depth of nesting in the instance.

For **graph documents** ([§8.12](#sec-8-12)), instance cycles are possible via `$ref-id` references. The validation algorithm in [§8.12.5](#sec-8-12-5) handles cycles safely without any visited-set tracking: each object is validated exactly once in Pass 2, and `$ref-id` targets are type-checked but not recursively re-validated inline. Implementations that deviate from this architecture and instead traverse `$ref-id` references recursively during validation MUST implement cycle detection (a visited set of `$id` values) to avoid infinite loops.

A maximum nesting depth for recursive TypeRef validation SHOULD be configurable in implementations that process standalone instances with deeply nested embedded objects.

<a id="sec-15-2"></a>
### 15.2 Schema Injection

Schema `$id` URIs and import URIs are processed by schema loaders. Implementations that resolve URIs by fetching remote resources MUST:
- Restrict URI schemes to a configured allowlist (e.g., `https` only).
- Implement timeouts and size limits on remote schema fetches.
- Validate fetched content against this specification before trusting it.

<a id="sec-15-3"></a>
### 15.3 Denial of Service via Large Schemas

An adversarially crafted schema with very deep inheritance chains or very large numbers of subtypes may cause O(N) or O(depth) operations to be expensive. Implementations SHOULD enforce limits on:
- Maximum inheritance depth (RECOMMENDED: 64)
- Maximum number of types per schema (RECOMMENDED: 1024)
- Maximum number of properties per type (RECOMMENDED: 256)

---

## References

### Normative References

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997. <https://www.rfc-editor.org/rfc/rfc2119>
- **[RFC3986]** Berners-Lee, T., Fielding, R., and Masinter, L., "Uniform Resource Identifier (URI): Generic Syntax", RFC 3986, January 2005. <https://www.rfc-editor.org/rfc/rfc3986>
- **[RFC6901]** Bryan, P., Ed., Zyp, K., and Nottingham, M., Ed., "JavaScript Object Notation (JSON) Pointer", RFC 6901, April 2013. <https://www.rfc-editor.org/rfc/rfc6901>
- **[RFC8259]** Bray, T., Ed., "The JavaScript Object Notation (JSON) Data Interchange Format", RFC 8259, December 2017. <https://www.rfc-editor.org/rfc/rfc8259>
- **[JSON-SCHEMA]** Wright, A., Andrews, H., Hutton, B., "JSON Schema Validation: A Vocabulary for Structural Validation of JSON", draft-bhutton-json-schema-validation-01, December 2020. <https://json-schema.org/draft/2020-12/json-schema-validation>
- **[ECMA-262]** Ecma International, "ECMAScript Language Specification", ECMA-262, 14th edition, June 2023. <https://tc39.es/ecma262/> — referenced for the regular expression syntax used by the `pattern` keyword ([§6.1.1](#sec-6-1-1), [§9.3](#sec-9-3)).

### Informative References

- **[OPENAPI]** OpenAPI Initiative, "OpenAPI Specification 3.1.0", February 2021. <https://spec.openapis.org/oas/v3.1.0>
- **[XSD]** W3C, "XML Schema Part 1: Structures Second Edition", October 2004. <https://www.w3.org/TR/xmlschema-1/>
- **[AVRO]** Apache Software Foundation, "Apache Avro Specification", 2023. <https://avro.apache.org/docs/current/specification/>

---

## Appendix A — Implementation Guide (Informative)

This appendix collects practical guidance for implementors. Nothing here overrides the normative requirements in [§1](#sec-1)–[§15](#sec-15); it explains the intent behind design choices and flags common pitfalls.

### A.1 `$id` Is an Identifier, Not a Locator

The `$id` URI ([§4.3](#sec-4-3)) uniquely names a schema within a registry. It is an opaque identifier — no conforming processor is required to resolve it over a network or map it to a filesystem path. An implementation that attempts to HTTP-GET a `$id` URI and receives a 404 is not witnessing a spec violation; it is observing that the URI was never intended to be dereferenceable.

**Consequence**: there is no automatic schema discovery in OOJS. An implementation cannot read a single root schema and silently pull in its imports from the network. All schemas that are transitively imported MUST be explicitly loaded into the registry by the caller before validation begins (see §A.2).

Implementations MAY offer a URI-to-path mapping table as a convenience feature:

```
registry.addMapping(
  "https://specifications.openehr.org/schemas/oojs/base/base_types",
  "/schemas/openehr-base-types.oojs.json"
);
registry.loadFile("/schemas/openehr-ehr.oojs.json"); // imports resolved via mapping
```

This is purely a quality-of-life feature; the spec does not require it.

### A.2 Registry Bootstrapping Is the Caller's Responsibility

Because §A.1 defines no automatic resolution, the caller is responsible for populating the registry with every schema that may be referenced — directly or transitively — before calling `validate()`. A practical loading sequence for a multi-schema setup:

1. Load all leaf schemas (those with no imports, or whose imports are already loaded).
2. Load schemas that import the above.
3. Continue up the dependency tree until the root schema is loaded.

Because idempotent loading is RECOMMENDED ([§10.2](#sec-10-2) Note), the order in steps 1–3 does not matter in practice: loading a schema whose `$id` is already registered is a no-op. Callers can therefore load all known schemas unconditionally at startup.

If a schema references an import whose `$id` is not yet in the registry when `resolveHierarchy` runs, the loader MUST report a load error ([§10.2](#sec-10-2) step 5) rather than deferring the failure to validation time.

### A.3 Eager vs Lazy Type Reference Resolution

[§10.2](#sec-10-2) step 5 requires resolving "all `extends` references and type references within `properties`" at load time. This applies equally to:

- `extends` strings in type definitions (supertype links), and
- `type` strings in property definitions that name another type (`TypeRefProperty`).

**Eager resolution** (resolving property type strings to `TypeDef` objects during `loadSchema()`) is strongly RECOMMENDED because:

- Broken references (typos, missing imports) are detected immediately when the schema is loaded, not silently until a particular code path is exercised during validation.
- The validator can use the pre-resolved `TypeDef` pointer directly, making validation simpler and faster.

**Lazy resolution** (resolving property type strings at validation time) is not prohibited by the normative text, but it defers error detection in a way that makes broken schemas hard to diagnose in production. Implementations that choose lazy resolution SHOULD clearly document this behaviour.

The reference implementation follows eager resolution: after building the type hierarchy, a second pass iterates every property in every type and resolves `TypeRefProperty` strings to `TypeDef` pointers. A load error is reported if any reference cannot be resolved.

### A.4 The Silent $id Replacement Hazard

An implementation that allows a second schema with the same `$id` to overwrite the first one in the registry creates a subtle correctness hazard: any `TypeDef` objects that were resolved against the first schema (via `extends` or `TypeRefProperty` resolution) now point to types in a schema that is no longer registered, while newly resolved references point to the replacement. The registry is in an internally inconsistent state.

To avoid this, implementations MUST choose one of:

- **Idempotent (RECOMMENDED)**: return the already-registered schema unchanged; ignore the new document entirely.
- **Strict**: report a load error if a schema with the same `$id` is loaded again.

Neither strategy allows silent replacement.

### A.5 Cross-Schema Discriminator Values

When a schema imports another schema under an alias, the default discriminator value for an imported type is `"<alias>.<TypeName>"` ([§7.3](#sec-7-3)). This default is relative to the importing schema's alias, not to any canonical name in the source schema. The same type loaded under different aliases in different importing schemas will have different default discriminator values. Schema authors who need stable discriminator values across multiple importers SHOULD set `discriminatorValue` explicitly on the relevant types.
