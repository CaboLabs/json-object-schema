package org.oojs;

import com.fasterxml.jackson.databind.ObjectMapper;
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

class GraphDocumentTest extends TestHelpers {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private Map<String, Object> employeeSchema() {
        return map(
                "$oojs", "1.0",
                "$id", "https://example.org/schemas/employees",
                "types", map(
                        "Department", map(
                                "properties", map(
                                        "departmentId", map("type", "string"),
                                        "name", map("type", "string")),
                                "required", list("departmentId", "name")),
                        "Employee", map(
                                "properties", map(
                                        "employeeId", map("type", "string"),
                                        "name", map("type", "string"),
                                        "department", map("type", "Department"),
                                        "manager", map("type", "Employee")),
                                "required", list("employeeId", "name", "department"))));
    }

    @Test
    void two_employees_sharing_one_department() {
        Registry r = new Registry();
        Schema schema = r.loadMap(employeeSchema());

        Map<String, Object> graphDoc = map(
                "$oojs", "1.0",
                "roots", list(
                        map("$type", "Employee", "$id", "emp-alice", "employeeId", "E-001", "name", "Alice",
                                "department", map("$ref-id", "dept-eng")),
                        map("$type", "Employee", "$id", "emp-bob", "employeeId", "E-002", "name", "Bob",
                                "department", map("$ref-id", "dept-eng"))),
                "objects", map(
                        "dept-eng", map("$type", "Department", "$id", "dept-eng", "departmentId", "D-01", "name", "Engineering")));

        List<ValidationError> errs = new Validator(r).validateGraphDocument(graphDoc, schema);
        assertEquals(List.of(), errs);
    }

    @Test
    void graph_with_optional_manager_reference() {
        Registry r = new Registry();
        Schema schema = r.loadMap(employeeSchema());

        Map<String, Object> graphDoc = map(
                "$oojs", "1.0",
                "roots", list(
                        map("$type", "Employee", "$id", "emp-alice", "employeeId", "E-001", "name", "Alice",
                                "department", map("$ref-id", "dept-eng")),
                        map("$type", "Employee", "$id", "emp-carol", "employeeId", "E-003", "name", "Carol",
                                "department", map("$ref-id", "dept-eng"), "manager", map("$ref-id", "emp-alice"))),
                "objects", map(
                        "dept-eng", map("$type", "Department", "$id", "dept-eng", "departmentId", "D-01", "name", "Engineering")));

        List<ValidationError> errs = new Validator(r).validateGraphDocument(graphDoc, schema);
        assertEquals(List.of(), errs);
    }

    @Test
    void graph_with_no_objects_map() {
        Registry r = new Registry();
        Schema schema = r.loadMap(map(
                "$oojs", "1.0",
                "$id", "https://example.org/schemas/simple",
                "types", map("Tag", map(
                        "properties", map("tagId", map("type", "string"), "label", map("type", "string")),
                        "required", list("tagId", "label")))));

        Map<String, Object> graphDoc = map(
                "$oojs", "1.0",
                "roots", list(
                        map("$type", "Tag", "$id", "tag-1", "tagId", "T-1", "label", "alpha"),
                        map("$type", "Tag", "$id", "tag-2", "tagId", "T-2", "label", "beta")));

        List<ValidationError> errs = new Validator(r).validateGraphDocument(graphDoc, schema);
        assertEquals(List.of(), errs);
    }

    @Test
    void mutual_manager_cycle_does_not_hang() {
        Registry r = new Registry();
        Schema schema = r.loadMap(employeeSchema());

        Map<String, Object> graphDoc = map(
                "$oojs", "1.0",
                "roots", list(
                        map("$type", "Employee", "$id", "emp-alice", "employeeId", "E-001", "name", "Alice",
                                "department", map("$ref-id", "dept-eng"), "manager", map("$ref-id", "emp-bob")),
                        map("$type", "Employee", "$id", "emp-bob", "employeeId", "E-002", "name", "Bob",
                                "department", map("$ref-id", "dept-eng"), "manager", map("$ref-id", "emp-alice"))),
                "objects", map(
                        "dept-eng", map("$type", "Department", "$id", "dept-eng", "departmentId", "D-01", "name", "Engineering")));

        List<ValidationError> errs = new Validator(r).validateGraphDocument(graphDoc, schema);
        assertEquals(List.of(), errs);
    }

    @Test
    void three_node_cycle_does_not_hang() {
        Registry r = new Registry();
        Schema schema = r.loadMap(employeeSchema());

        Map<String, Object> graphDoc = map(
                "$oojs", "1.0",
                "roots", list(
                        map("$type", "Employee", "$id", "emp-a", "employeeId", "E-A", "name", "Alpha",
                                "department", map("$ref-id", "dept-eng"), "manager", map("$ref-id", "emp-b")),
                        map("$type", "Employee", "$id", "emp-b", "employeeId", "E-B", "name", "Beta",
                                "department", map("$ref-id", "dept-eng"), "manager", map("$ref-id", "emp-c")),
                        map("$type", "Employee", "$id", "emp-c", "employeeId", "E-C", "name", "Gamma",
                                "department", map("$ref-id", "dept-eng"), "manager", map("$ref-id", "emp-a"))),
                "objects", map(
                        "dept-eng", map("$type", "Department", "$id", "dept-eng", "departmentId", "D-01", "name", "Engineering")));

        List<ValidationError> errs = new Validator(r).validateGraphDocument(graphDoc, schema);
        assertEquals(List.of(), errs);
    }

    @Test
    void missing_required_field_in_root_object() {
        Registry r = new Registry();
        Schema schema = r.loadMap(employeeSchema());

        Map<String, Object> graphDoc = map(
                "$oojs", "1.0",
                "roots", list(
                        map("$type", "Employee", "$id", "emp-alice", "name", "Alice",
                                "department", map("$ref-id", "dept-eng"))),
                "objects", map(
                        "dept-eng", map("$type", "Department", "$id", "dept-eng", "departmentId", "D-01", "name", "Engineering")));

        List<ValidationError> errs = new Validator(r).validateGraphDocument(graphDoc, schema);
        assertFalse(errs.isEmpty());
        assertTrue(hasCode(errs, ErrorCode.MISSING_REQUIRED));
    }

    @Test
    void missing_required_field_in_objects_map() {
        Registry r = new Registry();
        Schema schema = r.loadMap(employeeSchema());

        Map<String, Object> graphDoc = map(
                "$oojs", "1.0",
                "roots", list(
                        map("$type", "Employee", "$id", "emp-alice", "employeeId", "E-001", "name", "Alice",
                                "department", map("$ref-id", "dept-eng"))),
                "objects", map(
                        "dept-eng", map("$type", "Department", "$id", "dept-eng")));

        List<ValidationError> errs = new Validator(r).validateGraphDocument(graphDoc, schema);
        assertFalse(errs.isEmpty());
        assertTrue(hasCode(errs, ErrorCode.MISSING_REQUIRED));
    }

    @Test
    void unresolved_ref_id_produces_error() {
        Registry r = new Registry();
        Schema schema = r.loadMap(employeeSchema());

        Map<String, Object> graphDoc = map(
                "$oojs", "1.0",
                "roots", list(
                        map("$type", "Employee", "$id", "emp-alice", "employeeId", "E-001", "name", "Alice",
                                "department", map("$ref-id", "does-not-exist"))));

        List<ValidationError> errs = new Validator(r).validateGraphDocument(graphDoc, schema);
        assertFalse(errs.isEmpty());
        assertTrue(hasCode(errs, ErrorCode.UNRESOLVED_REFERENCE));
    }

    @Test
    void ref_id_type_mismatch_produces_error() {
        Registry r = new Registry();
        Schema schema = r.loadMap(employeeSchema());

        Map<String, Object> graphDoc = map(
                "$oojs", "1.0",
                "roots", list(
                        map("$type", "Employee", "$id", "emp-alice", "employeeId", "E-001", "name", "Alice",
                                "department", map("$ref-id", "not-a-dept"))),
                "objects", map(
                        "not-a-dept", map("$type", "Employee", "$id", "not-a-dept", "employeeId", "E-999", "name", "Impostor",
                                "department", map("$ref-id", "not-a-dept"))));

        List<ValidationError> errs = new Validator(r).validateGraphDocument(graphDoc, schema);
        assertFalse(errs.isEmpty());
        assertTrue(hasCode(errs, ErrorCode.TYPE_MISMATCH));
    }

    @Test
    void root_missing_type_produces_error() {
        Registry r = new Registry();
        Schema schema = r.loadMap(employeeSchema());

        Map<String, Object> graphDoc = map(
                "$oojs", "1.0",
                "roots", list(
                        map("$id", "emp-alice", "employeeId", "E-001", "name", "Alice")));

        List<ValidationError> errs = new Validator(r).validateGraphDocument(graphDoc, schema);
        assertFalse(errs.isEmpty());
        assertTrue(hasCode(errs, ErrorCode.MISSING_DISCRIMINATOR));
    }

    @Test
    @SuppressWarnings("unchecked")
    void graph_document_example_file() throws Exception {
        String examples = Paths.get(System.getProperty("user.dir")).getParent().resolve("examples").toString();
        Registry r = new Registry();
        Schema schema = r.loadFile(examples + "/graph-document.oojs.json");
        Map<String, Object> graphDoc = MAPPER.readValue(new File(examples + "/graph-document.json"), Map.class);

        Map<String, Object> cleanDoc = new LinkedHashMap<>(graphDoc);
        cleanDoc.remove("_comment");

        List<ValidationError> errs = new Validator(r).validateGraphDocument(cleanDoc, schema);
        assertEquals(List.of(), errs);
    }
}
