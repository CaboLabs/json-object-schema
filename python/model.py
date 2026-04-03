"""OOJS data model — in-memory representation of a loaded schema."""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# Property definitions
# ---------------------------------------------------------------------------

PRIMITIVE_TYPES = {"string", "integer", "number", "boolean", "null"}


@dataclass
class PrimitiveProperty:
    kind: str  # one of PRIMITIVE_TYPES
    title: str = ""
    description: str = ""
    # string constraints
    min_length: int | None = None
    max_length: int | None = None
    pattern: str | None = None
    format: str | None = None
    # numeric constraints
    minimum: float | None = None
    maximum: float | None = None
    exclusive_minimum: float | None = None
    exclusive_maximum: float | None = None
    multiple_of: float | None = None
    # shared
    enum: list[Any] | None = None


@dataclass
class TypeRefProperty:
    type_name: str          # "TypeName" or "alias.TypeName"
    title: str = ""
    description: str = ""
    resolved_type: "TypeDef | None" = field(default=None, repr=False)  # populated at load time


@dataclass
class IdRefProperty:
    type_name: str          # "TypeName" or "alias.TypeName"
    title: str = ""
    description: str = ""
    min_length: int | None = None
    max_length: int | None = None
    pattern: str | None = None
    resolved_type: "TypeDef | None" = field(default=None, repr=False)  # populated at load time


@dataclass
class ArrayProperty:
    items: "PrimitiveProperty | TypeRefProperty | IdRefProperty" = None  # type: ignore[assignment]
    min_items: int = 0
    max_items: int | None = None
    unique_items: bool = False
    title: str = ""
    description: str = ""


PropertyDef = PrimitiveProperty | TypeRefProperty | IdRefProperty | ArrayProperty


# ---------------------------------------------------------------------------
# Type definition
# ---------------------------------------------------------------------------

@dataclass
class TypeDef:
    name: str
    schema_id: str                              # owning schema $id
    abstract: bool = False
    extends: str | None = None                  # raw extends string ("A" or "alias.A")
    discriminator_value: str | None = None      # overridden dv, or None → use name
    title: str = ""
    description: str = ""
    own_properties: dict[str, PropertyDef] = field(default_factory=dict)
    own_required: list[str] = field(default_factory=list)

    # resolved at load time
    supertype: TypeDef | None = field(default=None, repr=False)

    @property
    def effective_discriminator_value(self) -> str:
        return self.discriminator_value if self.discriminator_value is not None else self.name

    def effective_required(self) -> list[str]:
        if self.supertype is None:
            return list(self.own_required)
        return self.supertype.effective_required() + self.own_required

    def effective_properties(self) -> dict[str, PropertyDef]:
        if self.supertype is None:
            return dict(self.own_properties)
        base = self.supertype.effective_properties()
        base.update(self.own_properties)
        return base

    def is_subtype_of(self, other: TypeDef) -> bool:
        """Return True if self == other or self descends from other."""
        current: TypeDef | None = self
        while current is not None:
            if current is other:
                return True
            current = current.supertype
        return False


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

@dataclass
class Schema:
    oojs_version: str
    schema_id: str
    title: str = ""
    description: str = ""
    discriminator: str = "_type"
    closed_world: bool = True
    imports: dict[str, str] = field(default_factory=dict)  # alias → URI
    types: dict[str, TypeDef] = field(default_factory=dict)
