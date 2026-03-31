package org.oojs;

import org.junit.jupiter.api.Test;
import org.oojs.model.Schema;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class SchemaLoadingTest extends TestHelpers {

    @Test void minimal_valid_schema() {
        Object[] ar = animalRegistry();
        Schema schema = (Schema) ar[1];
        assertNotNull(schema);
        assertTrue(schema.types.containsKey("Animal"));
        assertTrue(schema.types.containsKey("Dog"));
    }

    @Test void missing_oojs() {
        SchemaError e = assertThrows(SchemaError.class, () ->
                makeRegistry(map("$id", "x", "types", map("A", map()))));
        assertTrue(e.getMessage().contains("$oojs"));
    }

    @Test void wrong_version() {
        SchemaError e = assertThrows(SchemaError.class, () ->
                makeRegistry(map("$oojs", "2.0", "$id", "x", "types", map("A", map()))));
        assertTrue(e.getMessage().contains("unsupported"));
    }

    @Test void missing_id() {
        SchemaError e = assertThrows(SchemaError.class, () ->
                makeRegistry(map("$oojs", "1.0", "types", map("A", map()))));
        assertTrue(e.getMessage().contains("$id"));
    }

    @Test void missing_types() {
        SchemaError e = assertThrows(SchemaError.class, () ->
                makeRegistry(map("$oojs", "1.0", "$id", "x")));
        assertTrue(e.getMessage().contains("types"));
    }

    @Test void empty_types() {
        SchemaError e = assertThrows(SchemaError.class, () ->
                makeRegistry(map("$oojs", "1.0", "$id", "x", "types", map())));
        assertTrue(e.getMessage().contains("types"));
    }

    @Test void invalid_type_name_lowercase() {
        SchemaError e = assertThrows(SchemaError.class, () ->
                makeRegistry(map("$oojs", "1.0", "$id", "x", "types", map("dog", map()))));
        assertTrue(e.getMessage().contains("naming rules"));
    }

    @Test void reserved_type_name() {
        SchemaError e = assertThrows(SchemaError.class, () ->
                makeRegistry(map("$oojs", "1.0", "$id", "x", "types", map("string", map()))));
        assertTrue(e.getMessage().contains("reserved"));
    }

    @Test void discriminator_collides_with_property() {
        SchemaError e = assertThrows(SchemaError.class, () -> makeRegistry(map(
                "$oojs", "1.0", "$id", "x", "discriminator", "kind",
                "types", map("Foo", map("properties", map("kind", map("type", "string")))))));
        assertTrue(e.getMessage().contains("collides"));
    }

    @Test void inheritance_resolved() {
        Object[] ar = animalRegistry();
        Schema schema = (Schema) ar[1];
        assertSame(schema.types.get("Animal"), schema.types.get("Dog").supertype);
    }

    @Test void cycle_detection() {
        SchemaError e = assertThrows(SchemaError.class, () -> makeRegistry(map(
                "$oojs", "1.0", "$id", "x",
                "types", map("A", map("extends", "B"), "B", map("extends", "A")))));
        assertTrue(e.getMessage().contains("cycle"));
    }

    @Test void property_redeclaration_forbidden() {
        SchemaError e = assertThrows(SchemaError.class, () -> makeRegistry(map(
                "$oojs", "1.0", "$id", "x",
                "types", map(
                        "Base", map("properties", map("name", map("type", "string"))),
                        "Child", map("extends", "Base", "properties", map("name", map("type", "string")))))));
        assertTrue(e.getMessage().contains("redeclares"));
    }

    @Test void required_references_own_property() {
        SchemaError e = assertThrows(SchemaError.class, () -> makeRegistry(map(
                "$oojs", "1.0", "$id", "x",
                "types", map(
                        "Base", map("properties", map("name", map("type", "string")), "required", list("name")),
                        "Child", map("extends", "Base", "required", list("name"))))));
        assertTrue(e.getMessage().contains("not declared in own"));
    }

    @Test void duplicate_discriminator_value() {
        SchemaError e = assertThrows(SchemaError.class, () -> makeRegistry(map(
                "$oojs", "1.0", "$id", "x",
                "types", map(
                        "A", map("discriminatorValue", "shared"),
                        "B", map("discriminatorValue", "shared")))));
        assertTrue(e.getMessage().contains("discriminator value"));
    }

    @Test void idempotent_reload() {
        Registry r = new Registry();
        Schema s1 = r.loadMap(minimalSchema());
        Schema s2 = r.loadMap(minimalSchema());
        assertSame(s1, s2);
    }

    @Test void invalid_property_name() {
        SchemaError e = assertThrows(SchemaError.class, () -> makeRegistry(map(
                "$oojs", "1.0", "$id", "x",
                "types", map("Foo", map("properties", map("BadName", map("type", "string")))))));
        assertTrue(e.getMessage().contains("naming rules"));
    }

    @Test void mutually_exclusive_minimum() {
        SchemaError e = assertThrows(SchemaError.class, () -> makeRegistry(map(
                "$oojs", "1.0", "$id", "x",
                "types", map("Foo", map("properties", map(
                        "n", map("type", "integer", "minimum", 0, "exclusiveMinimum", 0)))))));
        assertTrue(e.getMessage().contains("mutually exclusive"));
    }

    @Test void nested_array_forbidden() {
        SchemaError e = assertThrows(SchemaError.class, () -> makeRegistry(map(
                "$oojs", "1.0", "$id", "x",
                "types", map("Foo", map("properties", map(
                        "matrix", map("type", "array", "items",
                                map("type", "array", "items", map("type", "integer")))))))));
        assertTrue(e.getMessage().contains("nested arrays"));
    }
}
