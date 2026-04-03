"""Tests for IdRefProperty (§6.4) — typed horizontal references via refType."""

import pytest

from oojs import Registry, SchemaError
from oojs.validator import ErrorCode, validate


def idref_schema_dict():
    return {
        "$oojs": "1.0",
        "$id": "https://example.org/schemas/idref",
        "discriminator": "_type",
        "types": {
            "Department": {
                "properties": {
                    "deptId": {"type": "string", "minLength": 1},
                    "name": {"type": "string", "minLength": 1},
                },
                "required": ["deptId", "name"],
            },
            "Project": {
                "properties": {
                    "projectId": {"type": "string", "minLength": 1},
                    "title": {"type": "string", "minLength": 1},
                },
                "required": ["projectId", "title"],
            },
            "Employee": {
                "properties": {
                    "employeeId": {"type": "string", "minLength": 1},
                    "name": {"type": "string", "minLength": 1},
                    "department": {"refType": "Department", "minLength": 1},
                    "projects": {"type": "array", "items": {"refType": "Project"}},
                },
                "required": ["employeeId", "name", "department"],
            },
        },
    }


@pytest.fixture
def idref_registry_and_schema():
    r = Registry()
    schema = r.load_dict(idref_schema_dict())
    return r, schema


class TestIdRefSchemaLoading:
    def test_valid_schema_loads(self, idref_registry_and_schema):
        r, schema = idref_registry_and_schema
        assert "Employee" in schema.types
        assert "Department" in schema.types
        assert "Project" in schema.types

    def test_unknown_reftype_raises_schema_error(self):
        r = Registry()
        with pytest.raises(SchemaError):
            r.load_dict({
                "$oojs": "1.0",
                "$id": "https://example.org/schemas/bad",
                "types": {
                    "Foo": {
                        "properties": {"bar": {"refType": "NonExistent"}},
                    },
                },
            })

    def test_both_type_and_reftype_raises_schema_error(self):
        r = Registry()
        with pytest.raises(SchemaError):
            r.load_dict({
                "$oojs": "1.0",
                "$id": "https://example.org/schemas/both",
                "types": {
                    "Target": {"properties": {"x": {"type": "string"}}},
                    "Src": {
                        "properties": {"prop": {"type": "Target", "refType": "Target"}},
                    },
                },
            })

    def test_neither_type_nor_reftype_raises_schema_error(self):
        r = Registry()
        with pytest.raises(SchemaError):
            r.load_dict({
                "$oojs": "1.0",
                "$id": "https://example.org/schemas/neither",
                "types": {
                    "Foo": {
                        "properties": {"bar": {"title": "no type keyword"}},
                    },
                },
            })


class TestIdRefValidation:
    def test_valid_string_id_accepted(self, idref_registry_and_schema):
        r, schema = idref_registry_and_schema
        emp = {"_type": "Employee", "employeeId": "e-1", "name": "Alice", "department": "dept-eng"}
        assert validate(emp, schema.types["Employee"], schema, r) == []

    def test_integer_value_rejected(self, idref_registry_and_schema):
        r, schema = idref_registry_and_schema
        emp = {"_type": "Employee", "employeeId": "e-2", "name": "Bob", "department": 42}
        errs = validate(emp, schema.types["Employee"], schema, r)
        assert any(e.code == ErrorCode.TYPE_MISMATCH for e in errs)

    def test_object_value_rejected(self, idref_registry_and_schema):
        r, schema = idref_registry_and_schema
        emp = {
            "_type": "Employee",
            "employeeId": "e-3",
            "name": "Carol",
            "department": {"_type": "Department", "deptId": "d-1", "name": "Eng"},
        }
        errs = validate(emp, schema.types["Employee"], schema, r)
        assert any(e.code == ErrorCode.TYPE_MISMATCH for e in errs)

    def test_minlength_constraint_enforced(self, idref_registry_and_schema):
        r, schema = idref_registry_and_schema
        emp = {"_type": "Employee", "employeeId": "e-4", "name": "Dave", "department": ""}
        errs = validate(emp, schema.types["Employee"], schema, r)
        assert any(e.code == ErrorCode.STRING_TOO_SHORT for e in errs)

    def test_array_of_reftype_ids_valid(self, idref_registry_and_schema):
        r, schema = idref_registry_and_schema
        emp = {
            "_type": "Employee",
            "employeeId": "e-5",
            "name": "Eve",
            "department": "dept-ops",
            "projects": ["proj-a", "proj-b"],
        }
        assert validate(emp, schema.types["Employee"], schema, r) == []

    def test_array_item_not_string_rejected(self, idref_registry_and_schema):
        r, schema = idref_registry_and_schema
        emp = {
            "_type": "Employee",
            "employeeId": "e-6",
            "name": "Frank",
            "department": "dept-ops",
            "projects": ["proj-a", 99],
        }
        errs = validate(emp, schema.types["Employee"], schema, r)
        assert any(e.code == ErrorCode.TYPE_MISMATCH for e in errs)

    def test_pattern_constraint_enforced(self):
        r = Registry()
        schema = r.load_dict({
            "$oojs": "1.0",
            "$id": "https://example.org/schemas/idref-pattern",
            "types": {
                "Target": {
                    "properties": {"targetId": {"type": "string"}},
                    "required": ["targetId"],
                },
                "Source": {
                    "properties": {
                        "targetRef": {"refType": "Target", "pattern": "^[a-z]+-[0-9]+$"},
                    },
                    "required": ["targetRef"],
                },
            },
        })
        good = {"_type": "Source", "targetRef": "item-42"}
        assert validate(good, schema.types["Source"], schema, r) == []

        bad = {"_type": "Source", "targetRef": "ITEM42"}
        errs = validate(bad, schema.types["Source"], schema, r)
        assert any(e.code == ErrorCode.PATTERN_MISMATCH for e in errs)

    def test_maxlength_constraint_enforced(self):
        r = Registry()
        schema = r.load_dict({
            "$oojs": "1.0",
            "$id": "https://example.org/schemas/idref-maxlen",
            "types": {
                "Target": {"properties": {"x": {"type": "string"}}},
                "Source": {
                    "properties": {
                        "ref": {"refType": "Target", "maxLength": 5},
                    },
                    "required": ["ref"],
                },
            },
        })
        good = {"_type": "Source", "ref": "abc"}
        assert validate(good, schema.types["Source"], schema, r) == []

        bad = {"_type": "Source", "ref": "this-is-too-long"}
        errs = validate(bad, schema.types["Source"], schema, r)
        assert any(e.code == ErrorCode.STRING_TOO_LONG for e in errs)
