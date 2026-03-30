# Phase 1: Requirements Analysis

## 1. Background

JSON Schema is the de-facto standard for validating JSON documents. It covers a wide range of structural and semantic constraints. However, it was designed for validating arbitrary JSON structures, not for modeling object-oriented (OO) systems. As a result, teams modeling class hierarchies, inheritance, and polymorphic types face significant friction.

This document captures the requirements for **Object-Oriented JSON Schema (OOJS)** — a schema language designed specifically to express OO models cleanly, compactly, and without ambiguity.

---

## 2. Problems with JSON Schema for OO Modeling

### 2.1 Inheritance requires property duplication

JSON Schema has no first-class inheritance. The common pattern uses `allOf` to compose a parent schema with child additions:

```json
{
  "$defs": {
    "Animal": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "age":  { "type": "integer" }
      },
      "required": ["name"]
    },
    "Dog": {
      "allOf": [
        { "$ref": "#/$defs/Animal" },
        {
          "type": "object",
          "properties": {
            "breed": { "type": "string" }
          }
        }
      ]
    }
  }
}
```

**Problems:**
- `type: object` must be repeated in every subtype definition
- `required` constraints from the parent are not visually obvious in the child
- Tools that do not deeply resolve `allOf` may miss inherited constraints
- No explicit statement that `Dog` *extends* `Animal`; the semantics are implied by structure

### 2.2 Polymorphism is verbose and fragile

The standard approach for polymorphism uses `oneOf` plus an OpenAPI-style discriminator:

```json
{
  "oneOf": [
    { "$ref": "#/$defs/Dog" },
    { "$ref": "#/$defs/Cat" }
  ],
  "discriminator": {
    "propertyName": "_type",
    "mapping": {
      "dog": "#/$defs/Dog",
      "cat": "#/$defs/Cat"
    }
  }
}
```

**Problems:**
- Discriminator is an OpenAPI extension, not part of core JSON Schema
- The mapping must be manually maintained as the hierarchy grows
- The discriminator property name must be re-declared or implied; it is not enforced by the schema itself
- `oneOf` validates exhaustively against every branch, making error messages hard to read

### 2.3 No first-class type hierarchy

JSON Schema has no concept of "type" in the OO sense. There is no way to say "a Dog is an Animal" without structural composition tricks. As a result:

- Type identity is structural, not nominal
- Two unrelated types with the same properties are indistinguishable
- There is no way to declare abstract types (types that cannot be instantiated directly)
- There is no way to query "what are all the subtypes of Animal?"

### 2.4 Graph structures are awkward

JSON is inherently a tree format. JSON Schema supports `$ref` for referencing definitions, but modeling graphs (e.g., a node that references other nodes of the same or related types) requires careful use of `$defs` and recursive references that are not intuitive.

---

## 3. Goals for OOJS

### 3.1 Functional requirements

| ID   | Requirement |
|------|-------------|
| F-01 | Define named types with typed properties |
| F-02 | Express single inheritance (0..1 supertype) |
| F-03 | Inherited properties must not be re-declared in subtypes |
| F-04 | Required constraints must be inheritable |
| F-05 | Support abstract types (non-instantiable) |
| F-06 | Support polymorphic properties (a property whose value may be any subtype of a declared type) |
| F-07 | Provide first-class discriminator support (automatic or explicit) |
| F-08 | Support typed arrays (collections of a declared type) |
| F-09 | Support cross-schema type references (for modular schemas) |
| F-10 | Support primitive types: string, integer, number, boolean, null |
| F-11 | Support common constraints on primitives (minLength, maxLength, minimum, maximum, pattern, enum) |
| F-12 | Support optional and required property declarations |
| F-13 | Support property-level documentation (title, description) |
| F-14 | Support schema-level metadata ($id, title, description, version) |

### 3.2 Non-functional requirements

| ID   | Requirement |
|------|-------------|
| N-01 | The schema format must itself be valid JSON |
| N-02 | A schema must be human-readable and writable without tooling |
| N-03 | Semantics must be unambiguous and formally specifiable |
| N-04 | Validation of an instance against a schema must be decidable |
| N-05 | The specification must be implementable in any general-purpose language |
| N-06 | The format must be compatible with (or convertible to) JSON Schema where possible |
| N-07 | The specification must be versioned |

### 3.3 Out of scope (v1.0)

- Multiple inheritance
- Interface/mixin types
- Generics / parametric types
- Type constraints beyond single-value properties (e.g., cross-property invariants)
- JSON Schema keyword passthrough (arbitrary `$vocabulary` extensions)
- GUI tooling

---

## 4. Use Cases

### UC-1: Domain model with inheritance hierarchy

A healthcare system defines `ClinicalEntry` as a base type with subtypes `Observation`, `Diagnosis`, and `Procedure`. Each subtype inherits common properties (`id`, `timestamp`, `subject`) and adds its own specific properties.

### UC-2: Polymorphic collection

A document contains a `findings` array where each item may be any subtype of `ClinicalEntry`. The schema must specify the base type, and validators must dispatch to the correct subtype using a discriminator.

### UC-3: Abstract base type

`ClinicalEntry` should never be instantiated directly; only its concrete subtypes are valid. The schema must express this constraint.

### UC-4: Cross-schema references

A `Patient` schema defined in `patient.oojs.json` is referenced by properties in `encounter.oojs.json`. The schema system must support this without circular-dependency issues.

### UC-5: Modular schema library

A project defines a library of reusable base types (e.g., `Identifier`, `CodedValue`, `Period`) that other schemas import and extend.

---

## 5. Relationship to Existing Standards

| Standard | Relationship |
|----------|-------------|
| JSON Schema (2020-12) | OOJS is a higher-level language; a conforming OOJS processor may emit equivalent JSON Schema for toolchain compatibility |
| OpenAPI 3.x | OpenAPI's `discriminator` object partially addresses polymorphism; OOJS makes this a first-class concept |
| Apache Avro | Avro supports named record types and unions; OOJS adds explicit inheritance |
| Protocol Buffers | Protobuf has `message` and `oneof`; OOJS targets JSON and is less binary-encoding-focused |
| XML Schema (XSD) | XSD supports `complexType`/`extension`; OOJS brings equivalent semantics to JSON |

---

## 6. Success Criteria

A completed OOJS v1.0 specification is successful when:

1. The language design is formally specified (BNF or equivalent)
2. At least one reference validator implementation exists
3. The example use cases (§4) can be expressed more concisely in OOJS than in equivalent JSON Schema
4. Round-trip conversion to JSON Schema is possible (OOJS → JSON Schema, lossless for v1.0 features)
5. An independent party can implement a conforming validator from the specification alone
