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
   - 8.6 [Object Relationships](#86-object-relationships)
   - 8.7 [Has-One and Has-Many](#87-has-one-and-has-many)
   - 8.8 [Vertical Relationships (Hierarchical / Embedded)](#88-vertical-relationships-hierarchical--embedded)
   - 8.9 [Horizontal Relationships (Non-Hierarchical / Reference by ID)](#89-horizontal-relationships-non-hierarchical--reference-by-id)
   - 8.10 [Choosing Between Vertical and Horizontal](#810-choosing-between-vertical-and-horizontal)
   - 8.11 [Unidirectional and Bidirectional Relationships](#811-unidirectional-and-bidirectional-relationships)
   - 8.12 [Graph Document Format](#812-graph-document-format)
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

### 8.6 Object Relationships

OOJS types can be associated with one another in ways that go beyond inheritance. A **relationship** is a runtime connection between instances of two types. Relationships are expressed through property definitions (§6) and fall along two independent axes:

- **Cardinality**: how many instances of the associated type are involved (has-one or has-many).
- **Structure**: whether the associated instance is embedded inside the owning instance (vertical) or referenced by identifier from a separate location (horizontal).

These axes are orthogonal: any combination of cardinality and structure is valid.

The type hierarchy (§3.4) describes what a type *is*. Relationships describe what a type *has*. The two concepts are independent: a `Dog` IS-A `Animal` (inheritance); an `Encounter` HAS-MANY `ClinicalEntry` values (relationship).

---

### 8.7 Has-One and Has-Many

**Has-one** — the owning type holds a reference to exactly one instance of the associated type (or a concrete subtype thereof). In OOJS, has-one is expressed as a type reference property (§6.2) or a string property holding an ID (§8.9).

**Has-many** — the owning type holds zero or more instances of the associated type. In OOJS, has-many is expressed as an array property (§6.3) whose `items` is either a type reference (for embedded objects) or a primitive string type (for ID references).

The `minItems` and `maxItems` constraints on an array property (§6.3) allow a schema author to further restrict cardinality — for example, `"minItems": 1` expresses a "has-one-or-more" constraint, and equal `minItems` and `maxItems` express an exact count.

| Cardinality | OOJS representation |
|-------------|---------------------|
| Has-one (vertical) | TypeRefProperty with `"type": "TypeName"` |
| Has-many (vertical) | ArrayProperty with `"items": {"type": "TypeName"}` |
| Has-one (horizontal) | PrimitiveProperty with `"type": "string"` holding an ID |
| Has-many (horizontal) | ArrayProperty with `"items": {"type": "string"}` holding IDs |

---

### 8.8 Vertical Relationships (Hierarchical / Embedded)

A **vertical relationship** (also called *hierarchical* or *composition*) embeds the associated object directly inside the owning object's JSON representation. The owned object:

- carries its own discriminator property and is fully validated by the OOJS validator as part of its owner's validation;
- exists only within the scope of its owner's JSON document;
- has no independent identity outside that document.

**Has-one vertical** — expressed as a TypeRefProperty (§6.2):

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

**Has-many vertical (polymorphic)** — expressed as an ArrayProperty (§6.3) whose item type is abstract, accepting any concrete subtype:

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

Each item in the array is validated independently by the discriminator dispatch algorithm (§7.5). This is the primary mechanism for polymorphic collections in OOJS.

**Characteristics of vertical relationships:**

- The validator enforces the full structure of every embedded object automatically.
- The entire object graph is self-contained in one JSON document.
- Embedded objects do not need a globally unique identifier (though they MAY have one).
- Appropriate for **ownership/composition**: the embedded object's lifecycle is tied to its owner.
- Not appropriate when the same object must be referenced from multiple owners.

---

### 8.9 Horizontal Relationships (Non-Hierarchical / Reference by ID)

A **horizontal relationship** (also called *non-hierarchical* or *association by reference*) stores only an opaque identifier that points to an associated object. The associated object is NOT embedded in the JSON; it resides in a separate location (another document, a database row, an API response).

**Has-one horizontal** — expressed as a string property:

```json
"Car": {
  "properties": {
    "carId":   { "type": "string" },
    "make":    { "type": "string" },
    "model":   { "type": "string" },
    "ownerId": { "type": "string" }
  },
  "required": ["carId", "make", "model", "ownerId"]
}
```

A valid `Car` instance carries the owner's ID, not the owner's full object:

```json
{
  "_type":   "Car",
  "carId":   "car-001",
  "make":    "Acme",
  "model":   "Roadster",
  "ownerId": "person-007"
}
```

**Has-many horizontal** — expressed as an array of strings:

```json
"Fleet": {
  "properties": {
    "fleetId":   { "type": "string" },
    "name":      { "type": "string" },
    "carIds":    { "type": "array", "items": { "type": "string" } },
    "personIds": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["fleetId", "name"]
}
```

A valid `Fleet` instance holds only IDs; the `Car` and `Person` objects are fetched separately:

```json
{
  "_type":     "Fleet",
  "fleetId":   "fleet-001",
  "name":      "City Fleet",
  "carIds":    ["car-001", "car-002", "car-003"],
  "personIds": ["person-007", "person-008"]
}
```

**Characteristics of horizontal relationships:**

- OOJS validates only the structural type of the ID property (it is a string); referential integrity — whether the referenced object actually exists — is outside the scope of this specification and MUST be enforced by the application layer.
- The associated object has an independent lifecycle; it can be updated, transferred, or deleted without affecting the owner's JSON document.
- The same object can be referenced by multiple owners simultaneously (many-to-many patterns).
- The JSON document remains small even when many objects are associated.
- Appropriate for **associations**: when the referenced object exists independently and may be shared.

> **Note — same-document references**: The referenced objects in a horizontal relationship do not have to reside in a separate document or data store. When it is useful to serialize a complete object graph in one JSON file, the **Graph Document format** (§8.12) allows referenced objects to be co-located in the same document and linked via `{ "$ref-id": "<id>" }` expressions instead of bare ID strings. This preserves object independence (no embedding) while enabling atomic transport and validation of the whole graph.

---

### 8.10 Choosing Between Vertical and Horizontal

The following guidelines assist schema authors in selecting the appropriate relationship style. They are advisory, not normative.

| Question | Vertical (embed) | Horizontal (ID ref) |
|----------|-----------------|---------------------|
| Does the associated object have an independent identity? | No → embed | Yes → reference |
| Can the same object be owned by multiple parents at once? | No → embed | Yes → reference |
| Must the entire graph be validated in one pass? | Yes → embed | No → reference |
| Is the document size a concern with large collections? | No → embed | Yes → reference |
| Is referential integrity enforced by the schema? | Yes (automatically) | No (application responsibility) |
| Does the associated object outlive its owner? | No → embed | Yes → reference |

A single schema may freely mix vertical and horizontal relationships. For example, a `Car` might embed its `Motor` vertically (the motor has no existence outside the car) while referencing its `Owner` horizontally (the owner exists independently and may own multiple cars).

---

### 8.11 Unidirectional and Bidirectional Relationships

#### 8.11.1 Definitions

A relationship between types A and B has a **direction**: the side that holds the reference is called the **source** and the side being pointed to is called the **target**.

- A **unidirectional relationship** is navigable in one direction only. The source type declares a property that references the target, but the target type declares no corresponding back-reference. Navigation from target back to source requires a separate query or index maintained by the application.

- A **bidirectional relationship** is navigable in both directions. Both types declare properties that reference each other, forming a pair of complementary references. Either side can be used as a starting point to reach the other.

Directionality is a schema design choice, not a constraint enforced by OOJS. The validator treats each property independently; it has no knowledge of whether two properties in different types are intended to form a bidirectional pair.

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

### 8.12 Graph Document Format

A **graph document** is a single JSON file that contains multiple interconnected OOJS instances. Rather than storing one object per file, a graph document collects a set of objects and their inter-references within one JSON envelope, enabling a complete object graph to be serialized, transported, and validated atomically.

#### 8.12.1 Motivation

In horizontal relationships (§8.9), referenced objects normally reside outside the current JSON document — in a separate file, database row, or API response. However, it is often useful to serialize a complete object graph into one document without embedding every object vertically inside a single root. Vertical embedding (§8.8) would either duplicate shared objects or force an arbitrary nesting hierarchy. The graph document format avoids both problems:

- Each object retains its independent identity via a `$id` field.
- References between objects use `{ "$ref-id": "<id>" }` — typed and navigable, but not embedded.
- Shared objects are stored exactly once regardless of how many other objects reference them.
- The entire graph can be validated and transmitted as a single unit.

#### 8.12.2 Document Structure

A graph document is a JSON object with the following top-level fields:

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `$oojs` | Yes | string | OOJS version string (e.g. `"1.0"`) |
| `roots` | Yes | array | Entry-point objects of the graph |
| `objects` | No | object | Map of `"$id" → object` for all non-root objects |

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

#### 8.12.3 Object Identity Fields

Every object within a graph document carries two OOJS-reserved metadata fields:

| Field | Description |
|-------|-------------|
| `$type` | Discriminator value — the type name as registered in the schema (equivalent to the schema's `discriminator` field in standalone instances) |
| `$id` | Graph-scoped unique identifier for this object; used as the target of `$ref-id` references |

`$id` values MUST be unique within the graph document. They are opaque string labels; they do not need to match any persistent storage key, but SHOULD correspond to the object's domain identifier when one exists (e.g. a database primary key or a slug).

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

#### 8.12.5 Validation of Graph Documents

Validation of a graph document proceeds in two passes:

**Pass 1 — Reference resolution**: Build an index of all objects in `roots` and `objects` keyed by their `$id`. Verify that every `$ref-id` target exists in the index; emit `UNRESOLVED_REFERENCE` errors for any that do not.

**Pass 2 — Per-object validation**: For each object in `roots` and `objects`:

1. Resolve `$type` to the corresponding type definition in the schema registry.
2. Strip `$type` and `$id` from the property set before validation (they are document metadata, not schema-defined properties).
3. For each property value that is a `$ref-id` expression, substitute the resolved target object and validate it against the property's declared TypeRef type.
4. Validate all remaining properties against their declared property definitions.
5. Report errors with paths that identify the object's position in the document (e.g. `roots[0]/department`).

Cross-object consistency (bidirectional pairs, referential completeness) remains the application's responsibility, as it is in standalone-instance validation.

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
