package org.oojs;

import org.junit.jupiter.api.Test;
import org.oojs.model.Schema;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class ArrayConstraintsTest extends TestHelpers {

    private List<ValidationError> errs(Object value, String itemType, Map<Object, Object> constraints) {
        Registry r = new Registry();
        Map<Object, Object> propDef = map("type", "array", "items", map("type", itemType));
        propDef.putAll(constraints);
        r.loadMap(map("$oojs", "1.0", "$id", "https://example.org/schemas/arr-test",
                "types", map("Arr", map("properties", map("v", propDef)))));
        Schema schema = r.getSchema("https://example.org/schemas/arr-test");
        return new Validator(r).validate(map("_type", "Arr", "v", value), schema.types.get("Arr"), schema);
    }

    private List<ValidationError> errs(Object value, Map<Object, Object> constraints) {
        return errs(value, "string", constraints);
    }

    @Test void not_array()        { assertTrue(hasCode(errs("notarray", map()), ErrorCode.TYPE_MISMATCH)); }
    @Test void min_items_ok()     { assertEquals(List.of(), errs(list("a", "b"), map("minItems", 2))); }
    @Test void min_items_fail()   { assertTrue(hasCode(errs(list("a"), map("minItems", 2)), ErrorCode.ARRAY_TOO_SHORT)); }
    @Test void max_items_ok()     { assertEquals(List.of(), errs(list("a"), map("maxItems", 2))); }
    @Test void max_items_fail()   { assertTrue(hasCode(errs(list("a", "b", "c"), map("maxItems", 2)), ErrorCode.ARRAY_TOO_LONG)); }
    @Test void unique_items_ok()  { assertEquals(List.of(), errs(list("a", "b"), map("uniqueItems", true))); }
    @Test void unique_items_fail(){ assertTrue(hasCode(errs(list("a", "a"), map("uniqueItems", true)), ErrorCode.ARRAY_DUPLICATE_ITEMS)); }

    @Test void item_constraint_propagated() {
        Registry r = new Registry();
        r.loadMap(map("$oojs", "1.0", "$id", "https://example.org/schemas/arr-item-constraint",
                "types", map("Arr", map("properties", map("v",
                        map("type", "array", "items", map("type", "string", "maxLength", 5)))))));
        Schema schema = r.getSchema("https://example.org/schemas/arr-item-constraint");
        List<ValidationError> errs = new Validator(r).validate(
                map("_type", "Arr", "v", list("toolong")), schema.types.get("Arr"), schema);
        assertTrue(hasCode(errs, ErrorCode.STRING_TOO_LONG));
    }
}
