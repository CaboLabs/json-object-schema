package org.oojs;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.oojs.model.Schema;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class AdditionalPropertiesTest extends TestHelpers {

    private Registry r;
    private Schema schema;

    @BeforeEach void setUp() {
        Object[] ar = animalRegistry();
        r = (Registry) ar[0];
        schema = (Schema) ar[1];
    }

    @Test void additional_property_rejected() {
        List<ValidationError> errs = new Validator(r).validate(
                map("_type", "Dog", "name", "Rex", "breed", "Lab", "color", "black"),
                schema.types.get("Dog"), schema);
        assertTrue(hasCode(errs, ErrorCode.ADDITIONAL_PROPERTY));
    }

    @Test void open_world_allows_extra() {
        Registry r2 = new Registry();
        r2.loadMap(map(
                "$oojs", "1.0", "$id", "https://example.org/schemas/open",
                "additionalProperties", true,
                "types", map("Foo", map("properties", map("x", map("type", "string"))))));
        Schema s = r2.getSchema("https://example.org/schemas/open");
        List<ValidationError> errs = new Validator(r2).validate(
                map("_type", "Foo", "x", "hello", "extra", 99), s.types.get("Foo"), s);
        assertEquals(List.of(), errs);
    }
}
