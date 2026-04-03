package org.oojs;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.oojs.model.Schema;

import java.io.File;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Tests for all four combinations of cardinality × structure (§8.7).
 *
 * The matrix:
 *
 *              | Has-one              | Has-many
 *   -----------+----------------------+-----------------------------
 *   Vertical   | TypeRefProperty      | ArrayProperty{items:TypeRef}
 *   (embedded) | Employee.address     | Employee.badges
 *   -----------+----------------------+-----------------------------
 *   Horizontal | IdRefProperty        | ArrayProperty{items:IdRef}
 *   (ID ref)   | Employee.department  | Employee.projects
 *
 * Uses the relationships.oojs.json / relationships-instances.json example fixtures.
 */
@SuppressWarnings("unchecked")
class RelationshipsCardinalityTest extends TestHelpers {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private Registry r;
    private Schema schema;
    private String examples;

    @BeforeEach
    void setUp() throws Exception {
        examples = Paths.get(System.getProperty("user.dir")).getParent().resolve("examples").toString();
        r = new Registry();
        schema = r.loadFile(examples + "/relationships.oojs.json");
    }

    // ------------------------------------------------------------------
    // Example file round-trips
    // ------------------------------------------------------------------

    @Test
    void example_file_valid_instances_all_pass() throws Exception {
        Map<String, Object> data = MAPPER.readValue(
                new File(examples + "/relationships-instances.json"), Map.class);
        List<Map<String, Object>> valid = (List<Map<String, Object>>) data.get("valid");

        for (Map<String, Object> inst : valid) {
            Map<String, Object> clean = new LinkedHashMap<>(inst);
            clean.remove("_comment");
            String typeName = (String) clean.get("_type");
            List<ValidationError> errs = new Validator(r).validate(clean, schema.types.get(typeName), schema);
            assertEquals(List.of(), errs, "Expected valid: " + inst.get("_comment"));
        }
    }

    @Test
    void example_file_invalid_instances_all_fail() throws Exception {
        Map<String, Object> data = MAPPER.readValue(
                new File(examples + "/relationships-instances.json"), Map.class);
        List<Map<String, Object>> invalid = (List<Map<String, Object>>) data.get("invalid");

        for (Map<String, Object> inst : invalid) {
            Map<String, Object> clean = new LinkedHashMap<>(inst);
            clean.remove("_comment");
            String typeName = (String) clean.getOrDefault("_type", "Employee");
            List<ValidationError> errs = new Validator(r).validate(clean, schema.types.get(typeName), schema);
            assertFalse(errs.isEmpty(), "Expected errors: " + inst.get("_comment"));
        }
    }

    // ------------------------------------------------------------------
    // §8.7 — Has-one vertical (Employee.address → Address embedded)
    // ------------------------------------------------------------------

    @Test
    void has_one_vertical_valid() {
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-001",
                "name", "Alice",
                "department", "dept-eng",
                "address", map("_type", "Address", "street", "1 Main St", "city", "Springfield"));

        assertEquals(List.of(), new Validator(r).validate(emp, schema.types.get("Employee"), schema));
    }

    @Test
    void has_one_vertical_optional_may_be_absent() {
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-002",
                "name", "Bob",
                "department", "dept-ops");

        assertEquals(List.of(), new Validator(r).validate(emp, schema.types.get("Employee"), schema));
    }

    @Test
    void has_one_vertical_missing_required_field_in_embedded_object() {
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-003",
                "name", "Carol",
                "department", "dept-eng",
                "address", map("_type", "Address", "city", "Springfield")); // street absent

        List<ValidationError> errs = new Validator(r).validate(emp, schema.types.get("Employee"), schema);
        assertTrue(hasCode(errs, ErrorCode.MISSING_REQUIRED));
    }

    @Test
    void has_one_vertical_type_mismatch_wrong_embedded_type() {
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-004",
                "name", "Dave",
                "department", "dept-eng",
                "address", map("_type", "Badge", "badgeId", "b-1", "label", "X"));

        List<ValidationError> errs = new Validator(r).validate(emp, schema.types.get("Employee"), schema);
        assertTrue(hasCode(errs, ErrorCode.TYPE_MISMATCH));
    }

    @Test
    void has_one_vertical_must_be_object_not_string() {
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-005",
                "name", "Eve",
                "department", "dept-eng",
                "address", "not-an-object");

        List<ValidationError> errs = new Validator(r).validate(emp, schema.types.get("Employee"), schema);
        assertTrue(hasCode(errs, ErrorCode.TYPE_MISMATCH));
    }

    // ------------------------------------------------------------------
    // §8.7 — Has-many vertical (Employee.badges → Badge[] embedded)
    // ------------------------------------------------------------------

    @Test
    void has_many_vertical_valid_multiple_items() {
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-010",
                "name", "Frank",
                "department", "dept-eng",
                "badges", list(
                        map("_type", "Badge", "badgeId", "b-1", "label", "Safety", "level", 3),
                        map("_type", "Badge", "badgeId", "b-2", "label", "Leader")));

        assertEquals(List.of(), new Validator(r).validate(emp, schema.types.get("Employee"), schema));
    }

    @Test
    void has_many_vertical_valid_empty_array() {
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-011",
                "name", "Grace",
                "department", "dept-hr",
                "badges", list());

        assertEquals(List.of(), new Validator(r).validate(emp, schema.types.get("Employee"), schema));
    }

    @Test
    void has_many_vertical_missing_required_field_in_one_item() {
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-012",
                "name", "Henry",
                "department", "dept-eng",
                "badges", list(
                        map("_type", "Badge", "badgeId", "b-ok", "label", "OK"),
                        map("_type", "Badge", "badgeId", "b-bad"))); // label absent

        List<ValidationError> errs = new Validator(r).validate(emp, schema.types.get("Employee"), schema);
        assertTrue(hasCode(errs, ErrorCode.MISSING_REQUIRED));
    }

    @Test
    void has_many_vertical_constraint_violation_in_one_item() {
        // Badge.level has maximum: 5 — level 10 should fail
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-013",
                "name", "Iris",
                "department", "dept-eng",
                "badges", list(
                        map("_type", "Badge", "badgeId", "b-1", "label", "Expert", "level", 10)));

        List<ValidationError> errs = new Validator(r).validate(emp, schema.types.get("Employee"), schema);
        assertTrue(hasCode(errs, ErrorCode.ABOVE_MAXIMUM));
    }

    @Test
    void has_many_vertical_must_be_array_not_object() {
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-014",
                "name", "Jack",
                "department", "dept-eng",
                "badges", map("_type", "Badge", "badgeId", "b-1", "label", "X"));

        List<ValidationError> errs = new Validator(r).validate(emp, schema.types.get("Employee"), schema);
        assertTrue(hasCode(errs, ErrorCode.TYPE_MISMATCH));
    }

    // ------------------------------------------------------------------
    // §8.7 — Has-one horizontal (Employee.department → Department ID via refType)
    // ------------------------------------------------------------------

    @Test
    void has_one_horizontal_valid() {
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-020",
                "name", "Karen",
                "department", "dept-eng");

        assertEquals(List.of(), new Validator(r).validate(emp, schema.types.get("Employee"), schema));
    }

    @Test
    void has_one_horizontal_required_must_be_present() {
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-021",
                "name", "Leo"); // department absent

        List<ValidationError> errs = new Validator(r).validate(emp, schema.types.get("Employee"), schema);
        assertTrue(hasCode(errs, ErrorCode.MISSING_REQUIRED));
    }

    @Test
    void has_one_horizontal_must_be_string_not_integer() {
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-022",
                "name", "Mia",
                "department", 42);

        List<ValidationError> errs = new Validator(r).validate(emp, schema.types.get("Employee"), schema);
        assertTrue(hasCode(errs, ErrorCode.TYPE_MISMATCH));
    }

    @Test
    void has_one_horizontal_must_be_string_not_array() {
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-023",
                "name", "Nick",
                "department", list("dept-eng"));

        List<ValidationError> errs = new Validator(r).validate(emp, schema.types.get("Employee"), schema);
        assertTrue(hasCode(errs, ErrorCode.TYPE_MISMATCH));
    }

    @Test
    void has_one_horizontal_minlength_enforced() {
        // department has minLength: 1 — empty string is invalid
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-024",
                "name", "Olivia",
                "department", "");

        List<ValidationError> errs = new Validator(r).validate(emp, schema.types.get("Employee"), schema);
        assertTrue(hasCode(errs, ErrorCode.STRING_TOO_SHORT));
    }

    // ------------------------------------------------------------------
    // §8.7 — Has-many horizontal (Employee.projects → Project ID array via refType)
    // ------------------------------------------------------------------

    @Test
    void has_many_horizontal_valid_multiple_ids() {
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-030",
                "name", "Paul",
                "department", "dept-eng",
                "projects", list("proj-alpha", "proj-beta", "proj-gamma"));

        assertEquals(List.of(), new Validator(r).validate(emp, schema.types.get("Employee"), schema));
    }

    @Test
    void has_many_horizontal_valid_empty_array() {
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-031",
                "name", "Quinn",
                "department", "dept-eng",
                "projects", list());

        assertEquals(List.of(), new Validator(r).validate(emp, schema.types.get("Employee"), schema));
    }

    @Test
    void has_many_horizontal_item_must_be_string_not_integer() {
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-032",
                "name", "Rose",
                "department", "dept-eng",
                "projects", list("proj-ok", 99));

        List<ValidationError> errs = new Validator(r).validate(emp, schema.types.get("Employee"), schema);
        assertTrue(hasCode(errs, ErrorCode.TYPE_MISMATCH));
    }

    @Test
    void has_many_horizontal_must_be_array_not_string() {
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-033",
                "name", "Sam",
                "department", "dept-eng",
                "projects", "proj-alpha");

        List<ValidationError> errs = new Validator(r).validate(emp, schema.types.get("Employee"), schema);
        assertTrue(hasCode(errs, ErrorCode.TYPE_MISMATCH));
    }

    @Test
    void has_many_horizontal_all_four_present_together() {
        Map<String, Object> emp = map(
                "_type", "Employee",
                "employeeId", "emp-040",
                "name", "Tina",
                "address", map("_type", "Address", "street", "5 Oak Rd", "city", "Shelbyville"),
                "badges", list(
                        map("_type", "Badge", "badgeId", "b-1", "label", "Expert", "level", 4),
                        map("_type", "Badge", "badgeId", "b-2", "label", "Mentor")),
                "department", "dept-rd",
                "projects", list("proj-x", "proj-y"));

        assertEquals(List.of(), new Validator(r).validate(emp, schema.types.get("Employee"), schema));
    }
}
