# JSON Object Schema (OOJS)

A schema language for Object-Oriented JSON models — addressing the key limitations of JSON Schema when expressing class hierarchies, inheritance, and polymorphism.

## The Problem

JSON Schema requires verbose workarounds for common OO patterns:

| OO concept | JSON Schema approach | Problem |
|---|---|---|
| Inheritance | `allOf` + `$ref` | Property and `required` duplication in every subtype |
| Abstract types | No direct support | Must be enforced with `if/then` hacks |
| Polymorphism | `oneOf` + OpenAPI `discriminator` | OpenAPI extension, manual mapping, poor error messages |
| Type identity | Structural only | No nominal typing; no concept of a type hierarchy |

### Why not just use JSON Schema 2020-12?

JSON Schema 2020-12 addressed some of these problems — `unevaluatedProperties` was introduced specifically to fix the `allOf`-inheritance breakage, and the `discriminator` keyword exists as an OpenAPI extension. So can't you just use those?

Technically yes, but the cost is high:

- **`unevaluatedProperties` is the most complex keyword in the entire JSON Schema specification.** Correct use requires understanding annotation propagation and evaluation paths — deep internals that most practitioners never need to touch. OOJS achieves the same inheritance semantics with a single `"extends": "BaseType"` declaration.

- **Abstract types still have no first-class representation.** Preventing direct instantiation of a base type requires `if/then` hacks or out-of-band documentation with no enforcement.

- **Polymorphic dispatch in `oneOf` is O(N).** Every branch is validated against every candidate type; the first matching branch wins. For a hierarchy with many subtypes this is slow, and when validation fails the error output lists failures across *every* branch — unactionable noise. OOJS resolves the concrete type in O(1) via the discriminator field and reports errors only for the matched type.

- **JSON Schema is structurally typed; OO domain models are nominally typed.** A JSON Schema validator does not know that `Observation` *is a* `ClinicalEntry` — it only knows their property shapes happen to be compatible. OOJS makes the IS-A relationship explicit and enforces it, which is what class-based domain modeling actually requires.

- **The output of OOJS is JSON Schema.** A conforming OOJS processor can emit an equivalent JSON Schema 2020-12 document. OOJS is therefore not a replacement for JSON Schema — it is a higher-level authoring language that compiles down to it, in the same way TypeScript compiles to JavaScript. You get the expressiveness of OO modeling and the broad tooling support of JSON Schema.

## The Solution

OOJS provides first-class OO concepts in a compact JSON format:

```json
{
  "$oojs": "1.0",
  "$id": "https://example.org/schemas/clinical",
  "discriminator": "_type",
  "types": {
    "ClinicalEntry": {
      "abstract": true,
      "properties": {
        "id":        { "type": "string" },
        "timestamp": { "type": "string", "format": "date-time" },
        "subjectId": { "type": "string" }
      },
      "required": ["id", "timestamp", "subjectId"]
    },
    "Observation": {
      "extends": "ClinicalEntry",
      "properties": {
        "code":  { "type": "string" },
        "value": { "type": "number" }
      },
      "required": ["code", "value"]
    }
  }
}
```

A valid instance:

```json
{
  "_type": "Observation",
  "id": "obs-001",
  "timestamp": "2026-03-29T10:00:00Z",
  "subjectId": "patient-42",
  "code": "8480-6",
  "value": 120
}
```

## Key Features

- **Single inheritance** — `"extends": "SuperType"` with no property repetition
- **Abstract types** — `"abstract": true` prevents direct instantiation
- **Polymorphic dispatch** — any type-reference property accepts subtypes automatically via a discriminator
- **Inherited required** — required sets compose across the inheritance chain
- **Cross-schema imports** — reference types from other OOJS schemas by alias
- **JSON Schema output** — a conforming processor can emit equivalent JSON Schema 2020-12

## Project Structure

```
docs/
  01-requirements.md       Phase 1: Requirements analysis
  02-conceptual-model.md   Phase 2: Core concepts and relationships
  03-language-design.md    Phase 3: Full syntax and validation rules
spec/                      Phase 4: Formal specification (in progress)
examples/
  clinical.oojs.json       Example schema (clinical domain)
  clinical-instances.json  Valid and invalid instance examples
  core.oojs.json           Base schema for cross-schema imports
  billing.oojs.json        Schema importing `core` via alias-qualified types
  billing-instances.json   Valid and invalid instances for the cross-schema example
```

## Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | Done | Requirements analysis |
| 2 | Done | Conceptual modeling |
| 3 | Done | Language design |
| 4 | In progress | Formal specification (RFC-style) |
| 5 | Planned | Extended examples |
| 6 | Planned | Reference implementations |
| 7 | Planned | Critical evaluation |

## Related Standards

- [JSON Schema](https://json-schema.org/) — OOJS targets JSON Schema compatibility as an output format
- [OpenAPI 3.x discriminator](https://spec.openapis.org/oas/v3.1.0#discriminator-object) — partial predecessor to OOJS polymorphism
- [Apache Avro](https://avro.apache.org/) — named records + unions, binary-encoding focused
- [XML Schema (XSD)](https://www.w3.org/XML/Schema) — `complexType`/`extension` equivalent semantics

## Spec Link Check

Run this to ensure all `§...` references in the spec are clickable and internal section anchors resolve:

```bash
python3 scripts/check_spec_section_links.py
```
