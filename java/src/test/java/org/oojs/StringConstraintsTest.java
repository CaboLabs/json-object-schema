package org.oojs;

import org.junit.jupiter.api.Test;
import org.oojs.model.Schema;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class StringConstraintsTest extends TestHelpers {

    private List<ValidationError> errs(Object value, Map<Object, Object> constraints) {
        Registry r = new Registry();
        Map<Object, Object> propDef = map("type", "string");
        propDef.putAll(constraints);
        r.loadMap(map("$oojs", "1.0", "$id", "https://example.org/schemas/str-test",
                "types", map("Str", map("properties", map("v", propDef)))));
        Schema schema = r.getSchema("https://example.org/schemas/str-test");
        return new Validator(r).validate(map("_type", "Str", "v", value), schema.types.get("Str"), schema);
    }

    @Test void min_length_ok()   { assertEquals(List.of(), errs("hi", map("minLength", 2))); }
    @Test void min_length_fail() { assertTrue(hasCode(errs("x", map("minLength", 2)), ErrorCode.STRING_TOO_SHORT)); }
    @Test void max_length_ok()   { assertEquals(List.of(), errs("hi", map("maxLength", 5))); }
    @Test void max_length_fail() { assertTrue(hasCode(errs("toolong", map("maxLength", 5)), ErrorCode.STRING_TOO_LONG)); }
    @Test void pattern_match()   { assertEquals(List.of(), errs("abc123", map("pattern", "^[a-z]+[0-9]+$"))); }
    @Test void pattern_no_match(){ assertTrue(hasCode(errs("123abc", map("pattern", "^[a-z]+[0-9]+$")), ErrorCode.PATTERN_MISMATCH)); }
    @Test void enum_match()      { assertEquals(List.of(), errs("yes", map("enum", list("yes", "no")))); }
    @Test void enum_mismatch()   { assertTrue(hasCode(errs("maybe", map("enum", list("yes", "no"))), ErrorCode.ENUM_MISMATCH)); }
    @Test void type_mismatch()   { assertTrue(hasCode(errs(42, map()), ErrorCode.TYPE_MISMATCH)); }
}
