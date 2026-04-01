"""
Tests for all four combinations of cardinality × structure (§8.7).

The matrix:

             | Has-one              | Has-many
  -----------+----------------------+-----------------------------
  Vertical   | TypeRefProperty      | ArrayProperty{items:TypeRef}
  (embedded) | Employee.address     | Employee.badges
  -----------+----------------------+-----------------------------
  Horizontal | PrimitiveProperty    | ArrayProperty{items:string}
  (ID ref)   | Employee.departmentId| Employee.projectIds

Uses the relationships.oojs.json / relationships-instances.json example fixtures.
"""

import json
from pathlib import Path

import pytest

from python import Registry
from python.validator import ErrorCode, validate

EXAMPLES = Path(__file__).resolve().parents[2] / "examples"


@pytest.fixture(scope="module")
def rel_schema_and_registry():
    r = Registry()
    schema = r.load_file(str(EXAMPLES / "relationships.oojs.json"))
    return r, schema


@pytest.fixture(scope="module")
def rel_instances():
    return json.loads((EXAMPLES / "relationships-instances.json").read_text())


# ---------------------------------------------------------------------------
# Example file round-trips
# ---------------------------------------------------------------------------

class TestExampleFileRoundTrips:
    def test_valid_instances_all_pass(self, rel_schema_and_registry, rel_instances):
        r, schema = rel_schema_and_registry
        for inst in rel_instances["valid"]:
            clean = {k: v for k, v in inst.items() if k != "_comment"}
            errs = validate(clean, schema.types[clean["_type"]], schema, r)
            assert errs == [], f"Expected valid ({inst.get('_comment', '')}): {errs}"

    def test_invalid_instances_all_fail(self, rel_schema_and_registry, rel_instances):
        r, schema = rel_schema_and_registry
        for inst in rel_instances["invalid"]:
            clean = {k: v for k, v in inst.items() if k != "_comment"}
            type_name = clean.get("_type", "Employee")
            errs = validate(clean, schema.types[type_name], schema, r)
            assert errs, f"Expected errors ({inst.get('_comment', '')})"


# ---------------------------------------------------------------------------
# §8.7 — Has-one vertical (Employee.address → Address embedded)
# ---------------------------------------------------------------------------

class TestHasOneVertical:
    def test_valid(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        emp = {
            "_type": "Employee",
            "employeeId": "emp-001",
            "name": "Alice",
            "departmentId": "dept-eng",
            "address": {"_type": "Address", "street": "1 Main St", "city": "Springfield"},
        }
        assert validate(emp, schema.types["Employee"], schema, r) == []

    def test_optional_may_be_absent(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        emp = {
            "_type": "Employee",
            "employeeId": "emp-002",
            "name": "Bob",
            "departmentId": "dept-ops",
        }
        assert validate(emp, schema.types["Employee"], schema, r) == []

    def test_missing_required_field_in_embedded_object(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        emp = {
            "_type": "Employee",
            "employeeId": "emp-003",
            "name": "Carol",
            "departmentId": "dept-eng",
            "address": {"_type": "Address", "city": "Springfield"},  # street absent
        }
        errs = validate(emp, schema.types["Employee"], schema, r)
        assert any(e.code == ErrorCode.MISSING_REQUIRED for e in errs)

    def test_type_mismatch_wrong_embedded_type(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        emp = {
            "_type": "Employee",
            "employeeId": "emp-004",
            "name": "Dave",
            "departmentId": "dept-eng",
            "address": {"_type": "Badge", "badgeId": "b-1", "label": "X"},
        }
        errs = validate(emp, schema.types["Employee"], schema, r)
        assert any(e.code == ErrorCode.TYPE_MISMATCH for e in errs)

    def test_must_be_object_not_string(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        emp = {
            "_type": "Employee",
            "employeeId": "emp-005",
            "name": "Eve",
            "departmentId": "dept-eng",
            "address": "not-an-object",
        }
        errs = validate(emp, schema.types["Employee"], schema, r)
        assert any(e.code == ErrorCode.TYPE_MISMATCH for e in errs)


# ---------------------------------------------------------------------------
# §8.7 — Has-many vertical (Employee.badges → Badge[] embedded)
# ---------------------------------------------------------------------------

class TestHasManyVertical:
    def test_valid_multiple_items(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        emp = {
            "_type": "Employee",
            "employeeId": "emp-010",
            "name": "Frank",
            "departmentId": "dept-eng",
            "badges": [
                {"_type": "Badge", "badgeId": "b-1", "label": "Safety", "level": 3},
                {"_type": "Badge", "badgeId": "b-2", "label": "Leader"},
            ],
        }
        assert validate(emp, schema.types["Employee"], schema, r) == []

    def test_valid_empty_array(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        emp = {
            "_type": "Employee",
            "employeeId": "emp-011",
            "name": "Grace",
            "departmentId": "dept-hr",
            "badges": [],
        }
        assert validate(emp, schema.types["Employee"], schema, r) == []

    def test_missing_required_field_in_one_item(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        emp = {
            "_type": "Employee",
            "employeeId": "emp-012",
            "name": "Henry",
            "departmentId": "dept-eng",
            "badges": [
                {"_type": "Badge", "badgeId": "b-ok", "label": "OK"},
                {"_type": "Badge", "badgeId": "b-bad"},  # label absent
            ],
        }
        errs = validate(emp, schema.types["Employee"], schema, r)
        assert any(e.code == ErrorCode.MISSING_REQUIRED for e in errs)

    def test_constraint_violation_in_one_item(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        # Badge.level has maximum: 5 — level 10 should fail
        emp = {
            "_type": "Employee",
            "employeeId": "emp-013",
            "name": "Iris",
            "departmentId": "dept-eng",
            "badges": [{"_type": "Badge", "badgeId": "b-1", "label": "Expert", "level": 10}],
        }
        errs = validate(emp, schema.types["Employee"], schema, r)
        assert any(e.code == ErrorCode.ABOVE_MAXIMUM for e in errs)

    def test_must_be_array_not_object(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        emp = {
            "_type": "Employee",
            "employeeId": "emp-014",
            "name": "Jack",
            "departmentId": "dept-eng",
            "badges": {"_type": "Badge", "badgeId": "b-1", "label": "X"},
        }
        errs = validate(emp, schema.types["Employee"], schema, r)
        assert any(e.code == ErrorCode.TYPE_MISMATCH for e in errs)


# ---------------------------------------------------------------------------
# §8.7 — Has-one horizontal (Employee.departmentId → ID string)
# ---------------------------------------------------------------------------

class TestHasOneHorizontal:
    def test_valid(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        emp = {
            "_type": "Employee",
            "employeeId": "emp-020",
            "name": "Karen",
            "departmentId": "dept-eng",
        }
        assert validate(emp, schema.types["Employee"], schema, r) == []

    def test_required_must_be_present(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        emp = {
            "_type": "Employee",
            "employeeId": "emp-021",
            "name": "Leo",
            # departmentId absent
        }
        errs = validate(emp, schema.types["Employee"], schema, r)
        assert any(e.code == ErrorCode.MISSING_REQUIRED for e in errs)

    def test_must_be_string_not_integer(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        emp = {
            "_type": "Employee",
            "employeeId": "emp-022",
            "name": "Mia",
            "departmentId": 42,
        }
        errs = validate(emp, schema.types["Employee"], schema, r)
        assert any(e.code == ErrorCode.TYPE_MISMATCH for e in errs)

    def test_must_be_string_not_array(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        emp = {
            "_type": "Employee",
            "employeeId": "emp-023",
            "name": "Nick",
            "departmentId": ["dept-eng"],
        }
        errs = validate(emp, schema.types["Employee"], schema, r)
        assert any(e.code == ErrorCode.TYPE_MISMATCH for e in errs)

    def test_minlength_enforced(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        # departmentId has minLength: 1 — empty string is invalid
        emp = {
            "_type": "Employee",
            "employeeId": "emp-024",
            "name": "Olivia",
            "departmentId": "",
        }
        errs = validate(emp, schema.types["Employee"], schema, r)
        assert any(e.code == ErrorCode.STRING_TOO_SHORT for e in errs)


# ---------------------------------------------------------------------------
# §8.7 — Has-many horizontal (Employee.projectIds → string[] IDs)
# ---------------------------------------------------------------------------

class TestHasManyHorizontal:
    def test_valid_multiple_ids(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        emp = {
            "_type": "Employee",
            "employeeId": "emp-030",
            "name": "Paul",
            "departmentId": "dept-eng",
            "projectIds": ["proj-alpha", "proj-beta", "proj-gamma"],
        }
        assert validate(emp, schema.types["Employee"], schema, r) == []

    def test_valid_empty_array(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        emp = {
            "_type": "Employee",
            "employeeId": "emp-031",
            "name": "Quinn",
            "departmentId": "dept-eng",
            "projectIds": [],
        }
        assert validate(emp, schema.types["Employee"], schema, r) == []

    def test_item_must_be_string_not_integer(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        emp = {
            "_type": "Employee",
            "employeeId": "emp-032",
            "name": "Rose",
            "departmentId": "dept-eng",
            "projectIds": ["proj-ok", 99],
        }
        errs = validate(emp, schema.types["Employee"], schema, r)
        assert any(e.code == ErrorCode.TYPE_MISMATCH for e in errs)

    def test_must_be_array_not_bare_string(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        emp = {
            "_type": "Employee",
            "employeeId": "emp-033",
            "name": "Sam",
            "departmentId": "dept-eng",
            "projectIds": "proj-alpha",
        }
        errs = validate(emp, schema.types["Employee"], schema, r)
        assert any(e.code == ErrorCode.TYPE_MISMATCH for e in errs)

    def test_all_four_quadrants_together(self, rel_schema_and_registry):
        r, schema = rel_schema_and_registry
        emp = {
            "_type": "Employee",
            "employeeId": "emp-040",
            "name": "Tina",
            "address": {"_type": "Address", "street": "5 Oak Rd", "city": "Shelbyville"},
            "badges": [
                {"_type": "Badge", "badgeId": "b-1", "label": "Expert", "level": 4},
                {"_type": "Badge", "badgeId": "b-2", "label": "Mentor"},
            ],
            "departmentId": "dept-rd",
            "projectIds": ["proj-x", "proj-y"],
        }
        assert validate(emp, schema.types["Employee"], schema, r) == []
