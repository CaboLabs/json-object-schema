"""OOJS schema loader and registry.

The registry maps schema $id URIs to Schema objects and provides O(1)
lookup of types by discriminator value.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .model import (
    PRIMITIVE_TYPES,
    ArrayProperty,
    PrimitiveProperty,
    PropertyDef,
    Schema,
    TypeDef,
    TypeRefProperty,
)

# ---------------------------------------------------------------------------
# Naming rules (§11)
# ---------------------------------------------------------------------------

_TYPE_NAME_RE = re.compile(r"^[A-Z][A-Za-z0-9_]*$")
_PROP_NAME_RE = re.compile(r"^[a-z_][A-Za-z0-9_]*$")
_ALIAS_NAME_RE = _PROP_NAME_RE

RESERVED_TYPE_NAMES = PRIMITIVE_TYPES | {"array"}


class SchemaError(Exception):
    """Raised when a schema document is structurally invalid."""


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

class Registry:
    """Holds loaded schemas and indexes types by discriminator value."""

    def __init__(self) -> None:
        self._schemas: dict[str, Schema] = {}       # $id → Schema
        self._by_dv: dict[str, TypeDef] = {}        # discriminator value → TypeDef
        self._alias_map: dict[str, str] = {}        # alias → schema $id (per-registry level)

    # ------------------------------------------------------------------
    # Loading
    # ------------------------------------------------------------------

    def load_file(self, path: str | Path) -> Schema:
        """Load a schema from a JSON file path."""
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return self._load(data, source=str(path))

    def load_json(self, text: str) -> Schema:
        """Load a schema from a JSON string."""
        data = json.loads(text)
        return self._load(data, source="<string>")

    def load_dict(self, data: dict[str, Any]) -> Schema:
        return self._load(data, source="<dict>")

    def _load(self, data: Any, source: str) -> Schema:
        if not isinstance(data, dict):
            raise SchemaError(f"{source}: schema must be a JSON object")

        # -- $oojs version ---------------------------------------------------
        oojs = data.get("$oojs")
        if oojs is None:
            raise SchemaError(f"{source}: missing required field '$oojs'")
        if oojs != "1.0":
            raise SchemaError(f"{source}: unsupported $oojs version '{oojs}'")

        # -- $id -------------------------------------------------------------
        schema_id = data.get("$id")
        if schema_id is None:
            raise SchemaError(f"{source}: missing required field '$id'")
        if not isinstance(schema_id, str) or not schema_id:
            raise SchemaError(f"{source}: '$id' must be a non-empty string")

        if schema_id in self._schemas:
            return self._schemas[schema_id]   # idempotent re-load

        # -- discriminator ---------------------------------------------------
        discriminator = data.get("discriminator", "_type")
        if not isinstance(discriminator, str) or not discriminator:
            raise SchemaError(f"{source}: 'discriminator' must be a non-empty string")

        # -- imports ---------------------------------------------------------
        raw_imports: dict[str, str] = {}
        if "imports" in data:
            imp = data["imports"]
            if not isinstance(imp, dict):
                raise SchemaError(f"{source}: 'imports' must be an object")
            for alias, uri in imp.items():
                if not _ALIAS_NAME_RE.match(alias):
                    raise SchemaError(
                        f"{source}: import alias '{alias}' violates naming rules"
                    )
                if not isinstance(uri, str):
                    raise SchemaError(
                        f"{source}: import value for alias '{alias}' must be a string"
                    )
                raw_imports[alias] = uri

        # -- types -----------------------------------------------------------
        raw_types = data.get("types")
        if raw_types is None:
            raise SchemaError(f"{source}: missing required field 'types'")
        if not isinstance(raw_types, dict) or not raw_types:
            raise SchemaError(f"{source}: 'types' must be a non-empty object")

        schema = Schema(
            oojs_version=oojs,
            schema_id=schema_id,
            title=data.get("title", ""),
            description=data.get("description", ""),
            discriminator=discriminator,
            closed_world=not data.get("additionalProperties", False),
            imports=raw_imports,
        )

        # Register early so circular imports don't re-enter
        self._schemas[schema_id] = schema

        # Parse type definitions (pass 1: names + own properties)
        for type_name, type_data in raw_types.items():
            if type_name in RESERVED_TYPE_NAMES:
                raise SchemaError(
                    f"{source}: '{type_name}' is a reserved name"
                )
            if not _TYPE_NAME_RE.match(type_name):
                raise SchemaError(
                    f"{source}: type name '{type_name}' violates naming rules"
                )
            typedef = self._parse_type(type_name, type_data, schema, source)
            schema.types[type_name] = typedef

        # Check discriminator property name doesn't collide with type properties
        for type_name, typedef in schema.types.items():
            if discriminator in typedef.own_properties:
                raise SchemaError(
                    f"{source}: type '{type_name}' declares property "
                    f"'{discriminator}' which collides with the schema discriminator"
                )

        # Resolve extends (pass 2: build the hierarchy)
        self._resolve_hierarchy(schema, source)

        # Resolve property TypeRefs (pass 3: eager resolution)
        self._resolve_property_type_refs(schema, source)

        # Check required entries reference own properties only
        for type_name, typedef in schema.types.items():
            for req in typedef.own_required:
                if req not in typedef.own_properties:
                    raise SchemaError(
                        f"{source}: type '{type_name}' lists '{req}' in 'required' "
                        f"but it is not declared in own 'properties'"
                    )

        # Check for property name redeclaration (inherited ∩ own must be empty)
        for type_name, typedef in schema.types.items():
            if typedef.supertype is not None:
                inherited = set(typedef.supertype.effective_properties().keys())
                own = set(typedef.own_properties.keys())
                overlap = inherited & own
                if overlap:
                    raise SchemaError(
                        f"{source}: type '{type_name}' redeclares inherited "
                        f"properties: {sorted(overlap)}"
                    )

        # Index types by discriminator value + uniqueness check
        for type_name, typedef in schema.types.items():
            dv = typedef.effective_discriminator_value
            if dv in self._by_dv:
                existing = self._by_dv[dv]
                if existing is not typedef:
                    raise SchemaError(
                        f"{source}: discriminator value '{dv}' is already used by "
                        f"type '{existing.name}' in schema '{existing.schema_id}'"
                    )
            self._by_dv[dv] = typedef

        return schema

    # ------------------------------------------------------------------
    # Type parsing
    # ------------------------------------------------------------------

    def _parse_type(
        self, name: str, data: Any, schema: Schema, source: str
    ) -> TypeDef:
        if not isinstance(data, dict):
            raise SchemaError(
                f"{source}: type '{name}' definition must be a JSON object"
            )

        extends = data.get("extends")
        if extends is not None and not isinstance(extends, str):
            raise SchemaError(
                f"{source}: type '{name}' 'extends' must be a string"
            )

        abstract = data.get("abstract", False)
        if not isinstance(abstract, bool):
            raise SchemaError(
                f"{source}: type '{name}' 'abstract' must be a boolean"
            )

        dv = data.get("discriminatorValue")
        if dv is not None and not isinstance(dv, str):
            raise SchemaError(
                f"{source}: type '{name}' 'discriminatorValue' must be a string"
            )

        # properties
        own_props: dict[str, PropertyDef] = {}
        raw_props = data.get("properties", {})
        if not isinstance(raw_props, dict):
            raise SchemaError(
                f"{source}: type '{name}' 'properties' must be an object"
            )
        for prop_name, prop_data in raw_props.items():
            if not _PROP_NAME_RE.match(prop_name):
                raise SchemaError(
                    f"{source}: property '{prop_name}' in type '{name}' "
                    f"violates naming rules"
                )
            own_props[prop_name] = self._parse_property(
                prop_name, prop_data, name, source
            )

        # required
        own_required: list[str] = []
        raw_required = data.get("required", [])
        if not isinstance(raw_required, list):
            raise SchemaError(
                f"{source}: type '{name}' 'required' must be an array"
            )
        for req in raw_required:
            if not isinstance(req, str):
                raise SchemaError(
                    f"{source}: type '{name}' 'required' entries must be strings"
                )
            if req in own_required:
                raise SchemaError(
                    f"{source}: type '{name}' 'required' lists '{req}' more than once"
                )
            own_required.append(req)

        return TypeDef(
            name=name,
            schema_id=schema.schema_id,
            abstract=abstract,
            extends=extends,
            discriminator_value=dv,
            title=data.get("title", ""),
            description=data.get("description", ""),
            own_properties=own_props,
            own_required=own_required,
        )

    def _parse_property(
        self, prop_name: str, data: Any, type_name: str, source: str
    ) -> PropertyDef:
        if not isinstance(data, dict):
            raise SchemaError(
                f"{source}: property '{prop_name}' in type '{type_name}' "
                f"must be a JSON object"
            )
        kind = data.get("type")
        if kind is None:
            raise SchemaError(
                f"{source}: property '{prop_name}' in type '{type_name}' "
                f"missing 'type'"
            )
        if not isinstance(kind, str):
            raise SchemaError(
                f"{source}: property '{prop_name}' in type '{type_name}' "
                f"'type' must be a string"
            )

        if kind == "array":
            return self._parse_array_property(prop_name, data, type_name, source)
        if kind in PRIMITIVE_TYPES:
            return self._parse_primitive_property(prop_name, data, type_name, source)
        # type reference
        return TypeRefProperty(
            type_name=kind,
            title=data.get("title", ""),
            description=data.get("description", ""),
        )

    def _parse_primitive_property(
        self, prop_name: str, data: dict, type_name: str, source: str
    ) -> PrimitiveProperty:
        kind = data["type"]

        def _int_ge_zero(key: str) -> int | None:
            v = data.get(key)
            if v is None:
                return None
            if not isinstance(v, int) or isinstance(v, bool) or v < 0:
                raise SchemaError(
                    f"{source}: '{key}' on property '{prop_name}' in '{type_name}' "
                    f"must be a non-negative integer"
                )
            return v

        def _number(key: str) -> float | None:
            v = data.get(key)
            if v is None:
                return None
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                raise SchemaError(
                    f"{source}: '{key}' on property '{prop_name}' in '{type_name}' "
                    f"must be a number"
                )
            return float(v)

        p = PrimitiveProperty(
            kind=kind,
            title=data.get("title", ""),
            description=data.get("description", ""),
        )

        if kind == "string":
            p.min_length = _int_ge_zero("minLength")
            p.max_length = _int_ge_zero("maxLength")
            if (
                p.min_length is not None
                and p.max_length is not None
                and p.min_length > p.max_length
            ):
                raise SchemaError(
                    f"{source}: 'minLength' > 'maxLength' on '{prop_name}' in '{type_name}'"
                )
            raw_pattern = data.get("pattern")
            if raw_pattern is not None:
                if not isinstance(raw_pattern, str):
                    raise SchemaError(
                        f"{source}: 'pattern' on '{prop_name}' must be a string"
                    )
                p.pattern = raw_pattern
            p.format = data.get("format")
            enum = data.get("enum")
            if enum is not None:
                if not isinstance(enum, list) or not enum:
                    raise SchemaError(
                        f"{source}: 'enum' on '{prop_name}' must be a non-empty array"
                    )
                p.enum = enum

        elif kind in ("integer", "number"):
            p.minimum = _number("minimum")
            p.maximum = _number("maximum")
            p.exclusive_minimum = _number("exclusiveMinimum")
            p.exclusive_maximum = _number("exclusiveMaximum")
            if p.minimum is not None and p.exclusive_minimum is not None:
                raise SchemaError(
                    f"{source}: 'minimum' and 'exclusiveMinimum' are mutually exclusive "
                    f"on '{prop_name}' in '{type_name}'"
                )
            if p.maximum is not None and p.exclusive_maximum is not None:
                raise SchemaError(
                    f"{source}: 'maximum' and 'exclusiveMaximum' are mutually exclusive "
                    f"on '{prop_name}' in '{type_name}'"
                )
            mo = data.get("multipleOf")
            if mo is not None:
                if not isinstance(mo, (int, float)) or isinstance(mo, bool) or mo <= 0:
                    raise SchemaError(
                        f"{source}: 'multipleOf' on '{prop_name}' must be > 0"
                    )
                p.multiple_of = float(mo)
            enum = data.get("enum")
            if enum is not None:
                if not isinstance(enum, list) or not enum:
                    raise SchemaError(
                        f"{source}: 'enum' on '{prop_name}' must be a non-empty array"
                    )
                p.enum = enum

        return p

    def _parse_array_property(
        self, prop_name: str, data: dict, type_name: str, source: str
    ) -> ArrayProperty:
        items_data = data.get("items")
        if items_data is None:
            raise SchemaError(
                f"{source}: array property '{prop_name}' in '{type_name}' missing 'items'"
            )
        items = self._parse_property(
            prop_name + ".items", items_data, type_name, source
        )
        if isinstance(items, ArrayProperty):
            raise SchemaError(
                f"{source}: nested arrays are not supported in v1.0 "
                f"(property '{prop_name}' in '{type_name}')"
            )

        def _int_ge_zero(key: str) -> int | None:
            v = data.get(key)
            if v is None:
                return None
            if not isinstance(v, int) or isinstance(v, bool) or v < 0:
                raise SchemaError(
                    f"{source}: '{key}' on '{prop_name}' in '{type_name}' "
                    f"must be a non-negative integer"
                )
            return v

        min_items = _int_ge_zero("minItems") or 0
        max_items = _int_ge_zero("maxItems")
        if max_items is not None and min_items > max_items:
            raise SchemaError(
                f"{source}: 'minItems' > 'maxItems' on '{prop_name}' in '{type_name}'"
            )
        unique = data.get("uniqueItems", False)
        if not isinstance(unique, bool):
            raise SchemaError(
                f"{source}: 'uniqueItems' on '{prop_name}' must be a boolean"
            )

        return ArrayProperty(
            items=items,
            min_items=min_items,
            max_items=max_items,
            unique_items=unique,
            title=data.get("title", ""),
            description=data.get("description", ""),
        )

    # ------------------------------------------------------------------
    # Hierarchy resolution
    # ------------------------------------------------------------------

    def _resolve_hierarchy(self, schema: Schema, source: str) -> None:
        for type_name, typedef in schema.types.items():
            if typedef.extends is not None:
                parent = self._resolve_type_ref(
                    typedef.extends, schema, source, context=f"type '{type_name}'"
                )
                typedef.supertype = parent

        # Cycle detection: every type must be able to reach root without revisiting
        for type_name, typedef in schema.types.items():
            visited: set[str] = set()
            current: TypeDef | None = typedef
            while current is not None:
                key = f"{current.schema_id}#{current.name}"
                if key in visited:
                    raise SchemaError(
                        f"{source}: inheritance cycle detected involving type '{type_name}'"
                    )
                visited.add(key)
                current = current.supertype

    def _resolve_property_type_refs(self, schema: Schema, source: str) -> None:
        for type_name, typedef in schema.types.items():
            for prop_name, prop in typedef.own_properties.items():
                self._resolve_property_type_ref(
                    prop, schema, source,
                    context=f"type '{type_name}', property '{prop_name}'"
                )

    def _resolve_property_type_ref(
        self, prop: PropertyDef, schema: Schema, source: str, context: str
    ) -> None:
        if isinstance(prop, TypeRefProperty):
            prop.resolved_type = self._resolve_type_ref(
                prop.type_name, schema, source, context=context
            )
        elif isinstance(prop, ArrayProperty):
            self._resolve_property_type_ref(
                prop.items, schema, source, context=context + ".items"
            )

    def _resolve_type_ref(
        self,
        ref: str,
        schema: Schema,
        source: str,
        context: str = "",
    ) -> TypeDef:
        """Resolve a type name (possibly qualified) to a TypeDef."""
        if "." in ref:
            alias, name = ref.split(".", 1)
            imported_id = schema.imports.get(alias)
            if imported_id is None:
                raise SchemaError(
                    f"{source}: {context}: unknown import alias '{alias}'"
                )
            imported_schema = self._schemas.get(imported_id)
            if imported_schema is None:
                raise SchemaError(
                    f"{source}: {context}: imported schema '{imported_id}' "
                    f"(alias '{alias}') is not loaded"
                )
            typedef = imported_schema.types.get(name)
            if typedef is None:
                raise SchemaError(
                    f"{source}: {context}: type '{name}' not found in schema '{imported_id}'"
                )
            return typedef
        else:
            typedef = schema.types.get(ref)
            if typedef is None:
                raise SchemaError(
                    f"{source}: {context}: type '{ref}' not found in schema '{schema.schema_id}'"
                )
            return typedef

    # ------------------------------------------------------------------
    # Public lookup API
    # ------------------------------------------------------------------

    def get_schema(self, schema_id: str) -> Schema | None:
        return self._schemas.get(schema_id)

    def lookup_by_discriminator_value(self, dv: str) -> TypeDef | None:
        return self._by_dv.get(dv)

    def resolve_type(self, name: str, schema: Schema) -> TypeDef | None:
        try:
            return self._resolve_type_ref(name, schema, "<lookup>")
        except SchemaError:
            return None

    def resolve_type_in(self, name: str, schema_id: str) -> TypeDef | None:
        schema = self._schemas.get(schema_id)
        if schema is None:
            return None
        try:
            return self._resolve_type_ref(name, schema, "<lookup>")
        except SchemaError:
            return None
