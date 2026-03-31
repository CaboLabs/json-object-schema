package org.oojs;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.oojs.model.Schema;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class RequiredTest extends TestHelpers {

    private Registry r;
    private Schema schema;

    @BeforeEach void setUp() {
        Object[] ar = animalRegistry();
        r = (Registry) ar[0];
        schema = (Schema) ar[1];
    }

    private List<ValidationError> doValidate(Object instance) {
        return new Validator(r).validate(instance, schema.types.get("Animal"), schema);
    }

    @Test void missing_own_required() {
        assertTrue(hasCodeAndMessage(doValidate(map("_type", "Dog", "name", "Rex")), ErrorCode.MISSING_REQUIRED, "breed"));
    }

    @Test void missing_inherited_required() {
        assertTrue(hasCodeAndMessage(doValidate(map("_type", "Dog", "breed", "Labrador")), ErrorCode.MISSING_REQUIRED, "name"));
    }

    @Test void all_required_present() {
        assertEquals(List.of(), doValidate(map("_type", "Dog", "name", "Rex", "breed", "Labrador")));
    }

    @Test void optional_property_absent_is_ok() {
        assertEquals(List.of(), doValidate(map("_type", "Cat", "name", "Whiskers")));
    }
}
