"""OOJS instance validator (§9 of the spec).

Usage:
    registry = Registry()
    schema = registry.load_file("clinical.oojs.json")
    result = validate(instance, schema, registry)
    if result:
        for err in result:
            print(err)
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from .loader import Registry
from .model import (
    PRIMITIVE_TYPES,
    ArrayProperty,
    IdRefProperty,
    PrimitiveProperty,
    Schema,
    TypeDef,
    TypeRefProperty,
)


# ---------------------------------------------------------------------------
# Error model
# ---------------------------------------------------------------------------

class ErrorCode:
    MISSING_DISCRIMINATOR       = "MISSING_DISCRIMINATOR"
    INVALID_DISCRIMINATOR_TYPE  = "INVALID_DISCRIMINATOR_TYPE"
    UNKNOWN_TYPE                = "UNKNOWN_TYPE"
    ABSTRACT_TYPE               = "ABSTRACT_TYPE"
    TYPE_MISMATCH               = "TYPE_MISMATCH"
    MISSING_REQUIRED            = "MISSING_REQUIRED"
    ADDITIONAL_PROPERTY         = "ADDITIONAL_PROPERTY"
    STRING_TOO_SHORT            = "STRING_TOO_SHORT"
    STRING_TOO_LONG             = "STRING_TOO_LONG"
    PATTERN_MISMATCH            = "PATTERN_MISMATCH"
    ENUM_MISMATCH               = "ENUM_MISMATCH"
    BELOW_MINIMUM               = "BELOW_MINIMUM"
    ABOVE_MAXIMUM               = "ABOVE_MAXIMUM"
    BELOW_EXCLUSIVE_MINIMUM     = "BELOW_EXCLUSIVE_MINIMUM"
    ABOVE_EXCLUSIVE_MAXIMUM     = "ABOVE_EXCLUSIVE_MAXIMUM"
    NOT_MULTIPLE_OF             = "NOT_MULTIPLE_OF"
    NOT_INTEGER                 = "NOT_INTEGER"
    ARRAY_TOO_SHORT             = "ARRAY_TOO_SHORT"
    ARRAY_TOO_LONG              = "ARRAY_TOO_LONG"
    ARRAY_DUPLICATE_ITEMS       = "ARRAY_DUPLICATE_ITEMS"


@dataclass
class ValidationError:
    path: str       # JSON Pointer (RFC 6901)
    code: str       # ErrorCode constant
    message: str

    def __str__(self) -> str:
        return f"{self.path}: [{self.code}] {self.message}"


ValidationResult = list[ValidationError]


# ---------------------------------------------------------------------------
# Validator
# ---------------------------------------------------------------------------

class Validator:
    """Stateful validator.  A single Validator can be used for many instances."""

    def __init__(self, registry: Registry, fail_fast: bool = False) -> None:
        self._registry = registry
        self._fail_fast = fail_fast

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def validate(
        self,
        instance: Any,
        target_type: TypeDef,
        schema: Schema,
    ) -> ValidationResult:
        """Validate *instance* as *target_type*.  Returns a list of errors."""
        errors: ValidationResult = []
        self._validate_instance(instance, target_type, schema, "/", errors)
        return errors

    def validate_json(
        self,
        text: str,
        target_type_name: str,
        schema: Schema,
    ) -> ValidationResult:
        instance = json.loads(text)
        typedef = schema.types.get(target_type_name)
        if typedef is None:
            raise ValueError(
                f"Type '{target_type_name}' not found in schema '{schema.schema_id}'"
            )
        return self.validate(instance, typedef, schema)

    # ------------------------------------------------------------------
    # Phase 1–4 (§9.2)
    # ------------------------------------------------------------------

    def _validate_instance(
        self,
        instance: Any,
        target: TypeDef,
        schema: Schema,
        path: str,
        errors: ValidationResult,
    ) -> bool:
        """Returns False if we should stop collecting errors (fail_fast)."""

        if not isinstance(instance, dict):
            errors.append(ValidationError(
                path=path,
                code=ErrorCode.TYPE_MISMATCH,
                message="expected a JSON object",
            ))
            return not self._fail_fast

        # -- Phase 1: discriminator resolution ----------------------------
        disc_name = schema.discriminator
        if disc_name not in instance:
            errors.append(ValidationError(
                path=path,
                code=ErrorCode.MISSING_DISCRIMINATOR,
                message=f"missing discriminator property '{disc_name}'",
            ))
            return not self._fail_fast

        disc_val = instance[disc_name]
        if not isinstance(disc_val, str):
            errors.append(ValidationError(
                path=f"{path}/{disc_name}",
                code=ErrorCode.INVALID_DISCRIMINATOR_TYPE,
                message=f"discriminator property '{disc_name}' must be a string",
            ))
            return not self._fail_fast

        concrete = self._registry.lookup_by_discriminator_value(disc_val)
        if concrete is None:
            errors.append(ValidationError(
                path=f"{path}/{disc_name}",
                code=ErrorCode.UNKNOWN_TYPE,
                message=f"unknown type '{disc_val}'",
            ))
            return not self._fail_fast

        if concrete.abstract:
            errors.append(ValidationError(
                path=f"{path}/{disc_name}",
                code=ErrorCode.ABSTRACT_TYPE,
                message=f"type '{disc_val}' is abstract and cannot be instantiated",
            ))
            return not self._fail_fast

        if not concrete.is_subtype_of(target):
            errors.append(ValidationError(
                path=f"{path}/{disc_name}",
                code=ErrorCode.TYPE_MISMATCH,
                message=(
                    f"type '{disc_val}' is not a subtype of '{target.name}'"
                ),
            ))
            return not self._fail_fast

        # -- Phase 2: required properties ---------------------------------
        for req_name in concrete.effective_required():
            if req_name not in instance:
                errors.append(ValidationError(
                    path=path,
                    code=ErrorCode.MISSING_REQUIRED,
                    message=f"missing required property '{req_name}'",
                ))
                if self._fail_fast:
                    return False

        # -- Phase 3: property presence + validation ----------------------
        effective_props = concrete.effective_properties()
        for key, value in instance.items():
            if key == disc_name:
                continue
            if key not in effective_props:
                if schema.closed_world:
                    errors.append(ValidationError(
                        path=f"{path}/{_escape(key)}",
                        code=ErrorCode.ADDITIONAL_PROPERTY,
                        message=f"unexpected additional property '{key}'",
                    ))
                    if self._fail_fast:
                        return False
                continue
            prop_def = effective_props[key]
            ok = self._validate_property(
                value, prop_def, schema, f"{path}/{_escape(key)}", errors
            )
            if not ok and self._fail_fast:
                return False

        return True

    def _validate_property(
        self,
        value: Any,
        prop: object,
        schema: Schema,
        path: str,
        errors: ValidationResult,
    ) -> bool:
        if isinstance(prop, IdRefProperty):
            return self._validate_id_ref(value, prop, path, errors)
        if isinstance(prop, ArrayProperty):
            return self._validate_array(value, prop, schema, path, errors)
        if isinstance(prop, PrimitiveProperty):
            return self._validate_primitive(value, prop, path, errors)
        if isinstance(prop, TypeRefProperty):
            return self._validate_type_ref(value, prop, schema, path, errors)
        return True  # unknown property kind — ignore

    # -- Array (§9.2 Phase 4, array branch) ------------------------------

    def _validate_array(
        self,
        value: Any,
        prop: ArrayProperty,
        schema: Schema,
        path: str,
        errors: ValidationResult,
    ) -> bool:
        if not isinstance(value, list):
            errors.append(ValidationError(
                path=path, code=ErrorCode.TYPE_MISMATCH,
                message="expected an array",
            ))
            return not self._fail_fast

        if len(value) < prop.min_items:
            errors.append(ValidationError(
                path=path, code=ErrorCode.ARRAY_TOO_SHORT,
                message=(
                    f"array has {len(value)} item(s), minimum is {prop.min_items}"
                ),
            ))
            if self._fail_fast:
                return False

        if prop.max_items is not None and len(value) > prop.max_items:
            errors.append(ValidationError(
                path=path, code=ErrorCode.ARRAY_TOO_LONG,
                message=(
                    f"array has {len(value)} item(s), maximum is {prop.max_items}"
                ),
            ))
            if self._fail_fast:
                return False

        if prop.unique_items:
            seen: list[Any] = []
            for item in value:
                # Use JSON serialization for equality comparison
                item_str = json.dumps(item, sort_keys=True)
                if item_str in [json.dumps(s, sort_keys=True) for s in seen]:
                    errors.append(ValidationError(
                        path=path, code=ErrorCode.ARRAY_DUPLICATE_ITEMS,
                        message="array items must be unique",
                    ))
                    if self._fail_fast:
                        return False
                    break
                seen.append(item)

        for i, item in enumerate(value):
            ok = self._validate_property(
                item, prop.items, schema, f"{path}/{i}", errors
            )
            if not ok and self._fail_fast:
                return False

        return True

    # -- Primitive (§9.3) ------------------------------------------------

    def _validate_primitive(
        self,
        value: Any,
        prop: PrimitiveProperty,
        path: str,
        errors: ValidationResult,
    ) -> bool:
        # JSON kind check
        if not _json_kind_matches(value, prop.kind):
            errors.append(ValidationError(
                path=path, code=ErrorCode.TYPE_MISMATCH,
                message=(
                    f"expected {prop.kind}, "
                    f"got {_json_type_name(value)}"
                ),
            ))
            return not self._fail_fast

        # integer fractional check
        if prop.kind == "integer" and isinstance(value, float) and value != int(value):
            errors.append(ValidationError(
                path=path, code=ErrorCode.NOT_INTEGER,
                message="value must be an integer (no fractional part)",
            ))
            if self._fail_fast:
                return False

        if prop.kind == "string":
            length = len(value)  # Python len = Unicode code points for str
            if prop.min_length is not None and length < prop.min_length:
                errors.append(ValidationError(
                    path=path, code=ErrorCode.STRING_TOO_SHORT,
                    message=f"string length {length} < minLength {prop.min_length}",
                ))
                if self._fail_fast:
                    return False
            if prop.max_length is not None and length > prop.max_length:
                errors.append(ValidationError(
                    path=path, code=ErrorCode.STRING_TOO_LONG,
                    message=f"string length {length} > maxLength {prop.max_length}",
                ))
                if self._fail_fast:
                    return False
            if prop.pattern is not None:
                try:
                    compiled = re.compile(prop.pattern)
                except re.error as e:
                    # Pattern error — treat as mismatch, include reason
                    errors.append(ValidationError(
                        path=path, code=ErrorCode.PATTERN_MISMATCH,
                        message=f"invalid pattern '{prop.pattern}': {e}",
                    ))
                    if self._fail_fast:
                        return False
                else:
                    if not compiled.search(value):
                        errors.append(ValidationError(
                            path=path, code=ErrorCode.PATTERN_MISMATCH,
                            message=f"value does not match pattern '{prop.pattern}'",
                        ))
                        if self._fail_fast:
                            return False
            if prop.enum is not None and value not in prop.enum:
                errors.append(ValidationError(
                    path=path, code=ErrorCode.ENUM_MISMATCH,
                    message=f"value '{value}' not in enum {prop.enum}",
                ))
                if self._fail_fast:
                    return False

        elif prop.kind in ("integer", "number"):
            num = float(value)
            if prop.minimum is not None and num < prop.minimum:
                errors.append(ValidationError(
                    path=path, code=ErrorCode.BELOW_MINIMUM,
                    message=f"value {value} < minimum {prop.minimum}",
                ))
                if self._fail_fast:
                    return False
            if prop.maximum is not None and num > prop.maximum:
                errors.append(ValidationError(
                    path=path, code=ErrorCode.ABOVE_MAXIMUM,
                    message=f"value {value} > maximum {prop.maximum}",
                ))
                if self._fail_fast:
                    return False
            if prop.exclusive_minimum is not None and num <= prop.exclusive_minimum:
                errors.append(ValidationError(
                    path=path, code=ErrorCode.BELOW_EXCLUSIVE_MINIMUM,
                    message=f"value {value} must be > {prop.exclusive_minimum}",
                ))
                if self._fail_fast:
                    return False
            if prop.exclusive_maximum is not None and num >= prop.exclusive_maximum:
                errors.append(ValidationError(
                    path=path, code=ErrorCode.ABOVE_EXCLUSIVE_MAXIMUM,
                    message=f"value {value} must be < {prop.exclusive_maximum}",
                ))
                if self._fail_fast:
                    return False
            if prop.multiple_of is not None:
                # Floating-point safe: use round
                if round(num % prop.multiple_of, 10) not in (0.0, prop.multiple_of):
                    errors.append(ValidationError(
                        path=path, code=ErrorCode.NOT_MULTIPLE_OF,
                        message=f"value {value} is not a multiple of {prop.multiple_of}",
                    ))
                    if self._fail_fast:
                        return False
            if prop.enum is not None and value not in prop.enum:
                errors.append(ValidationError(
                    path=path, code=ErrorCode.ENUM_MISMATCH,
                    message=f"value {value} not in enum {prop.enum}",
                ))
                if self._fail_fast:
                    return False

        return True

    # -- Id reference (§9.2 Phase 4, id-ref branch) ----------------------

    def _validate_id_ref(
        self,
        value: Any,
        prop: IdRefProperty,
        path: str,
        errors: ValidationResult,
    ) -> bool:
        if not isinstance(value, str):
            errors.append(ValidationError(path=path, code=ErrorCode.TYPE_MISMATCH,
                message="expected a string for id reference"))
            return not self._fail_fast
        length = len(value)  # Unicode code points
        if prop.min_length is not None and length < prop.min_length:
            errors.append(ValidationError(path=path, code=ErrorCode.STRING_TOO_SHORT,
                message=f"string length {length} < minLength {prop.min_length}"))
            if self._fail_fast:
                return False
        if prop.max_length is not None and length > prop.max_length:
            errors.append(ValidationError(path=path, code=ErrorCode.STRING_TOO_LONG,
                message=f"string length {length} > maxLength {prop.max_length}"))
            if self._fail_fast:
                return False
        if prop.pattern is not None:
            try:
                compiled = re.compile(prop.pattern)
            except re.error as e:
                errors.append(ValidationError(path=path, code=ErrorCode.PATTERN_MISMATCH,
                    message=f"invalid pattern '{prop.pattern}': {e}"))
                if self._fail_fast:
                    return False
            else:
                if not compiled.search(value):
                    errors.append(ValidationError(path=path, code=ErrorCode.PATTERN_MISMATCH,
                        message=f"value does not match pattern '{prop.pattern}'"))
                    if self._fail_fast:
                        return False
        return True

    # -- Type reference (§9.2 Phase 4, type-ref branch) ------------------

    def _validate_type_ref(
        self,
        value: Any,
        prop: TypeRefProperty,
        schema: Schema,
        path: str,
        errors: ValidationResult,
    ) -> bool:
        if not isinstance(value, dict):
            errors.append(ValidationError(
                path=path, code=ErrorCode.TYPE_MISMATCH,
                message="expected a JSON object for type reference",
            ))
            return not self._fail_fast

        ref_typedef = prop.resolved_type
        if ref_typedef is None:
            errors.append(ValidationError(
                path=path, code=ErrorCode.UNKNOWN_TYPE,
                message=f"type reference '{prop.type_name}' was not resolved at load time",
            ))
            return not self._fail_fast

        # Determine which schema governs the referenced type
        ref_schema = self._registry.get_schema(ref_typedef.schema_id) or schema
        return self._validate_instance(value, ref_typedef, ref_schema, path, errors)


# ---------------------------------------------------------------------------
# Convenience function
# ---------------------------------------------------------------------------

def validate(
    instance: Any,
    target_type: TypeDef,
    schema: Schema,
    registry: Registry,
    *,
    fail_fast: bool = False,
) -> ValidationResult:
    return Validator(registry, fail_fast=fail_fast).validate(instance, target_type, schema)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _json_kind_matches(value: Any, kind: str) -> bool:
    if kind == "null":
        return value is None
    if kind == "boolean":
        return isinstance(value, bool)
    if kind == "string":
        return isinstance(value, str)
    if kind == "integer":
        # JSON integers arrive as int or float with no fractional part
        if isinstance(value, bool):
            return False
        return isinstance(value, (int, float))
    if kind == "number":
        if isinstance(value, bool):
            return False
        return isinstance(value, (int, float))
    return False


def _json_type_name(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, str):
        return "string"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def _escape(token: str) -> str:
    """Escape a JSON Pointer token per RFC 6901."""
    return token.replace("~", "~0").replace("/", "~1")
