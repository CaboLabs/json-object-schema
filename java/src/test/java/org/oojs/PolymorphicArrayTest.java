package org.oojs;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.oojs.model.Schema;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class PolymorphicArrayTest extends TestHelpers {

    private Registry r;
    private Schema schema;

    @BeforeEach void setUp() {
        r = new Registry();
        r.loadMap(map("$oojs", "1.0", "$id", "https://example.org/schemas/poly",
                "types", map(
                        "Shape", map("abstract", true, "properties", map("color", map("type", "string"))),
                        "Circle", map("extends", "Shape",
                                "properties", map("radius", map("type", "number")),
                                "required", list("radius")),
                        "Rect", map("extends", "Shape",
                                "properties", map("width", map("type", "number"), "height", map("type", "number")),
                                "required", list("width", "height")),
                        "Canvas", map("properties", map("shapes",
                                map("type", "array", "items", map("type", "Shape")))))));
        schema = r.getSchema("https://example.org/schemas/poly");
    }

    @Test void polymorphic_array_valid() {
        Object instance = map("_type", "Canvas", "shapes", list(
                map("_type", "Circle", "radius", 5.0),
                map("_type", "Rect", "width", 10.0, "height", 4.0)));
        assertEquals(List.of(), new Validator(r).validate(instance, schema.types.get("Canvas"), schema));
    }

    @Test void polymorphic_array_abstract_item() {
        Object instance = map("_type", "Canvas", "shapes", list(map("_type", "Shape", "color", "red")));
        assertTrue(hasCode(new Validator(r).validate(instance, schema.types.get("Canvas"), schema), ErrorCode.ABSTRACT_TYPE));
    }

    @Test void polymorphic_array_missing_required() {
        Object instance = map("_type", "Canvas", "shapes", list(map("_type", "Circle")));
        assertTrue(hasCode(new Validator(r).validate(instance, schema.types.get("Canvas"), schema), ErrorCode.MISSING_REQUIRED));
    }
}
