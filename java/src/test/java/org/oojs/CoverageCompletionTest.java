package org.oojs;

import org.junit.jupiter.api.Test;
import org.oojs.model.Schema;

import java.io.File;
import java.io.FileWriter;
import java.nio.file.Files;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class CoverageCompletionTest extends TestHelpers {

    @Test void validation_error_to_string() {
        ValidationError err = new ValidationError("/x", ErrorCode.MISSING_REQUIRED, "missing");
        assertEquals("/x: [MISSING_REQUIRED] missing", err.toString());
    }

    @Test void registry_load_json_invalid() {
        SchemaError e = assertThrows(SchemaError.class, () -> new Registry().loadJson("{"));
        assertTrue(e.getMessage().contains("invalid JSON"));
    }

    @Test void registry_load_file_missing() {
        SchemaError e = assertThrows(SchemaError.class, () -> new Registry().loadFile("/tmp/does-not-exist-oojs-test"));
        assertTrue(e.getMessage().contains("Cannot read file"));
    }

    @Test void registry_load_file_and_resolve_type() throws Exception {
        File tmp = Files.createTempFile("oojs", ".json").toFile();
        try {
            try (FileWriter fw = new FileWriter(tmp)) {
                fw.write(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(minimalSchema()));
            }
            Registry r = new Registry();
            Schema schema = r.loadFile(tmp.getAbsolutePath());
            assertEquals("https://example.org/schemas/test", schema.schemaId);
            assertNotNull(r.resolveType("Dog", schema));
            assertNull(r.resolveType("Missing", schema));
            assertNull(r.resolveType("unknown.Dog", schema));
            assertNotNull(r.resolveTypeIn("Dog", schema.schemaId));
            assertNull(r.resolveTypeIn("Missing", schema.schemaId));
            assertNull(r.resolveTypeIn("Dog", "missing-schema"));
        } finally {
            tmp.delete();
        }
    }

    @Test void registry_parse_array_property_rejects_invalid_unique_items() {
        SchemaError e = assertThrows(SchemaError.class, () -> makeRegistry(map(
                "$oojs", "1.0", "$id", "x",
                "types", map("Foo", map("properties", map("arr",
                        map("type", "array", "items", map("type", "string"), "uniqueItems", "yes")))))));
        assertTrue(e.getMessage().contains("uniqueItems"));
    }

    @Test void validator_validate_json_invalid_json() {
        Object[] ar = animalRegistry();
        Registry r = (Registry) ar[0];
        Schema schema = (Schema) ar[1];
        assertThrows(IllegalArgumentException.class, () -> new Validator(r).validateJson("{", "Dog", schema));
    }

    @Test void validator_validate_json_unknown_type() {
        Object[] ar = animalRegistry();
        Registry r = (Registry) ar[0];
        Schema schema = (Schema) ar[1];
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> new Validator(r).validateJson("{\"_type\":\"Dog\"}", "Missing", schema));
        assertTrue(e.getMessage().contains("not found"));
    }

    @Test void validator_type_ref_mismatch() {
        Registry r = new Registry();
        r.loadMap(map("$oojs", "1.0", "$id", "https://example.org/schemas/ref-mismatch",
                "types", map(
                        "Parent", map("properties", map("child", map("type", "Child")), "required", list("child")),
                        "Child", map("properties", map("name", map("type", "string")), "required", list("name")))));
        Schema schema = r.getSchema("https://example.org/schemas/ref-mismatch");
        List<ValidationError> errs = new Validator(r).validate(
                map("_type", "Parent", "child", "nope"), schema.types.get("Parent"), schema);
        assertTrue(hasCode(errs, ErrorCode.TYPE_MISMATCH));
    }

    @Test void validator_type_ref_unknown_type() {
        // Unresolvable TypeRef property references are now caught at load time
        // via eager resolution (§A.3), not deferred to validation time.
        SchemaError e = assertThrows(SchemaError.class, () -> {
            Registry r = new Registry();
            r.loadMap(map("$oojs", "1.0", "$id", "https://example.org/schemas/ref-unknown",
                    "types", map("Parent", map(
                            "properties", map("child", map("type", "MissingType")),
                            "required", list("child")))));
        });
        assertTrue(e.getMessage().contains("not found"));
    }

    @Test void validator_type_ref_via_imports() {
        Registry r = new Registry();
        r.loadMap(map("$oojs", "1.0", "$id", "https://example.org/schemas/other",
                "types", map("Pet", map(
                        "properties", map("name", map("type", "string")),
                        "required", list("name")))));
        r.loadMap(map("$oojs", "1.0", "$id", "https://example.org/schemas/owner",
                "imports", map("other", "https://example.org/schemas/other"),
                "types", map("Owner", map(
                        "properties", map("pet", map("type", "other.Pet")),
                        "required", list("pet")))));
        Schema schema = r.getSchema("https://example.org/schemas/owner");
        List<ValidationError> errs = new Validator(r).validate(
                map("_type", "Owner", "pet", map("_type", "Pet", "name", "Fido")),
                schema.types.get("Owner"), schema);
        assertEquals(List.of(), errs);
    }

    @Test void validator_reports_json_type_name() {
        Registry r = new Registry();
        r.loadMap(map("$oojs", "1.0", "$id", "https://example.org/schemas/type-name",
                "types", map("Person", map(
                        "properties", map("age", map("type", "integer")),
                        "required", list("age")))));
        Schema schema = r.getSchema("https://example.org/schemas/type-name");
        List<ValidationError> errs = new Validator(r).validate(
                map("_type", "Person", "age", list("oops")), schema.types.get("Person"), schema);
        assertTrue(hasCodeAndMessage(errs, ErrorCode.TYPE_MISMATCH, "got array"));
    }

    @Test void unique_items_canonicalizes_object_keys() {
        Registry r = new Registry();
        r.loadMap(map("$oojs", "1.0", "$id", "https://example.org/schemas/uniq-obj",
                "additionalProperties", true,
                "types", map(
                        "Obj", map(),
                        "Arr", map(
                                "properties", map("v", map("type", "array", "items", map("type", "Obj"), "uniqueItems", true)),
                                "required", list("v")))));
        Schema schema = r.getSchema("https://example.org/schemas/uniq-obj");
        List<ValidationError> errs = new Validator(r).validate(
                map("_type", "Arr", "v", list(
                        map("_type", "Obj", "a", 1, "b", 2),
                        map("_type", "Obj", "b", 2, "a", 1))),
                schema.types.get("Arr"), schema);
        assertTrue(hasCode(errs, ErrorCode.ARRAY_DUPLICATE_ITEMS));
    }
}
