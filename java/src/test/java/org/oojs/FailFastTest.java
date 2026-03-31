package org.oojs;

import org.junit.jupiter.api.Test;
import org.oojs.model.Schema;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class FailFastTest extends TestHelpers {

    @Test void fail_fast_returns_single_error() {
        Object[] ar = animalRegistry();
        Registry r = (Registry) ar[0];
        Schema schema = (Schema) ar[1];
        List<ValidationError> errs = new Validator(r, true).validate(
                map("_type", "Dog"), schema.types.get("Animal"), schema);
        assertEquals(1, errs.size());
    }

    @Test void full_mode_returns_all_errors() {
        Object[] ar = animalRegistry();
        Registry r = (Registry) ar[0];
        Schema schema = (Schema) ar[1];
        List<ValidationError> errs = new Validator(r, false).validate(
                map("_type", "Dog"), schema.types.get("Animal"), schema);
        assertTrue(errs.size() >= 2);
    }
}
