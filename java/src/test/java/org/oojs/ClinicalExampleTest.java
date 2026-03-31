package org.oojs;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.oojs.model.Schema;
import org.oojs.model.TypeDef;

import java.io.File;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class ClinicalExampleTest extends TestHelpers {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private Registry r;
    private Schema schema;
    private List<Map<String, Object>> validInstances;
    private List<Map<String, Object>> invalidInstances;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() throws Exception {
        String examples = Paths.get(System.getProperty("user.dir"))
                .getParent().resolve("examples").toString();
        r = new Registry();
        schema = r.loadFile(examples + "/clinical.oojs.json");

        Map<String, Object> data = MAPPER.readValue(
                new File(examples + "/clinical-instances.json"), Map.class);
        validInstances = (List<Map<String, Object>>) data.get("valid");
        invalidInstances = (List<Map<String, Object>>) data.get("invalid");
    }

    @Test void valid_instances_pass() {
        for (Map<String, Object> inst : validInstances) {
            Map<String, Object> clean = new java.util.LinkedHashMap<>(inst);
            clean.remove("_comment");
            String dv = (String) clean.get("_type");
            if (dv == null || !schema.types.containsKey(dv)) continue;
            TypeDef typedef = schema.types.get(dv);
            List<ValidationError> errs = new Validator(r).validate(clean, typedef, schema);
            assertTrue(errs.isEmpty(), "Expected valid but got errors for " + dv + ": " + errs);
        }
    }

    @Test void invalid_instances_fail() {
        for (Map<String, Object> inst : invalidInstances) {
            String dv = (String) inst.get("_type");
            TypeDef target;
            if (dv == null) {
                target = schema.types.values().iterator().next();
            } else {
                target = schema.types.getOrDefault(dv, schema.types.values().iterator().next());
            }
            List<ValidationError> errs = new Validator(r).validate(inst, target, schema);
            String comment = (String) inst.getOrDefault("_comment", "");
            assertFalse(errs.isEmpty(), "Expected errors for invalid instance (" + comment + ")");
        }
    }
}
