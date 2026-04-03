package org.oojs;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.oojs.model.Schema;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for IdRefProperty (§6.4) — typed horizontal references via refType.
 */
@SuppressWarnings("unchecked")
class IdRefPropertyTest extends TestHelpers {

    private Registry r;
    private Schema schema;

    private static java.util.Map<String, Object> idRefSchemaDict() {
        return map(
                "$oojs", "1.0",
                "$id", "https://example.org/schemas/idref",
                "discriminator", "_type",
                "types", map(
                        "Department", map(
                                "properties", map(
                                        "deptId", map("type", "string", "minLength", 1),
                                        "name",   map("type", "string", "minLength", 1)),
                                "required", list("deptId", "name")),
                        "Project", map(
                                "properties", map(
                                        "projectId", map("type", "string", "minLength", 1),
                                        "title",     map("type", "string", "minLength", 1)),
                                "required", list("projectId", "title")),
                        "Employee", map(
                                "properties", map(
                                        "employeeId",  map("type", "string", "minLength", 1),
                                        "name",        map("type", "string", "minLength", 1),
                                        "department",  map("refType", "Department", "minLength", 1),
                                        "projects",    map("type", "array", "items", map("refType", "Project"))),
                                "required", list("employeeId", "name", "department"))));
    }

    @BeforeEach
    void setUp() {
        r = new Registry();
        schema = r.loadMap(idRefSchemaDict());
    }

    // -- Schema loading -------------------------------------------------------

    @Test
    void valid_schema_loads() {
        assertTrue(schema.types.containsKey("Employee"));
        assertTrue(schema.types.containsKey("Department"));
        assertTrue(schema.types.containsKey("Project"));
    }

    @Test
    void unknown_reftype_causes_schema_error() {
        assertThrows(SchemaError.class, () -> new Registry().loadMap(map(
                "$oojs", "1.0",
                "$id", "https://example.org/schemas/bad",
                "types", map("Foo", map(
                        "properties", map("bar", map("refType", "NonExistent")))))));
    }

    @Test
    void both_type_and_reftype_causes_schema_error() {
        assertThrows(SchemaError.class, () -> new Registry().loadMap(map(
                "$oojs", "1.0",
                "$id", "https://example.org/schemas/both",
                "types", map(
                        "Target", map("properties", map("x", map("type", "string"))),
                        "Src", map("properties", map("prop",
                                map("type", "Target", "refType", "Target")))))));
    }

    @Test
    void neither_type_nor_reftype_causes_schema_error() {
        assertThrows(SchemaError.class, () -> new Registry().loadMap(map(
                "$oojs", "1.0",
                "$id", "https://example.org/schemas/neither",
                "types", map("Foo", map(
                        "properties", map("bar", map("title", "no type keyword")))))));
    }

    // -- Validation -----------------------------------------------------------

    @Test
    void valid_string_id_accepted() {
        List<ValidationError> errs = new Validator(r).validate(
                map("_type", "Employee", "employeeId", "e-1", "name", "Alice", "department", "dept-eng"),
                schema.types.get("Employee"), schema);
        assertTrue(errs.isEmpty());
    }

    @Test
    void integer_value_rejected_with_type_mismatch() {
        List<ValidationError> errs = new Validator(r).validate(
                map("_type", "Employee", "employeeId", "e-2", "name", "Bob", "department", 42),
                schema.types.get("Employee"), schema);
        assertTrue(hasCode(errs, ErrorCode.TYPE_MISMATCH));
    }

    @Test
    void object_value_rejected_with_type_mismatch() {
        List<ValidationError> errs = new Validator(r).validate(
                map("_type", "Employee", "employeeId", "e-3", "name", "Carol",
                        "department", map("_type", "Department", "deptId", "d-1", "name", "Eng")),
                schema.types.get("Employee"), schema);
        assertTrue(hasCode(errs, ErrorCode.TYPE_MISMATCH));
    }

    @Test
    void minlength_constraint_enforced() {
        List<ValidationError> errs = new Validator(r).validate(
                map("_type", "Employee", "employeeId", "e-4", "name", "Dave", "department", ""),
                schema.types.get("Employee"), schema);
        assertTrue(hasCode(errs, ErrorCode.STRING_TOO_SHORT));
    }

    @Test
    void array_of_reftype_ids_valid() {
        List<ValidationError> errs = new Validator(r).validate(
                map("_type", "Employee", "employeeId", "e-5", "name", "Eve",
                        "department", "dept-ops",
                        "projects", list("proj-a", "proj-b")),
                schema.types.get("Employee"), schema);
        assertTrue(errs.isEmpty());
    }

    @Test
    void array_item_not_string_rejected() {
        List<ValidationError> errs = new Validator(r).validate(
                map("_type", "Employee", "employeeId", "e-6", "name", "Frank",
                        "department", "dept-ops",
                        "projects", list("proj-a", 99)),
                schema.types.get("Employee"), schema);
        assertTrue(hasCode(errs, ErrorCode.TYPE_MISMATCH));
    }

    @Test
    void pattern_constraint_enforced() {
        Registry r2 = new Registry();
        Schema s2 = r2.loadMap(map(
                "$oojs", "1.0",
                "$id", "https://example.org/schemas/idref-pattern",
                "types", map(
                        "Target", map(
                                "properties", map("targetId", map("type", "string")),
                                "required", list("targetId")),
                        "Source", map(
                                "properties", map("targetRef",
                                        map("refType", "Target", "pattern", "^[a-z]+-[0-9]+$")),
                                "required", list("targetRef")))));

        List<ValidationError> ok = new Validator(r2).validate(
                map("_type", "Source", "targetRef", "item-42"),
                s2.types.get("Source"), s2);
        assertTrue(ok.isEmpty());

        List<ValidationError> bad = new Validator(r2).validate(
                map("_type", "Source", "targetRef", "ITEM42"),
                s2.types.get("Source"), s2);
        assertTrue(hasCode(bad, ErrorCode.PATTERN_MISMATCH));
    }

    @Test
    void maxlength_constraint_enforced() {
        Registry r2 = new Registry();
        Schema s2 = r2.loadMap(map(
                "$oojs", "1.0",
                "$id", "https://example.org/schemas/idref-maxlen",
                "types", map(
                        "Target", map("properties", map("x", map("type", "string"))),
                        "Source", map(
                                "properties", map("ref", map("refType", "Target", "maxLength", 5)),
                                "required", list("ref")))));

        List<ValidationError> ok = new Validator(r2).validate(
                map("_type", "Source", "ref", "abc"),
                s2.types.get("Source"), s2);
        assertTrue(ok.isEmpty());

        List<ValidationError> bad = new Validator(r2).validate(
                map("_type", "Source", "ref", "this-is-too-long"),
                s2.types.get("Source"), s2);
        assertTrue(hasCode(bad, ErrorCode.STRING_TOO_LONG));
    }
}
