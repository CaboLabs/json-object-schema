package org.oojs;

import org.junit.jupiter.api.Test;
import org.oojs.model.Schema;

import static org.junit.jupiter.api.Assertions.*;

class SubtypeCheckTest extends TestHelpers {

    @Test void direct_subtype() {
        Schema schema = (Schema) animalRegistry()[1];
        assertTrue(schema.types.get("Dog").isSubtypeOf(schema.types.get("Animal")));
    }

    @Test void same_type() {
        Schema schema = (Schema) animalRegistry()[1];
        assertTrue(schema.types.get("Dog").isSubtypeOf(schema.types.get("Dog")));
    }

    @Test void not_subtype() {
        Schema schema = (Schema) animalRegistry()[1];
        assertFalse(schema.types.get("Cat").isSubtypeOf(schema.types.get("Dog")));
    }

    @Test void transitive() {
        Registry r = new Registry();
        r.loadMap(map("$oojs", "1.0", "$id", "https://example.org/schemas/deep",
                "types", map(
                        "A", map("abstract", true),
                        "B", map("extends", "A"),
                        "C", map("extends", "B"),
                        "D", map("extends", "C"))));
        Schema schema = r.getSchema("https://example.org/schemas/deep");
        assertTrue(schema.types.get("D").isSubtypeOf(schema.types.get("A")));
    }
}
