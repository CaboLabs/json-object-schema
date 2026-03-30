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
