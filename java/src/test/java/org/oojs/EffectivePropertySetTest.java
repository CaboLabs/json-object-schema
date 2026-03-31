package org.oojs;

import org.junit.jupiter.api.Test;
import org.oojs.model.Schema;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class EffectivePropertySetTest extends TestHelpers {

    @Test void inherits_parent_properties() {
        Schema schema = (Schema) animalRegistry()[1];
        var eff = schema.types.get("Dog").effectiveProperties();
        assertTrue(eff.containsKey("name"));
        assertTrue(eff.containsKey("age"));
        assertTrue(eff.containsKey("breed"));
    }

    @Test void effective_required_union() {
        Schema schema = (Schema) animalRegistry()[1];
        List<String> req = schema.types.get("Dog").effectiveRequired();
        assertTrue(req.contains("name"));
        assertTrue(req.contains("breed"));
    }
}
