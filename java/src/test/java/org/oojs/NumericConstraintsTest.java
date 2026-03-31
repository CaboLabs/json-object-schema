package org.oojs;

import org.junit.jupiter.api.Test;
import org.oojs.model.Schema;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class NumericConstraintsTest extends TestHelpers {

    private List<ValidationError> errs(Object value, String kind, Map<Object, Object> constraints) {
        Registry r = new Registry();
        Map<Object, Object> propDef = map("type", kind);
        propDef.putAll(constraints);
        r.loadMap(map("$oojs", "1.0", "$id", "https://example.org/schemas/num-test",
                "types", map("Num", map("properties", map("v", propDef)))));
        Schema schema = r.getSchema("https://example.org/schemas/num-test");
        return new Validator(r).validate(map("_type", "Num", "v", value), schema.types.get("Num"), schema);
    }

    private List<ValidationError> errs(Object value, Map<Object, Object> constraints) {
        return errs(value, "number", constraints);
    }

    @Test void minimum_ok()              { assertEquals(List.of(), errs(5, map("minimum", 0))); }
    @Test void minimum_fail()            { assertTrue(hasCode(errs(-1, map("minimum", 0)), ErrorCode.BELOW_MINIMUM)); }
    @Test void maximum_ok()              { assertEquals(List.of(), errs(10, map("maximum", 10))); }
    @Test void maximum_fail()            { assertTrue(hasCode(errs(11, map("maximum", 10)), ErrorCode.ABOVE_MAXIMUM)); }
    @Test void exclusive_minimum_ok()    { assertEquals(List.of(), errs(1, map("exclusiveMinimum", 0))); }
    @Test void exclusive_minimum_fail()  { assertTrue(hasCode(errs(0, map("exclusiveMinimum", 0)), ErrorCode.BELOW_EXCLUSIVE_MINIMUM)); }
    @Test void exclusive_maximum_ok()    { assertEquals(List.of(), errs(9, map("exclusiveMaximum", 10))); }
    @Test void exclusive_maximum_fail()  { assertTrue(hasCode(errs(10, map("exclusiveMaximum", 10)), ErrorCode.ABOVE_EXCLUSIVE_MAXIMUM)); }
    @Test void multiple_of_ok()          { assertEquals(List.of(), errs(6, map("multipleOf", 3))); }
    @Test void multiple_of_fail()        { assertTrue(hasCode(errs(7, map("multipleOf", 3)), ErrorCode.NOT_MULTIPLE_OF)); }
    @Test void integer_ok()              { assertEquals(List.of(), errs(3, "integer", map())); }
    @Test void integer_float_fraction()  { assertTrue(hasCode(errs(3.5, "integer", map()), ErrorCode.NOT_INTEGER)); }
    @Test void integer_float_no_fraction(){ assertEquals(List.of(), errs(3.0, "integer", map())); }
    @Test void enum_number_ok()          { assertEquals(List.of(), errs(2, map("enum", list(1, 2, 3)))); }
    @Test void enum_number_fail()        { assertTrue(hasCode(errs(5, map("enum", list(1, 2, 3))), ErrorCode.ENUM_MISMATCH)); }
}
