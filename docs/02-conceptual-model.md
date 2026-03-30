# Phase 2: Conceptual Model

## 1. Overview

This document defines the core concepts of OOJS using an informal but precise vocabulary. These concepts form the semantic foundation for the language design (Phase 3) and the formal specification (Phase 4).

---

## 2. Core Concepts

### 2.1 Schema

A **Schema** is the top-level container. It declares a namespace of named types and provides schema-level metadata. A schema has:

- A unique identifier (`$id`) — a URI
- An optional human-readable `title` and `description`
- A `version` string
- A set of **Type Definitions**
- An optional set of **imports** (references to other schemas)

### 2.2 Type

A **Type** is a named, structured definition. Types are the primary modeling unit, analogous to a *class* in OOP. A type has:

- A **name** — unique within its schema namespace
- An optional **supertype** — at most one declared type (single inheritance)
- A set of **Property Definitions**
- A set of **required** property names (may include inherited properties)
- An **abstract** flag — if true, no instance may directly claim this type
- Optional metadata: `title`, `description`

Types form a **type hierarchy**: a directed acyclic graph (in practice a forest of trees, since only single inheritance is supported in v1.0).

### 2.3 Property

A **Property** belongs to a type and describes a named slot on instances of that type. A property has:

- A **name** — unique within the type's own property set (inherited properties occupy the same namespace)
- A **value type** — one of:
  - A **primitive type** (see §2.4)
  - A **named type reference** (reference to another type in scope)
  - An **array** of a value type
- An **optional/required** flag
- Optional constraints (specific to primitive types — see §2.4)
- Optional metadata: `title`, `description`

**Property inheritance rule:** A type inherits all properties defined on its supertype (and recursively on the supertype's supertype). A subtype may not re-declare a property with the same name as an inherited property (no overriding in v1.0).

### 2.4 Primitive Types

OOJS defines the following primitive types, aligned with JSON's native types:

| Primitive | JSON representation | Constraints |
|-----------|--------------------|---------------------------------|
| `string`  | JSON string | `minLength`, `maxLength`, `pattern`, `enum`, `format` |
| `integer` | JSON number (integer) | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `enum` |
| `number`  | JSON number | same as integer |
| `boolean` | JSON boolean | — |
| `null`    | JSON null | — |

### 2.5 Array Type

An **Array** is an ordered, homogeneous collection of items of a single value type. Arrays may be:
- `minItems` / `maxItems` constrained
- Optionally `uniqueItems`

### 2.6 Type Reference

A **Type Reference** points to a named type within the current schema or an imported schema. References are resolved at schema load time. Circular references are allowed for graph modeling but must not create infinite instantiation requirements.

### 2.7 Inheritance

OOJS supports **single inheritance**: a type may declare exactly one supertype. The semantics follow standard OOP:

- A subtype *is-a* supertype (Liskov substitution holds)
- All properties of the supertype are available on instances of the subtype
- The required set of a subtype is the union of the supertype's required set and its own
- A type may inherit transitively through a chain of supertypes

**No diamond inheritance.** Since each type has at most one supertype, ambiguity from multiple inheritance cannot arise.

### 2.8 Polymorphism

OOJS supports **subtype polymorphism**: a property declared with type `T` accepts instances of `T` or any concrete descendant of `T`.

Validators must determine the actual type of an instance to apply the correct property constraints. This requires a **discriminator**.

#### 2.8.1 Discriminator

A **discriminator** is a reserved property on an instance that carries the instance's declared type name. OOJS defines a schema-level default discriminator property name (default: `_type`), which may be overridden per-schema or per-type.

Rules:
- The discriminator property is implicitly added to every non-abstract type
- Its value must be the exact type name (or a qualified name if the type is from an imported schema)
- Validators use the discriminator value to select the appropriate type definition for validation
- The discriminator property is always required and always a string

#### 2.8.2 Abstract vs Concrete Types

- **Abstract type**: may not be directly instantiated; the discriminator value may never equal the name of an abstract type
- **Concrete type**: may be instantiated; a valid instance must carry a discriminator equal to one of the concrete types in scope

---

## 3. Instance Model

An **instance** is a JSON value that is claimed to conform to a named type. An instance is valid with respect to a type `T` if and only if:

1. The instance is a JSON object
2. The instance carries a discriminator property whose value is the name of a concrete type `C` where `C = T` or `C` is a descendant of `T`
3. All required properties of `C` (including inherited ones) are present in the instance
4. All present properties conform to their declared value types and constraints
5. No property is present that is not declared on `C` or any of its supertypes (closed-world assumption, configurable)

---

## 4. Concept Relationships

```
Schema
  └── imports: Schema*
  └── types: TypeDefinition+

TypeDefinition
  ├── name: string
  ├── abstract: boolean
  ├── supertype: TypeDefinition?          (0..1)
  ├── properties: PropertyDefinition*
  ├── required: string*
  └── metadata: Metadata?

PropertyDefinition
  ├── name: string
  ├── valueType: PrimitiveType | TypeReference | ArrayType
  ├── required: boolean
  └── metadata: Metadata?

ArrayType
  ├── itemType: PrimitiveType | TypeReference
  ├── minItems: integer?
  ├── maxItems: integer?
  └── uniqueItems: boolean?

TypeReference
  ├── typeName: string
  └── schemaId: URI?                      (null = current schema)

PrimitiveType
  ├── kind: string | integer | number | boolean | null
  └── constraints: Constraints?
```

---

## 5. Design Decisions

| Decision | Rationale |
|----------|-----------|
| Single inheritance only | Avoids ambiguity; sufficient for most OO domain models; matches most language semantics |
| Mandatory discriminator | Enables unambiguous polymorphic dispatch without out-of-band type negotiation |
| No property overriding | Prevents Liskov violations; simplifies validators; can be revisited in v2.0 |
| Closed-world by default | Stricter validation catches modeling errors earlier; open-world mode opt-in |
| No multiple roots | Each type hierarchy is a tree; simpler tooling and reasoning |
| JSON format for schemas | Consistent with JSON Schema; no new parser required; tooling reuse |
