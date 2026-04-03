"""OOJS conformance tests (§12.2)."""

import json
import pytest
from pathlib import Path

from oojs import Registry, SchemaError, ValidationError
from oojs.validator import ErrorCode, Validator, validate

EXAMPLES = Path(__file__).resolve().parents[2] / "examples"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

MINIMAL_SCHEMA = {
    "$oojs": "1.0",
    "$id": "https://example.org/schemas/test",
    "types": {
        "Animal": {
            "abstract": True,
            "properties": {
                "name": {"type": "string"},
                "age":  {"type": "integer", "minimum": 0},
            },
            "required": ["name"],
        },
        "Dog": {
            "extends": "Animal",
            "properties": {
                "breed": {"type": "string"},
            },
            "required": ["breed"],
        },
        "Cat": {
            "extends": "Animal",
            "properties": {
                "indoor": {"type": "boolean"},
            },
        },
    },
}


def make_registry(*schemas) -> Registry:
    r = Registry()
    for s in schemas:
        r.load_dict(s)
    return r


def animal_registry() -> tuple[Registry, object]:
    r = make_registry(MINIMAL_SCHEMA)
    schema = r.get_schema("https://example.org/schemas/test")
    return r, schema


# ---------------------------------------------------------------------------
# Schema loading (§4, §5, §6, §10, §11)
# ---------------------------------------------------------------------------

class TestSchemaLoading:
    def test_minimal_valid_schema(self):
        r, schema = animal_registry()
        assert schema is not None
        assert "Animal" in schema.types
        assert "Dog" in schema.types

    def test_missing_oojs(self):
        with pytest.raises(SchemaError, match=r"\$oojs"):
            make_registry({"$id": "x", "types": {"A": {}}})

    def test_wrong_version(self):
        with pytest.raises(SchemaError, match="unsupported"):
            make_registry({"$oojs": "2.0", "$id": "x", "types": {"A": {}}})

    def test_missing_id(self):
        with pytest.raises(SchemaError, match=r"\$id"):
            make_registry({"$oojs": "1.0", "types": {"A": {}}})

    def test_missing_types(self):
        with pytest.raises(SchemaError, match="types"):
            make_registry({"$oojs": "1.0", "$id": "x"})

    def test_empty_types(self):
        with pytest.raises(SchemaError, match="types"):
            make_registry({"$oojs": "1.0", "$id": "x", "types": {}})

    def test_invalid_type_name_lowercase(self):
        with pytest.raises(SchemaError, match="naming rules"):
            make_registry({"$oojs": "1.0", "$id": "x", "types": {"dog": {}}})

    def test_reserved_type_name(self):
        with pytest.raises(SchemaError, match="reserved"):
            make_registry({"$oojs": "1.0", "$id": "x", "types": {"string": {}}})

    def test_discriminator_collides_with_property(self):
        with pytest.raises(SchemaError, match="collides"):
            make_registry({
                "$oojs": "1.0", "$id": "x",
                "discriminator": "kind",
                "types": {
                    "Foo": {"properties": {"kind": {"type": "string"}}}
                },
            })

    def test_inheritance_resolved(self):
        r, schema = animal_registry()
        dog = schema.types["Dog"]
        assert dog.supertype is schema.types["Animal"]

    def test_cycle_detection(self):
        with pytest.raises(SchemaError, match="cycle"):
            make_registry({
                "$oojs": "1.0", "$id": "x",
                "types": {
                    "A": {"extends": "B"},
                    "B": {"extends": "A"},
                },
            })

    def test_property_redeclaration_forbidden(self):
        with pytest.raises(SchemaError, match="redeclares"):
            make_registry({
                "$oojs": "1.0", "$id": "x",
                "types": {
                    "Base": {"properties": {"name": {"type": "string"}}},
                    "Child": {"extends": "Base", "properties": {"name": {"type": "string"}}},
                },
            })

    def test_required_references_own_property(self):
        with pytest.raises(SchemaError, match="not declared in own"):
            make_registry({
                "$oojs": "1.0", "$id": "x",
                "types": {
                    "Base": {
                        "properties": {"name": {"type": "string"}},
                        "required": ["name"],
                    },
                    "Child": {"extends": "Base", "required": ["name"]},  # illegal
                },
            })

    def test_duplicate_discriminator_value(self):
        with pytest.raises(SchemaError, match="discriminator value"):
            make_registry({
                "$oojs": "1.0", "$id": "x",
                "types": {
                    "A": {"discriminatorValue": "shared"},
                    "B": {"discriminatorValue": "shared"},
                },
            })

    def test_idempotent_reload(self):
        r = Registry()
        s1 = r.load_dict(MINIMAL_SCHEMA)
        s2 = r.load_dict(MINIMAL_SCHEMA)
        assert s1 is s2

    def test_invalid_property_name(self):
        with pytest.raises(SchemaError, match="naming rules"):
            make_registry({
                "$oojs": "1.0", "$id": "x",
                "types": {"Foo": {"properties": {"BadName": {"type": "string"}}}},
            })

    def test_mutually_exclusive_minimum(self):
        with pytest.raises(SchemaError, match="mutually exclusive"):
            make_registry({
                "$oojs": "1.0", "$id": "x",
                "types": {
                    "Foo": {
                        "properties": {
                            "n": {"type": "integer", "minimum": 0, "exclusiveMinimum": 0}
                        }
                    }
                },
            })

    def test_nested_array_forbidden(self):
        with pytest.raises(SchemaError, match="nested arrays"):
            make_registry({
                "$oojs": "1.0", "$id": "x",
                "types": {
                    "Foo": {
                        "properties": {
                            "matrix": {
                                "type": "array",
                                "items": {"type": "array", "items": {"type": "integer"}},
                            }
                        }
                    }
                },
            })


# ---------------------------------------------------------------------------
# Instance validation — discriminator (§7, §9.2 Phase 1)
# ---------------------------------------------------------------------------

class TestDiscriminator:
    def setup_method(self):
        self.r, self.schema = animal_registry()

    def _validate(self, instance, type_name="Animal"):
        typedef = self.schema.types[type_name]
        return validate(instance, typedef, self.schema, self.r)

    def test_missing_discriminator(self):
        errs = self._validate({"name": "Rex", "breed": "Labrador"})
        assert any(e.code == ErrorCode.MISSING_DISCRIMINATOR for e in errs)

    def test_invalid_discriminator_type(self):
        errs = self._validate({"_type": 42, "name": "Rex", "breed": "Labrador"})
        assert any(e.code == ErrorCode.INVALID_DISCRIMINATOR_TYPE for e in errs)

    def test_unknown_type(self):
        errs = self._validate({"_type": "Fish", "name": "Nemo"})
        assert any(e.code == ErrorCode.UNKNOWN_TYPE for e in errs)

    def test_abstract_type(self):
        errs = self._validate({"_type": "Animal", "name": "Generic"})
        assert any(e.code == ErrorCode.ABSTRACT_TYPE for e in errs)

    def test_type_not_subtype_of_target(self):
        # Validate an instance claiming Dog against Cat
        errs = self._validate(
            {"_type": "Dog", "name": "Rex", "breed": "Labrador"},
            type_name="Cat",
        )
        assert any(e.code == ErrorCode.TYPE_MISMATCH for e in errs)

    def test_valid_concrete_subtype(self):
        errs = self._validate(
            {"_type": "Dog", "name": "Rex", "breed": "Labrador"},
        )
        assert errs == []

    def test_custom_discriminator_value(self):
        r = Registry()
        r.load_dict({
            "$oojs": "1.0", "$id": "https://example.org/schemas/dv-test",
            "types": {
                "Vehicle": {"abstract": True, "properties": {"speed": {"type": "number"}}},
                "Car": {"extends": "Vehicle", "discriminatorValue": "automobile"},
            },
        })
        schema = r.get_schema("https://example.org/schemas/dv-test")
        typedef = schema.types["Vehicle"]
        errs = validate({"_type": "automobile", "speed": 100}, typedef, schema, r)
        assert errs == []


# ---------------------------------------------------------------------------
# Required properties (§5.6, §9.2 Phase 2)
# ---------------------------------------------------------------------------

class TestRequired:
    def setup_method(self):
        self.r, self.schema = animal_registry()

    def _validate(self, instance, type_name="Animal"):
        typedef = self.schema.types[type_name]
        return validate(instance, typedef, self.schema, self.r)

    def test_missing_own_required(self):
        errs = self._validate({"_type": "Dog", "name": "Rex"})  # missing breed
        assert any(
            e.code == ErrorCode.MISSING_REQUIRED and "breed" in e.message
            for e in errs
        )

    def test_missing_inherited_required(self):
        errs = self._validate({"_type": "Dog", "breed": "Labrador"})  # missing name
        assert any(
            e.code == ErrorCode.MISSING_REQUIRED and "name" in e.message
            for e in errs
        )

    def test_all_required_present(self):
        errs = self._validate({"_type": "Dog", "name": "Rex", "breed": "Labrador"})
        assert errs == []

    def test_optional_property_absent_is_ok(self):
        errs = self._validate({"_type": "Cat", "name": "Whiskers"})  # indoor is optional
        assert errs == []


# ---------------------------------------------------------------------------
# Closed-world / additional properties (§8.4, §9.2 Phase 3)
# ---------------------------------------------------------------------------

class TestAdditionalProperties:
    def setup_method(self):
        self.r, self.schema = animal_registry()

    def test_additional_property_rejected(self):
        errs = validate(
            {"_type": "Dog", "name": "Rex", "breed": "Lab", "color": "black"},
            self.schema.types["Dog"],
            self.schema,
            self.r,
        )
        assert any(e.code == ErrorCode.ADDITIONAL_PROPERTY for e in errs)

    def test_open_world_allows_extra(self):
        r = Registry()
        r.load_dict({
            "$oojs": "1.0", "$id": "https://example.org/schemas/open",
            "additionalProperties": True,
            "types": {
                "Foo": {"properties": {"x": {"type": "string"}}},
            },
        })
        schema = r.get_schema("https://example.org/schemas/open")
        errs = validate(
            {"_type": "Foo", "x": "hello", "extra": 99},
            schema.types["Foo"],
            schema,
            r,
        )
        assert errs == []


# ---------------------------------------------------------------------------
# Primitive constraints (§6.1, §9.3)
# ---------------------------------------------------------------------------

class TestStringConstraints:
    def _schema_with(self, constraints: dict) -> tuple:
        d = {
            "$oojs": "1.0", "$id": "https://example.org/schemas/str-test",
            "types": {
                "Str": {"properties": {"v": {"type": "string", **constraints}}},
            },
        }
        r = Registry()
        r.load_dict(d)
        schema = r.get_schema("https://example.org/schemas/str-test")
        return r, schema

    def _errs(self, value, constraints):
        r, schema = self._schema_with(constraints)
        return validate({"_type": "Str", "v": value}, schema.types["Str"], schema, r)

    def test_min_length_ok(self):
        assert self._errs("hi", {"minLength": 2}) == []

    def test_min_length_fail(self):
        errs = self._errs("x", {"minLength": 2})
        assert any(e.code == ErrorCode.STRING_TOO_SHORT for e in errs)

    def test_max_length_ok(self):
        assert self._errs("hi", {"maxLength": 5}) == []

    def test_max_length_fail(self):
        errs = self._errs("toolong", {"maxLength": 5})
        assert any(e.code == ErrorCode.STRING_TOO_LONG for e in errs)

    def test_pattern_match(self):
        assert self._errs("abc123", {"pattern": "^[a-z]+[0-9]+$"}) == []

    def test_pattern_no_match(self):
        errs = self._errs("123abc", {"pattern": "^[a-z]+[0-9]+$"})
        assert any(e.code == ErrorCode.PATTERN_MISMATCH for e in errs)

    def test_enum_match(self):
        assert self._errs("yes", {"enum": ["yes", "no"]}) == []

    def test_enum_mismatch(self):
        errs = self._errs("maybe", {"enum": ["yes", "no"]})
        assert any(e.code == ErrorCode.ENUM_MISMATCH for e in errs)

    def test_type_mismatch(self):
        errs = self._errs(42, {})
        assert any(e.code == ErrorCode.TYPE_MISMATCH for e in errs)


class TestNumericConstraints:
    def _schema(self, kind, constraints):
        d = {
            "$oojs": "1.0", "$id": "https://example.org/schemas/num-test",
            "types": {
                "Num": {"properties": {"v": {"type": kind, **constraints}}},
            },
        }
        r = Registry()
        r.load_dict(d)
        schema = r.get_schema("https://example.org/schemas/num-test")
        return r, schema

    def _errs(self, value, kind="number", **constraints):
        r, schema = self._schema(kind, constraints)
        return validate({"_type": "Num", "v": value}, schema.types["Num"], schema, r)

    def test_minimum_ok(self):           assert self._errs(5, minimum=0) == []
    def test_minimum_fail(self):
        errs = self._errs(-1, minimum=0)
        assert any(e.code == ErrorCode.BELOW_MINIMUM for e in errs)

    def test_maximum_ok(self):           assert self._errs(10, maximum=10) == []
    def test_maximum_fail(self):
        errs = self._errs(11, maximum=10)
        assert any(e.code == ErrorCode.ABOVE_MAXIMUM for e in errs)

    def test_exclusive_minimum_ok(self): assert self._errs(1, exclusiveMinimum=0) == []
    def test_exclusive_minimum_fail(self):
        errs = self._errs(0, exclusiveMinimum=0)
        assert any(e.code == ErrorCode.BELOW_EXCLUSIVE_MINIMUM for e in errs)

    def test_exclusive_maximum_ok(self): assert self._errs(9, exclusiveMaximum=10) == []
    def test_exclusive_maximum_fail(self):
        errs = self._errs(10, exclusiveMaximum=10)
        assert any(e.code == ErrorCode.ABOVE_EXCLUSIVE_MAXIMUM for e in errs)

    def test_multiple_of_ok(self):       assert self._errs(6, multipleOf=3) == []
    def test_multiple_of_fail(self):
        errs = self._errs(7, multipleOf=3)
        assert any(e.code == ErrorCode.NOT_MULTIPLE_OF for e in errs)

    def test_integer_ok(self):           assert self._errs(3, kind="integer") == []
    def test_integer_float_with_fraction(self):
        errs = self._errs(3.5, kind="integer")
        assert any(e.code == ErrorCode.NOT_INTEGER for e in errs)

    def test_integer_float_no_fraction(self):
        # 3.0 is acceptable as integer
        assert self._errs(3.0, kind="integer") == []

    def test_enum_number_ok(self):
        assert self._errs(2, enum=[1, 2, 3]) == []

    def test_enum_number_fail(self):
        errs = self._errs(5, enum=[1, 2, 3])
        assert any(e.code == ErrorCode.ENUM_MISMATCH for e in errs)


# ---------------------------------------------------------------------------
# Array constraints (§6.3, §9.2 Phase 4)
# ---------------------------------------------------------------------------

class TestArrayConstraints:
    def _schema(self, item_type="string", **constraints):
        d = {
            "$oojs": "1.0", "$id": "https://example.org/schemas/arr-test",
            "types": {
                "Arr": {
                    "properties": {
                        "v": {"type": "array", "items": {"type": item_type}, **constraints}
                    }
                },
            },
        }
        r = Registry()
        r.load_dict(d)
        schema = r.get_schema("https://example.org/schemas/arr-test")
        return r, schema

    def _errs(self, value, **constraints):
        r, schema = self._schema(**constraints)
        return validate({"_type": "Arr", "v": value}, schema.types["Arr"], schema, r)

    def test_not_array(self):
        errs = self._errs("notarray")
        assert any(e.code == ErrorCode.TYPE_MISMATCH for e in errs)

    def test_min_items_ok(self):   assert self._errs(["a", "b"], minItems=2) == []
    def test_min_items_fail(self):
        errs = self._errs(["a"], minItems=2)
        assert any(e.code == ErrorCode.ARRAY_TOO_SHORT for e in errs)

    def test_max_items_ok(self):   assert self._errs(["a"], maxItems=2) == []
    def test_max_items_fail(self):
        errs = self._errs(["a", "b", "c"], maxItems=2)
        assert any(e.code == ErrorCode.ARRAY_TOO_LONG for e in errs)

    def test_unique_items_ok(self): assert self._errs(["a", "b"], uniqueItems=True) == []
    def test_unique_items_fail(self):
        errs = self._errs(["a", "a"], uniqueItems=True)
        assert any(e.code == ErrorCode.ARRAY_DUPLICATE_ITEMS for e in errs)

    def test_item_constraint_propagated(self):
        # Item-level constraints must be placed on the items definition
        r = Registry()
        r.load_dict({
            "$oojs": "1.0", "$id": "https://example.org/schemas/arr-item-constraint",
            "types": {
                "Arr": {
                    "properties": {
                        "v": {
                            "type": "array",
                            "items": {"type": "string", "maxLength": 5},
                        }
                    }
                }
            },
        })
        schema = r.get_schema("https://example.org/schemas/arr-item-constraint")
        errs = validate({"_type": "Arr", "v": ["toolong"]}, schema.types["Arr"], schema, r)
        assert any(e.code == ErrorCode.STRING_TOO_LONG for e in errs)


# ---------------------------------------------------------------------------
# Polymorphic dispatch via array (§7, §8)
# ---------------------------------------------------------------------------

class TestPolymorphicArray:
    def setup_method(self):
        self.r = Registry()
        self.r.load_dict({
            "$oojs": "1.0", "$id": "https://example.org/schemas/poly",
            "types": {
                "Shape": {"abstract": True, "properties": {"color": {"type": "string"}}},
                "Circle": {
                    "extends": "Shape",
                    "properties": {"radius": {"type": "number"}},
                    "required": ["radius"],
                },
                "Rect": {
                    "extends": "Shape",
                    "properties": {
                        "width":  {"type": "number"},
                        "height": {"type": "number"},
                    },
                    "required": ["width", "height"],
                },
                "Canvas": {
                    "properties": {
                        "shapes": {
                            "type": "array",
                            "items": {"type": "Shape"},
                        }
                    }
                },
            },
        })
        self.schema = self.r.get_schema("https://example.org/schemas/poly")

    def test_polymorphic_array_valid(self):
        instance = {
            "_type": "Canvas",
            "shapes": [
                {"_type": "Circle", "radius": 5.0},
                {"_type": "Rect", "width": 10.0, "height": 4.0},
            ],
        }
        errs = validate(instance, self.schema.types["Canvas"], self.schema, self.r)
        assert errs == []

    def test_polymorphic_array_abstract_item(self):
        instance = {
            "_type": "Canvas",
            "shapes": [{"_type": "Shape", "color": "red"}],
        }
        errs = validate(instance, self.schema.types["Canvas"], self.schema, self.r)
        assert any(e.code == ErrorCode.ABSTRACT_TYPE for e in errs)

    def test_polymorphic_array_missing_required(self):
        instance = {
            "_type": "Canvas",
            "shapes": [{"_type": "Circle"}],  # missing radius
        }
        errs = validate(instance, self.schema.types["Canvas"], self.schema, self.r)
        assert any(e.code == ErrorCode.MISSING_REQUIRED for e in errs)


# ---------------------------------------------------------------------------
# Fail-fast mode (§9.6)
# ---------------------------------------------------------------------------

class TestFailFast:
    def test_fail_fast_returns_single_error(self):
        r, schema = animal_registry()
        instance = {"_type": "Dog"}  # missing name and breed
        errs = validate(
            instance, schema.types["Animal"], schema, r, fail_fast=True
        )
        assert len(errs) == 1

    def test_full_mode_returns_all_errors(self):
        r, schema = animal_registry()
        instance = {"_type": "Dog"}  # missing name and breed → 2 required errors
        errs = validate(instance, schema.types["Animal"], schema, r, fail_fast=False)
        assert len(errs) >= 2


# ---------------------------------------------------------------------------
# Clinical example (integration test)
# ---------------------------------------------------------------------------

class TestClinicalExample:
    def setup_method(self):
        self.r = Registry()
        self.schema = self.r.load_file(EXAMPLES / "clinical.oojs.json")
        with open(EXAMPLES / "clinical-instances.json") as f:
            data = json.load(f)
        self.valid_instances = data["valid"]
        self.invalid_instances = data["invalid"]

    def test_valid_instances_pass(self):
        for inst in self.valid_instances:
            # Strip meta-comment fields not part of the schema
            clean = {k: v for k, v in inst.items() if k != "_comment"}
            dv = clean.get("_type")
            typedef = self.schema.types.get(dv)
            if typedef is None:
                continue
            errs = validate(clean, typedef, self.schema, self.r)
            assert errs == [], f"Expected valid but got errors for {dv}: {errs}"

    def test_invalid_instances_fail(self):
        for inst in self.invalid_instances:
            dv = inst.get("_type")
            if dv is None:
                target = self.schema.types["Observation"]
            else:
                target = (
                    self.schema.types.get(dv)
                    or next(iter(self.schema.types.values()))
                )
            errs = validate(inst, target, self.schema, self.r)
            assert errs, (
                f"Expected validation errors for invalid instance "
                f"({inst.get('_comment', '')})"
            )


# ---------------------------------------------------------------------------
# Subtype check (§9.4)
# ---------------------------------------------------------------------------

class TestSubtypeCheck:
    def test_direct_subtype(self):
        r, schema = animal_registry()
        dog = schema.types["Dog"]
        animal = schema.types["Animal"]
        assert dog.is_subtype_of(animal)

    def test_same_type(self):
        r, schema = animal_registry()
        dog = schema.types["Dog"]
        assert dog.is_subtype_of(dog)

    def test_not_subtype(self):
        r, schema = animal_registry()
        cat = schema.types["Cat"]
        dog = schema.types["Dog"]
        assert not cat.is_subtype_of(dog)

    def test_transitive(self):
        r = Registry()
        r.load_dict({
            "$oojs": "1.0", "$id": "https://example.org/schemas/deep",
            "types": {
                "A": {"abstract": True},
                "B": {"extends": "A"},
                "C": {"extends": "B"},
                "D": {"extends": "C"},
            },
        })
        schema = r.get_schema("https://example.org/schemas/deep")
        d = schema.types["D"]
        a = schema.types["A"]
        assert d.is_subtype_of(a)


# ---------------------------------------------------------------------------
# Effective property set (§9.5)
# ---------------------------------------------------------------------------

class TestEffectivePropertySet:
    def test_inherits_parent_properties(self):
        r, schema = animal_registry()
        dog = schema.types["Dog"]
        eff = dog.effective_properties()
        assert "name" in eff   # from Animal
        assert "age" in eff    # from Animal
        assert "breed" in eff  # own

    def test_effective_required_union(self):
        r, schema = animal_registry()
        dog = schema.types["Dog"]
        req = dog.effective_required()
        assert "name" in req    # inherited
        assert "breed" in req   # own
