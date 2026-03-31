"""Additional coverage-oriented tests for the Python implementation."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from python import Registry, SchemaError, ValidationError
from python.validator import ErrorCode, Validator, validate


MINIMAL_SCHEMA = {
    "$oojs": "1.0",
    "$id": "https://example.org/schemas/test",
    "types": {
        "Animal": {
            "abstract": True,
            "properties": {
                "name": {"type": "string"},
                "age": {"type": "integer", "minimum": 0},
            },
            "required": ["name"],
        },
        "Dog": {
            "extends": "Animal",
            "properties": {"breed": {"type": "string"}},
            "required": ["breed"],
        },
        "Cat": {
            "extends": "Animal",
            "properties": {"indoor": {"type": "boolean"}},
        },
    },
}


def test_validation_error_str():
    err = ValidationError("/x", ErrorCode.MISSING_REQUIRED, "missing")
    assert str(err) == "/x: [MISSING_REQUIRED] missing"


def test_registry_load_json_invalid():
    r = Registry()
    with pytest.raises(json.JSONDecodeError):
        r.load_json("{")


def test_registry_load_file_missing():
    r = Registry()
    with pytest.raises(FileNotFoundError):
        r.load_file("/tmp/does-not-exist-" + next(tempfile._get_candidate_names()))


def test_registry_load_file_and_resolve_type():
    r = Registry()
    fd, path = tempfile.mkstemp(prefix="oojs-")
    # Close the low-level fd from mkstemp to avoid leaking descriptors.
    try:
        import os
        os.close(fd)
    except Exception:
        pass
    Path(path).write_text(json.dumps(MINIMAL_SCHEMA), encoding="utf-8")

    try:
        schema = r.load_file(path)
        assert schema.schema_id == "https://example.org/schemas/test"
        assert r.resolve_type("Dog", schema) is not None
        assert r.resolve_type("Missing", schema) is None
        assert r.resolve_type("unknown.Dog", schema) is None
        assert r.resolve_type_in("Dog", schema.schema_id) is not None
        assert r.resolve_type_in("Missing", schema.schema_id) is None
        assert r.resolve_type_in("Dog", "missing-schema") is None
    finally:
        Path(path).unlink(missing_ok=True)


def test_registry_parse_array_property_rejects_invalid_unique_items():
    r = Registry()
    with pytest.raises(SchemaError, match="uniqueItems"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "types": {
                "Foo": {
                    "properties": {
                        "arr": {
                            "type": "array",
                            "items": {"type": "string"},
                            "uniqueItems": "yes",
                        }
                    }
                }
            },
        })


def test_validator_validate_json_invalid_json():
    r = Registry()
    schema = r.load_dict(MINIMAL_SCHEMA)
    validator = Validator(r)
    with pytest.raises(json.JSONDecodeError):
        validator.validate_json("{", "Dog", schema)


def test_validator_validate_json_unknown_type():
    r = Registry()
    schema = r.load_dict(MINIMAL_SCHEMA)
    validator = Validator(r)
    with pytest.raises(ValueError, match="not found"):
        validator.validate_json('{"_type":"Dog"}', "Missing", schema)


def test_validator_type_ref_mismatch():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "https://example.org/schemas/ref-mismatch",
        "types": {
            "Parent": {
                "properties": {
                    "child": {"type": "Child"},
                },
                "required": ["child"],
            },
            "Child": {
                "properties": {"name": {"type": "string"}},
                "required": ["name"],
            },
        },
    })
    schema = r.get_schema("https://example.org/schemas/ref-mismatch")

    errs = validate({"_type": "Parent", "child": "nope"}, schema.types["Parent"], schema, r)
    assert any(e.code == ErrorCode.TYPE_MISMATCH for e in errs)


def test_validator_type_ref_unknown_type():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "https://example.org/schemas/ref-unknown",
        "types": {
            "Parent": {
                "properties": {
                    "child": {"type": "MissingType"},
                },
                "required": ["child"],
            },
        },
    })
    schema = r.get_schema("https://example.org/schemas/ref-unknown")

    errs = validate({"_type": "Parent", "child": {"x": 1}}, schema.types["Parent"], schema, r)
    assert any(e.code == ErrorCode.UNKNOWN_TYPE for e in errs)


def test_validator_type_ref_via_imports():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "https://example.org/schemas/other",
        "types": {
            "Pet": {
                "properties": {"name": {"type": "string"}},
                "required": ["name"],
            }
        },
    })
    r.load_dict({
        "$oojs": "1.0",
        "$id": "https://example.org/schemas/owner",
        "imports": {"other": "https://example.org/schemas/other"},
        "types": {
            "Owner": {
                "properties": {"pet": {"type": "other.Pet"}},
                "required": ["pet"],
            }
        },
    })
    schema = r.get_schema("https://example.org/schemas/owner")

    errs = validate(
        {"_type": "Owner", "pet": {"_type": "Pet", "name": "Fido"}},
        schema.types["Owner"],
        schema,
        r,
    )
    assert errs == []


def test_validator_reports_json_type_name():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "https://example.org/schemas/type-name",
        "types": {
            "Person": {
                "properties": {"age": {"type": "integer"}},
                "required": ["age"],
            }
        },
    })
    schema = r.get_schema("https://example.org/schemas/type-name")

    errs = validate({"_type": "Person", "age": ["oops"]}, schema.types["Person"], schema, r)
    assert any(e.code == ErrorCode.TYPE_MISMATCH and "got array" in e.message for e in errs)


def test_unique_items_canonicalizes_object_keys():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "https://example.org/schemas/uniq-obj",
        "additionalProperties": True,
        "types": {
            "Obj": {},
            "Arr": {
                "properties": {
                    "v": {
                        "type": "array",
                        "items": {"type": "Obj"},
                        "uniqueItems": True,
                    }
                },
                "required": ["v"],
            },
        },
    })
    schema = r.get_schema("https://example.org/schemas/uniq-obj")

    errs = validate(
        {
            "_type": "Arr",
            "v": [
                {"_type": "Obj", "a": 1, "b": 2},
                {"_type": "Obj", "b": 2, "a": 1},
            ],
        },
        schema.types["Arr"],
        schema,
        r,
    )

    assert any(e.code == ErrorCode.ARRAY_DUPLICATE_ITEMS for e in errs)


def test_registry_load_file_invalid_json():
    r = Registry()
    fd, path = tempfile.mkstemp(prefix="oojs-")
    try:
        import os
        os.close(fd)
    except Exception:
        pass
    Path(path).write_text("{", encoding="utf-8")
    try:
        with pytest.raises(json.JSONDecodeError):
            r.load_file(path)
    finally:
        Path(path).unlink(missing_ok=True)


def test_registry_schema_must_be_object():
    r = Registry()
    with pytest.raises(SchemaError, match="schema must be a JSON object"):
        r.load_json("null")


def test_registry_id_must_be_non_empty_string():
    r = Registry()
    with pytest.raises(SchemaError, match="non-empty string"):
        r.load_dict({"$oojs": "1.0", "$id": "", "types": {"A": {}}})


def test_registry_discriminator_must_be_non_empty_string():
    r = Registry()
    with pytest.raises(SchemaError, match="discriminator"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "discriminator": "",
            "types": {"A": {}},
        })


def test_registry_imports_must_be_object():
    r = Registry()
    with pytest.raises(SchemaError, match="imports"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "imports": "nope",
            "types": {"A": {}},
        })


def test_registry_import_alias_must_match_rules():
    r = Registry()
    with pytest.raises(SchemaError, match="import alias"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "imports": {"BadAlias": "https://example.org/schemas/other"},
            "types": {"A": {}},
        })


def test_registry_import_value_must_be_string():
    r = Registry()
    with pytest.raises(SchemaError, match="import value"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "imports": {"other": 123},
            "types": {"A": {}},
        })


def test_registry_type_definition_must_be_object():
    r = Registry()
    with pytest.raises(SchemaError, match="definition must be a JSON object"):
        r.load_dict({"$oojs": "1.0", "$id": "x", "types": {"Foo": "nope"}})


def test_registry_type_extends_must_be_string():
    r = Registry()
    with pytest.raises(SchemaError, match="extends"):
        r.load_dict({"$oojs": "1.0", "$id": "x", "types": {"Foo": {"extends": 123}}})


def test_registry_type_abstract_must_be_boolean():
    r = Registry()
    with pytest.raises(SchemaError, match="abstract"):
        r.load_dict({"$oojs": "1.0", "$id": "x", "types": {"Foo": {"abstract": "yes"}}})


def test_registry_type_discriminator_value_must_be_string():
    r = Registry()
    with pytest.raises(SchemaError, match="discriminatorValue"):
        r.load_dict({"$oojs": "1.0", "$id": "x", "types": {"Foo": {"discriminatorValue": 1}}})


def test_registry_type_properties_must_be_object():
    r = Registry()
    with pytest.raises(SchemaError, match="properties"):
        r.load_dict({"$oojs": "1.0", "$id": "x", "types": {"Foo": {"properties": "bad"}}})


def test_registry_type_required_must_be_array():
    r = Registry()
    with pytest.raises(SchemaError, match="required"):
        r.load_dict({"$oojs": "1.0", "$id": "x", "types": {"Foo": {"required": "bad"}}})


def test_registry_type_required_entries_must_be_strings():
    r = Registry()
    with pytest.raises(SchemaError, match="required' entries must be strings"):
        r.load_dict({"$oojs": "1.0", "$id": "x", "types": {"Foo": {"required": [1]}}})


def test_registry_type_required_duplicates_rejected():
    r = Registry()
    with pytest.raises(SchemaError, match="more than once"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "types": {
                "Foo": {
                    "properties": {"a": {"type": "string"}},
                    "required": ["a", "a"],
                }
            },
        })


def test_registry_property_must_be_object():
    r = Registry()
    with pytest.raises(SchemaError, match="must be a JSON object"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "types": {"Foo": {"properties": {"p": "bad"}}},
        })


def test_registry_property_missing_type():
    r = Registry()
    with pytest.raises(SchemaError, match="missing 'type'"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "types": {"Foo": {"properties": {"p": {}}}},
        })


def test_registry_property_type_must_be_string():
    r = Registry()
    with pytest.raises(SchemaError, match="'type' must be a string"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "types": {"Foo": {"properties": {"p": {"type": 1}}}},
        })


def test_registry_primitive_constraints_invalid_min_length():
    r = Registry()
    with pytest.raises(SchemaError, match="non-negative integer"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "types": {"Foo": {"properties": {"name": {"type": "string", "minLength": -1}}}},
        })


def test_registry_primitive_constraints_invalid_number():
    r = Registry()
    with pytest.raises(SchemaError, match="must be a number"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "types": {"Foo": {"properties": {"n": {"type": "integer", "minimum": True}}}},
        })


def test_registry_primitive_constraints_min_length_gt_max_length():
    r = Registry()
    with pytest.raises(SchemaError, match="minLength' > 'maxLength"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "types": {
                "Foo": {"properties": {"name": {"type": "string", "minLength": 5, "maxLength": 3}}},
            },
        })


def test_registry_primitive_constraints_pattern_must_be_string():
    r = Registry()
    with pytest.raises(SchemaError, match="pattern"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "types": {"Foo": {"properties": {"name": {"type": "string", "pattern": 123}}}},
        })


def test_registry_primitive_constraints_enum_must_be_non_empty_array():
    r = Registry()
    with pytest.raises(SchemaError, match="enum"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "types": {"Foo": {"properties": {"name": {"type": "string", "enum": []}}}},
        })


def test_registry_numeric_constraints_exclusive_maximum_conflict():
    r = Registry()
    with pytest.raises(SchemaError, match="exclusiveMaximum"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "types": {
                "Foo": {
                    "properties": {
                        "n": {"type": "number", "maximum": 1, "exclusiveMaximum": 1}
                    }
                }
            },
        })


def test_registry_numeric_constraints_multiple_of_invalid():
    r = Registry()
    with pytest.raises(SchemaError, match="multipleOf"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "types": {"Foo": {"properties": {"n": {"type": "number", "multipleOf": 0}}}},
        })


def test_registry_numeric_constraints_enum_must_be_non_empty_array():
    r = Registry()
    with pytest.raises(SchemaError, match="enum"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "types": {"Foo": {"properties": {"n": {"type": "number", "enum": []}}}},
        })


def test_registry_array_missing_items():
    r = Registry()
    with pytest.raises(SchemaError, match="missing 'items'"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "types": {"Foo": {"properties": {"arr": {"type": "array"}}}},
        })


def test_registry_array_min_items_must_be_non_negative_int():
    r = Registry()
    with pytest.raises(SchemaError, match="non-negative integer"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "types": {
                "Foo": {
                    "properties": {
                        "arr": {"type": "array", "items": {"type": "string"}, "minItems": -1}
                    }
                }
            },
        })


def test_registry_array_min_items_gt_max_items():
    r = Registry()
    with pytest.raises(SchemaError, match="minItems' > 'maxItems"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "types": {
                "Foo": {
                    "properties": {
                        "arr": {
                            "type": "array",
                            "items": {"type": "string"},
                            "minItems": 5,
                            "maxItems": 3,
                        }
                    }
                }
            },
        })


def test_registry_imported_schema_not_loaded():
    r = Registry()
    with pytest.raises(SchemaError, match="not loaded"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "imports": {"other": "https://example.org/schemas/other"},
            "types": {"Foo": {"extends": "other.Bar"}},
        })


def test_registry_imported_type_missing():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "https://example.org/schemas/other",
        "types": {"Pet": {}},
    })
    with pytest.raises(SchemaError, match="not found in schema"):
        r.load_dict({
            "$oojs": "1.0",
            "$id": "x",
            "imports": {"other": "https://example.org/schemas/other"},
            "types": {"Foo": {"extends": "other.Missing"}},
        })


def test_validator_validate_json_success():
    r = Registry()
    schema = r.load_dict(MINIMAL_SCHEMA)
    validator = Validator(r)
    errs = validator.validate_json('{"_type":"Dog","name":"Rex","breed":"Lab"}', "Dog", schema)
    assert errs == []


def test_validator_fail_fast_non_object_instance():
    r = Registry()
    schema = r.load_dict(MINIMAL_SCHEMA)
    errs = validate("nope", schema.types["Animal"], schema, r, fail_fast=True)
    assert len(errs) == 1
    assert errs[0].code == ErrorCode.TYPE_MISMATCH


def test_validator_fail_fast_additional_property():
    r = Registry()
    schema = r.load_dict(MINIMAL_SCHEMA)
    errs = validate(
        {"_type": "Dog", "name": "Rex", "breed": "Lab", "color": "black"},
        schema.types["Dog"],
        schema,
        r,
        fail_fast=True,
    )
    assert len(errs) == 1
    assert errs[0].code == ErrorCode.ADDITIONAL_PROPERTY


def test_validator_fail_fast_array_min_items():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "x",
        "types": {
            "Arr": {
                "properties": {
                    "v": {"type": "array", "items": {"type": "string"}, "minItems": 2}
                }
            }
        },
    })
    schema = r.get_schema("x")
    errs = validate({"_type": "Arr", "v": ["a"]}, schema.types["Arr"], schema, r, fail_fast=True)
    assert len(errs) == 1
    assert errs[0].code == ErrorCode.ARRAY_TOO_SHORT


def test_validator_fail_fast_array_max_items():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "x",
        "types": {
            "Arr": {
                "properties": {
                    "v": {"type": "array", "items": {"type": "string"}, "maxItems": 1}
                }
            }
        },
    })
    schema = r.get_schema("x")
    errs = validate({"_type": "Arr", "v": ["a", "b"]}, schema.types["Arr"], schema, r, fail_fast=True)
    assert len(errs) == 1
    assert errs[0].code == ErrorCode.ARRAY_TOO_LONG


def test_validator_fail_fast_unique_items():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "x",
        "types": {
            "Arr": {
                "properties": {
                    "v": {"type": "array", "items": {"type": "string"}, "uniqueItems": True}
                }
            }
        },
    })
    schema = r.get_schema("x")
    errs = validate({"_type": "Arr", "v": ["a", "a"]}, schema.types["Arr"], schema, r, fail_fast=True)
    assert len(errs) == 1
    assert errs[0].code == ErrorCode.ARRAY_DUPLICATE_ITEMS


def test_validator_fail_fast_array_item_validation():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "x",
        "types": {
            "Arr": {
                "properties": {
                    "v": {"type": "array", "items": {"type": "string"}}
                }
            }
        },
    })
    schema = r.get_schema("x")
    errs = validate({"_type": "Arr", "v": [123]}, schema.types["Arr"], schema, r, fail_fast=True)
    assert len(errs) == 1
    assert errs[0].code == ErrorCode.TYPE_MISMATCH


def test_validator_fail_fast_integer_fraction():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "x",
        "types": {"Num": {"properties": {"n": {"type": "integer"}}}},
    })
    schema = r.get_schema("x")
    errs = validate({"_type": "Num", "n": 3.5}, schema.types["Num"], schema, r, fail_fast=True)
    assert len(errs) == 1
    assert errs[0].code == ErrorCode.NOT_INTEGER


def test_validator_fail_fast_string_min_length():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "x",
        "types": {"Str": {"properties": {"s": {"type": "string", "minLength": 2}}}},
    })
    schema = r.get_schema("x")
    errs = validate({"_type": "Str", "s": "a"}, schema.types["Str"], schema, r, fail_fast=True)
    assert len(errs) == 1
    assert errs[0].code == ErrorCode.STRING_TOO_SHORT


def test_validator_fail_fast_string_max_length():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "x",
        "types": {"Str": {"properties": {"s": {"type": "string", "maxLength": 2}}}},
    })
    schema = r.get_schema("x")
    errs = validate({"_type": "Str", "s": "toolong"}, schema.types["Str"], schema, r, fail_fast=True)
    assert len(errs) == 1
    assert errs[0].code == ErrorCode.STRING_TOO_LONG


def test_validator_fail_fast_string_invalid_pattern():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "x",
        "types": {"Str": {"properties": {"s": {"type": "string", "pattern": "("}}}},
    })
    schema = r.get_schema("x")
    errs = validate({"_type": "Str", "s": "a"}, schema.types["Str"], schema, r, fail_fast=True)
    assert len(errs) == 1
    assert errs[0].code == ErrorCode.PATTERN_MISMATCH


def test_validator_fail_fast_string_pattern_mismatch():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "x",
        "types": {"Str": {"properties": {"s": {"type": "string", "pattern": "^a+$"}}}},
    })
    schema = r.get_schema("x")
    errs = validate({"_type": "Str", "s": "b"}, schema.types["Str"], schema, r, fail_fast=True)
    assert len(errs) == 1
    assert errs[0].code == ErrorCode.PATTERN_MISMATCH


def test_validator_fail_fast_string_enum_mismatch():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "x",
        "types": {"Str": {"properties": {"s": {"type": "string", "enum": ["a"]}}}},
    })
    schema = r.get_schema("x")
    errs = validate({"_type": "Str", "s": "b"}, schema.types["Str"], schema, r, fail_fast=True)
    assert len(errs) == 1
    assert errs[0].code == ErrorCode.ENUM_MISMATCH


def test_validator_fail_fast_number_minimum():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "x",
        "types": {"Num": {"properties": {"n": {"type": "number", "minimum": 0}}}},
    })
    schema = r.get_schema("x")
    errs = validate({"_type": "Num", "n": -1}, schema.types["Num"], schema, r, fail_fast=True)
    assert len(errs) == 1
    assert errs[0].code == ErrorCode.BELOW_MINIMUM


def test_validator_fail_fast_number_maximum():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "x",
        "types": {"Num": {"properties": {"n": {"type": "number", "maximum": 1}}}},
    })
    schema = r.get_schema("x")
    errs = validate({"_type": "Num", "n": 2}, schema.types["Num"], schema, r, fail_fast=True)
    assert len(errs) == 1
    assert errs[0].code == ErrorCode.ABOVE_MAXIMUM


def test_validator_fail_fast_number_exclusive_minimum():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "x",
        "types": {"Num": {"properties": {"n": {"type": "number", "exclusiveMinimum": 0}}}},
    })
    schema = r.get_schema("x")
    errs = validate({"_type": "Num", "n": 0}, schema.types["Num"], schema, r, fail_fast=True)
    assert len(errs) == 1
    assert errs[0].code == ErrorCode.BELOW_EXCLUSIVE_MINIMUM


def test_validator_fail_fast_number_exclusive_maximum():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "x",
        "types": {"Num": {"properties": {"n": {"type": "number", "exclusiveMaximum": 1}}}},
    })
    schema = r.get_schema("x")
    errs = validate({"_type": "Num", "n": 1}, schema.types["Num"], schema, r, fail_fast=True)
    assert len(errs) == 1
    assert errs[0].code == ErrorCode.ABOVE_EXCLUSIVE_MAXIMUM


def test_validator_fail_fast_number_multiple_of():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "x",
        "types": {"Num": {"properties": {"n": {"type": "number", "multipleOf": 2}}}},
    })
    schema = r.get_schema("x")
    errs = validate({"_type": "Num", "n": 3}, schema.types["Num"], schema, r, fail_fast=True)
    assert len(errs) == 1
    assert errs[0].code == ErrorCode.NOT_MULTIPLE_OF


def test_validator_fail_fast_number_enum_mismatch():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "x",
        "types": {"Num": {"properties": {"n": {"type": "number", "enum": [1, 2]}}}},
    })
    schema = r.get_schema("x")
    errs = validate({"_type": "Num", "n": 3}, schema.types["Num"], schema, r, fail_fast=True)
    assert len(errs) == 1
    assert errs[0].code == ErrorCode.ENUM_MISMATCH


def test_validator_unknown_property_kind_is_ignored():
    r = Registry()
    schema = r.load_dict(MINIMAL_SCHEMA)
    schema.types["Dog"].own_properties["mystery"] = object()
    errs = validate(
        {"_type": "Dog", "name": "Rex", "breed": "Lab", "mystery": "x"},
        schema.types["Dog"],
        schema,
        r,
    )
    assert errs == []


def test_validator_json_kind_matches_null_and_boolean():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "x",
        "types": {
            "Foo": {
                "properties": {
                    "n": {"type": "null"},
                    "b": {"type": "boolean"},
                },
                "required": ["n", "b"],
            }
        },
    })
    schema = r.get_schema("x")
    errs = validate({"_type": "Foo", "n": None, "b": True}, schema.types["Foo"], schema, r)
    assert errs == []


def test_validator_json_type_name_branches():
    r = Registry()
    r.load_dict({
        "$oojs": "1.0",
        "$id": "x",
        "types": {
            "Str": {"properties": {"v": {"type": "string"}}},
            "Int": {"properties": {"v": {"type": "integer"}}},
        },
    })
    schema = r.get_schema("x")

    errs = validate({"_type": "Str", "v": None}, schema.types["Str"], schema, r)
    assert any(e.code == ErrorCode.TYPE_MISMATCH and "got null" in e.message for e in errs)

    errs = validate({"_type": "Str", "v": True}, schema.types["Str"], schema, r)
    assert any(e.code == ErrorCode.TYPE_MISMATCH and "got boolean" in e.message for e in errs)

    errs = validate({"_type": "Str", "v": 1.5}, schema.types["Str"], schema, r)
    assert any(e.code == ErrorCode.TYPE_MISMATCH and "got number" in e.message for e in errs)

    errs = validate({"_type": "Int", "v": "abc"}, schema.types["Int"], schema, r)
    assert any(e.code == ErrorCode.TYPE_MISMATCH and "got string" in e.message for e in errs)

    errs = validate({"_type": "Str", "v": object()}, schema.types["Str"], schema, r)
    assert any(e.code == ErrorCode.TYPE_MISMATCH and "got object" in e.message for e in errs)


def test_car_motor_wheels_sample_valid():
    schema = {
        "$oojs": "1.0",
        "$id": "https://example.org/schemas/car",
        "types": {
            "Motor": {
                "properties": {
                    "horsepower": {"type": "number", "minimum": 1},
                    "cylinders": {"type": "integer", "minimum": 1},
                },
                "required": ["horsepower", "cylinders"],
            },
            "Wheel": {
                "properties": {
                    "size": {"type": "number", "minimum": 10},
                    "material": {"type": "string", "enum": ["rubber"]},
                },
                "required": ["size", "material"],
            },
            "Car": {
                "properties": {
                    "make": {"type": "string"},
                    "model": {"type": "string"},
                    "motor": {"type": "Motor"},
                    "wheels": {
                        "type": "array",
                        "items": {"type": "Wheel"},
                        "minItems": 4,
                        "maxItems": 4,
                    },
                },
                "required": ["make", "model", "motor", "wheels"],
            },
        },
    }

    instance = {
        "_type": "Car",
        "make": "Acme",
        "model": "Roadster",
        "motor": {"_type": "Motor", "horsepower": 220, "cylinders": 4},
        "wheels": [
            {"_type": "Wheel", "size": 18, "material": "rubber"},
            {"_type": "Wheel", "size": 18, "material": "rubber"},
            {"_type": "Wheel", "size": 18, "material": "rubber"},
            {"_type": "Wheel", "size": 18, "material": "rubber"},
        ],
    }

    r = Registry()
    loaded = r.load_dict(schema)
    errs = validate(instance, loaded.types["Car"], loaded, r)
    assert errs == []


def test_car_relationships_sample_valid():
    schema = {
        "$oojs": "1.0",
        "$id": "https://example.org/schemas/car-rel",
        "types": {
            "Person": {
                "properties": {
                    "personId": {"type": "string"},
                    "name": {"type": "string"},
                    "carIds": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["personId", "name"],
            },
            "Car": {
                "properties": {
                    "carId": {"type": "string"},
                    "make": {"type": "string"},
                    "model": {"type": "string"},
                    "ownerId": {"type": "string"},
                    "garageId": {"type": "string"},
                },
                "required": ["carId", "make", "model", "ownerId"],
            },
            "Garage": {
                "properties": {
                    "garageId": {"type": "string"},
                    "name": {"type": "string"},
                    "carIds": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["garageId", "name"],
            },
            "Fleet": {
                "properties": {
                    "fleetId": {"type": "string"},
                    "name": {"type": "string"},
                    "carIds": {"type": "array", "items": {"type": "string"}},
                    "personIds": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["fleetId", "name"],
            },
        },
    }

    instance = {
        "_type": "Fleet",
        "fleetId": "fleet-1",
        "name": "City Fleet",
        "carIds": ["car-1", "car-2"],
        "personIds": ["person-1"],
    }

    r = Registry()
    loaded = r.load_dict(schema)
    errs = validate(instance, loaded.types["Fleet"], loaded, r)
    assert errs == []
