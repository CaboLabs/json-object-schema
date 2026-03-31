package org.oojs;

import org.junit.jupiter.api.Test;
import org.oojs.model.Schema;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CycleTest extends TestHelpers {

    @Test
    void self_referential_type_schema_loads_without_error() {
        Registry r = new Registry();
        Schema schema = r.loadMap(map(
                "$oojs", "1.0",
                "$id", "https://example.org/schemas/self-ref",
                "types", map(
                        "Employee", map(
                                "properties", map(
                                        "employeeId", map("type", "string"),
                                        "name", map("type", "string"),
                                        "manager", map("type", "Employee")),
                                "required", list("employeeId", "name")))));

        assertTrue(schema.types.containsKey("Employee"));
    }

    @Test
    void two_type_cycle_schema_loads_without_error() {
        Registry r = new Registry();
        Schema schema = r.loadMap(map(
                "$oojs", "1.0",
                "$id", "https://example.org/schemas/two-cycle",
                "types", map(
                        "Employee", map(
                                "properties", map(
                                        "employeeId", map("type", "string"),
                                        "name", map("type", "string"),
                                        "department", map("type", "Department")),
                                "required", list("employeeId", "name")),
                        "Department", map(
                                "properties", map(
                                        "departmentId", map("type", "string"),
                                        "name", map("type", "string"),
                                        "head", map("type", "Employee")),
                                "required", list("departmentId", "name")))));

        assertTrue(schema.types.containsKey("Employee"));
        assertTrue(schema.types.containsKey("Department"));
    }

    @Test
    void three_type_cycle_schema_loads_without_error() {
        Registry r = new Registry();
        Schema schema = r.loadMap(map(
                "$oojs", "1.0",
                "$id", "https://example.org/schemas/three-cycle",
                "types", map(
                        "A", map("properties", map("id", map("type", "string"), "b", map("type", "B")), "required", list("id")),
                        "B", map("properties", map("id", map("type", "string"), "c", map("type", "C")), "required", list("id")),
                        "C", map("properties", map("id", map("type", "string"), "a", map("type", "A")), "required", list("id")))));

        assertTrue(schema.types.containsKey("A"));
        assertTrue(schema.types.containsKey("B"));
        assertTrue(schema.types.containsKey("C"));
    }

    @Test
    void self_referential_type_instance_no_manager_valid() {
        Registry r = new Registry();
        Schema schema = r.loadMap(map(
                "$oojs", "1.0",
                "$id", "https://example.org/schemas/self-ref2",
                "types", map(
                        "Employee", map(
                                "properties", map(
                                        "employeeId", map("type", "string"),
                                        "name", map("type", "string"),
                                        "manager", map("type", "Employee")),
                                "required", list("employeeId", "name")))));

        Map<String, Object> employee = map(
                "_type", "Employee",
                "employeeId", "E-001",
                "name", "Alice");

        List<ValidationError> errs = new Validator(r).validate(employee, schema.types.get("Employee"), schema);
        assertEquals(List.of(), errs);
    }

    @Test
    void self_referential_type_instance_depth_three_valid() {
        Registry r = new Registry();
        Schema schema = r.loadMap(map(
                "$oojs", "1.0",
                "$id", "https://example.org/schemas/self-ref3",
                "types", map(
                        "Employee", map(
                                "properties", map(
                                        "employeeId", map("type", "string"),
                                        "name", map("type", "string"),
                                        "manager", map("type", "Employee")),
                                "required", list("employeeId", "name")))));

        Map<String, Object> alice = map(
                "_type", "Employee",
                "employeeId", "E-001",
                "name", "Alice",
                "manager", map(
                        "_type", "Employee",
                        "employeeId", "E-002",
                        "name", "Bob",
                        "manager", map(
                                "_type", "Employee",
                                "employeeId", "E-003",
                                "name", "Carol")));

        List<ValidationError> errs = new Validator(r).validate(alice, schema.types.get("Employee"), schema);
        assertEquals(List.of(), errs);
    }

    @Test
    void three_type_cycle_instance_valid() {
        Registry r = new Registry();
        Schema schema = r.loadMap(map(
                "$oojs", "1.0",
                "$id", "https://example.org/schemas/three-cycle-inst",
                "types", map(
                        "A", map("properties", map("id", map("type", "string"), "b", map("type", "B")), "required", list("id")),
                        "B", map("properties", map("id", map("type", "string"), "c", map("type", "C")), "required", list("id")),
                        "C", map("properties", map("id", map("type", "string"), "a", map("type", "A")), "required", list("id")))));

        Map<String, Object> instance = map(
                "_type", "A",
                "id", "a-1",
                "b", map(
                        "_type", "B",
                        "id", "b-1",
                        "c", map("_type", "C", "id", "c-1")));

        List<ValidationError> errs = new Validator(r).validate(instance, schema.types.get("A"), schema);
        assertEquals(List.of(), errs);
    }
}
