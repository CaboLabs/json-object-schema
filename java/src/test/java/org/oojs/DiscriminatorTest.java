package org.oojs;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.oojs.model.Schema;
import org.oojs.model.TypeDef;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class DiscriminatorTest extends TestHelpers {

    private Registry r;
    private Schema schema;

    @BeforeEach void setUp() {
        Object[] ar = animalRegistry();
        r = (Registry) ar[0];
        schema = (Schema) ar[1];
    }

    private List<ValidationError> doValidate(Object instance, String typeName) {
        return new Validator(r).validate(instance, schema.types.get(typeName), schema);
    }

    private List<ValidationError> doValidate(Object instance) {
        return doValidate(instance, "Animal");
    }

    @Test void missing_discriminator() {
        assertTrue(hasCode(doValidate(map("name", "Rex", "breed", "Labrador")), ErrorCode.MISSING_DISCRIMINATOR));
    }

    @Test void invalid_discriminator_type() {
        assertTrue(hasCode(doValidate(map("_type", 42, "name", "Rex", "breed", "Labrador")), ErrorCode.INVALID_DISCRIMINATOR_TYPE));
    }

    @Test void unknown_type() {
        assertTrue(hasCode(doValidate(map("_type", "Fish", "name", "Nemo")), ErrorCode.UNKNOWN_TYPE));
    }

    @Test void abstract_type() {
        assertTrue(hasCode(doValidate(map("_type", "Animal", "name", "Generic")), ErrorCode.ABSTRACT_TYPE));
    }

    @Test void type_not_subtype_of_target() {
        assertTrue(hasCode(doValidate(map("_type", "Dog", "name", "Rex", "breed", "Labrador"), "Cat"), ErrorCode.TYPE_MISMATCH));
    }

    @Test void valid_concrete_subtype() {
        assertEquals(List.of(), doValidate(map("_type", "Dog", "name", "Rex", "breed", "Labrador")));
    }

    @Test void custom_discriminator_value() {
        Registry r2 = new Registry();
        r2.loadMap(map(
                "$oojs", "1.0", "$id", "https://example.org/schemas/dv-test",
                "types", map(
                        "Vehicle", map("abstract", true, "properties", map("speed", map("type", "number"))),
                        "Car", map("extends", "Vehicle", "discriminatorValue", "automobile"))));
        Schema s = r2.getSchema("https://example.org/schemas/dv-test");
        List<ValidationError> errs = new Validator(r2).validate(
                map("_type", "automobile", "speed", 100), s.types.get("Vehicle"), s);
        assertEquals(List.of(), errs);
    }
}
