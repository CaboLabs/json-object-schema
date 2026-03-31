package org.oojs;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.oojs.model.Schema;

import java.io.File;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RelationshipsTest extends TestHelpers {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private Map<String, Object> verticalSchema() {
        return map(
                "$oojs", "1.0",
                "$id", "https://example.org/schemas/vertical",
                "types", map(
                        "Motor", map(
                                "properties", map(
                                        "horsepower", map("type", "integer", "minimum", 1),
                                        "fuelType", map("type", "string", "enum", list("petrol", "electric"))),
                                "required", list("horsepower", "fuelType")),
                        "Wheel", map(
                                "properties", map("size", map("type", "number", "minimum", 10)),
                                "required", list("size")),
                        "Car", map(
                                "properties", map(
                                        "carId", map("type", "string"),
                                        "make", map("type", "string"),
                                        "motor", map("type", "Motor"),
                                        "wheels", map("type", "array", "items", map("type", "Wheel"), "minItems", 4, "maxItems", 4)),
                                "required", list("carId", "make", "motor", "wheels"))));
    }

    private Map<String, Object> horizontalSchema() {
        return map(
                "$oojs", "1.0",
                "$id", "https://example.org/schemas/horizontal",
                "types", map(
                        "Person", map(
                                "properties", map(
                                        "personId", map("type", "string"),
                                        "name", map("type", "string"),
                                        "carIds", map("type", "array", "items", map("type", "string"))),
                                "required", list("personId", "name")),
                        "Car", map(
                                "properties", map(
                                        "carId", map("type", "string"),
                                        "make", map("type", "string"),
                                        "ownerId", map("type", "string")),
                                "required", list("carId", "make", "ownerId")),
                        "Fleet", map(
                                "properties", map(
                                        "fleetId", map("type", "string"),
                                        "name", map("type", "string"),
                                        "carIds", map("type", "array", "items", map("type", "string")),
                                        "personIds", map("type", "array", "items", map("type", "string"))),
                                "required", list("fleetId", "name"))));
    }

    private Map<String, Object> unidirectionalSchema() {
        return map(
                "$oojs", "1.0",
                "$id", "https://example.org/schemas/unidirectional",
                "types", map(
                        "Customer", map(
                                "properties", map(
                                        "customerId", map("type", "string"),
                                        "name", map("type", "string")),
                                "required", list("customerId", "name")),
                        "Invoice", map(
                                "properties", map(
                                        "invoiceId", map("type", "string"),
                                        "amount", map("type", "number", "minimum", 0),
                                        "customerId", map("type", "string")),
                                "required", list("invoiceId", "amount", "customerId"))));
    }

    @Test
    void vertical_has_one_valid() {
        Registry r = new Registry();
        Schema schema = r.loadMap(verticalSchema());
        Map<String, Object> car = map(
                "_type", "Car",
                "carId", "car-1",
                "make", "Acme",
                "motor", map("_type", "Motor", "horsepower", 180, "fuelType", "petrol"),
                "wheels", list(
                        map("_type", "Wheel", "size", 18),
                        map("_type", "Wheel", "size", 18),
                        map("_type", "Wheel", "size", 18),
                        map("_type", "Wheel", "size", 18)));

        assertEquals(List.of(), new Validator(r).validate(car, schema.types.get("Car"), schema));
    }

    @Test
    void vertical_has_one_embedded_missing_required_field() {
        Registry r = new Registry();
        Schema schema = r.loadMap(verticalSchema());
        Map<String, Object> car = map(
                "_type", "Car",
                "carId", "car-1",
                "make", "Acme",
                "motor", map("_type", "Motor", "horsepower", 180),
                "wheels", list(
                        map("_type", "Wheel", "size", 18),
                        map("_type", "Wheel", "size", 18),
                        map("_type", "Wheel", "size", 18),
                        map("_type", "Wheel", "size", 18)));

        List<ValidationError> errs = new Validator(r).validate(car, schema.types.get("Car"), schema);
        assertFalse(errs.isEmpty());
        assertEquals(ErrorCode.MISSING_REQUIRED, errs.get(0).code);
    }

    @Test
    void vertical_has_many_wrong_count() {
        Registry r = new Registry();
        Schema schema = r.loadMap(verticalSchema());
        Map<String, Object> car = map(
                "_type", "Car",
                "carId", "car-1",
                "make", "Acme",
                "motor", map("_type", "Motor", "horsepower", 200, "fuelType", "petrol"),
                "wheels", list(
                        map("_type", "Wheel", "size", 18),
                        map("_type", "Wheel", "size", 18),
                        map("_type", "Wheel", "size", 18)));

        List<ValidationError> errs = new Validator(r).validate(car, schema.types.get("Car"), schema);
        assertFalse(errs.isEmpty());
        assertEquals(ErrorCode.ARRAY_TOO_SHORT, errs.get(0).code);
    }

    @Test
    void vertical_has_many_item_invalid() {
        Registry r = new Registry();
        Schema schema = r.loadMap(verticalSchema());
        Map<String, Object> car = map(
                "_type", "Car",
                "carId", "car-1",
                "make", "Acme",
                "motor", map("_type", "Motor", "horsepower", 200, "fuelType", "petrol"),
                "wheels", list(
                        map("_type", "Wheel", "size", 18),
                        map("_type", "Wheel", "size", 18),
                        map("_type", "Wheel", "size", 18),
                        map("_type", "Wheel", "size", 5)));

        List<ValidationError> errs = new Validator(r).validate(car, schema.types.get("Car"), schema);
        assertTrue(hasCode(errs, ErrorCode.BELOW_MINIMUM));
    }

    @Test
    void horizontal_has_one_valid() {
        Registry r = new Registry();
        Schema schema = r.loadMap(horizontalSchema());
        Map<String, Object> car = map(
                "_type", "Car",
                "carId", "car-1",
                "make", "Acme",
                "ownerId", "person-1");

        assertEquals(List.of(), new Validator(r).validate(car, schema.types.get("Car"), schema));
    }

    @Test
    void horizontal_has_one_wrong_type_for_id() {
        Registry r = new Registry();
        Schema schema = r.loadMap(horizontalSchema());
        Map<String, Object> car = map(
                "_type", "Car",
                "carId", "car-1",
                "make", "Acme",
                "ownerId", 12345);

        List<ValidationError> errs = new Validator(r).validate(car, schema.types.get("Car"), schema);
        assertTrue(hasCode(errs, ErrorCode.TYPE_MISMATCH));
    }

    @Test
    void horizontal_has_many_valid() {
        Registry r = new Registry();
        Schema schema = r.loadMap(horizontalSchema());
        Map<String, Object> fleet = map(
                "_type", "Fleet",
                "fleetId", "fleet-1",
                "name", "City Fleet",
                "carIds", list("car-1", "car-2", "car-3"),
                "personIds", list("person-1"));

        assertEquals(List.of(), new Validator(r).validate(fleet, schema.types.get("Fleet"), schema));
    }

    @Test
    void horizontal_has_many_item_wrong_type() {
        Registry r = new Registry();
        Schema schema = r.loadMap(horizontalSchema());
        Map<String, Object> fleet = map(
                "_type", "Fleet",
                "fleetId", "fleet-1",
                "name", "Bad Fleet",
                "carIds", list("car-1", 42));

        List<ValidationError> errs = new Validator(r).validate(fleet, schema.types.get("Fleet"), schema);
        assertTrue(hasCode(errs, ErrorCode.TYPE_MISMATCH));
    }

    @Test
    void unidirectional_source_valid() {
        Registry r = new Registry();
        Schema schema = r.loadMap(unidirectionalSchema());
        Map<String, Object> invoice = map(
                "_type", "Invoice",
                "invoiceId", "inv-001",
                "amount", 450.0,
                "customerId", "cust-1");

        assertEquals(List.of(), new Validator(r).validate(invoice, schema.types.get("Invoice"), schema));
    }

    @Test
    void unidirectional_target_valid_with_no_back_reference() {
        Registry r = new Registry();
        Schema schema = r.loadMap(unidirectionalSchema());
        Map<String, Object> customer = map(
                "_type", "Customer",
                "customerId", "cust-1",
                "name", "Acme Corp");

        assertEquals(List.of(), new Validator(r).validate(customer, schema.types.get("Customer"), schema));
    }

    @Test
    void bidirectional_inconsistent_state_passes_individual_validation() {
        Registry r = new Registry();
        Schema schema = r.loadMap(horizontalSchema());

        Map<String, Object> person = map(
                "_type", "Person",
                "personId", "person-1",
                "name", "Alice",
                "carIds", list("car-X"));
        Map<String, Object> car = map(
                "_type", "Car",
                "carId", "car-X",
                "make", "Acme",
                "ownerId", "person-99");

        assertEquals(List.of(), new Validator(r).validate(person, schema.types.get("Person"), schema));
        assertEquals(List.of(), new Validator(r).validate(car, schema.types.get("Car"), schema));
    }

    @Test
    @SuppressWarnings("unchecked")
    void directionality_example_valid_instances() throws Exception {
        String examples = Paths.get(System.getProperty("user.dir")).getParent().resolve("examples").toString();
        Registry r = new Registry();
        Schema schema = r.loadFile(examples + "/directionality.oojs.json");
        Map<String, Object> data = MAPPER.readValue(new File(examples + "/directionality-instances.json"), Map.class);
        List<Map<String, Object>> valid = (List<Map<String, Object>>) data.get("valid");

        for (Map<String, Object> inst : valid) {
            Map<String, Object> clean = new LinkedHashMap<>(inst);
            clean.remove("_comment");
            String dv = (String) clean.get("_type");
            if (dv == null || !schema.types.containsKey(dv)) {
                continue;
            }
            List<ValidationError> errs = new Validator(r).validate(clean, schema.types.get(dv), schema);
            assertEquals(List.of(), errs);
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void directionality_example_structurally_invalid_instances() throws Exception {
        String examples = Paths.get(System.getProperty("user.dir")).getParent().resolve("examples").toString();
        Registry r = new Registry();
        Schema schema = r.loadFile(examples + "/directionality.oojs.json");
        Map<String, Object> data = MAPPER.readValue(new File(examples + "/directionality-instances.json"), Map.class);
        List<Map<String, Object>> invalid = (List<Map<String, Object>>) data.get("invalid");

        List<Map<String, Object>> structurallyInvalid = new ArrayList<>(invalid.subList(0, Math.min(3, invalid.size())));
        for (Map<String, Object> inst : structurallyInvalid) {
            Map<String, Object> clean = new LinkedHashMap<>(inst);
            clean.remove("_comment");
            String dv = (String) clean.get("_type");
            if (dv == null || !schema.types.containsKey(dv)) {
                continue;
            }
            List<ValidationError> errs = new Validator(r).validate(clean, schema.types.get(dv), schema);
            assertFalse(errs.isEmpty());
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void fleet_example_valid_instances() throws Exception {
        String examples = Paths.get(System.getProperty("user.dir")).getParent().resolve("examples").toString();
        Registry r = new Registry();
        Schema schema = r.loadFile(examples + "/fleet.oojs.json");
        Map<String, Object> data = MAPPER.readValue(new File(examples + "/fleet-instances.json"), Map.class);
        List<Map<String, Object>> valid = (List<Map<String, Object>>) data.get("valid");

        for (Map<String, Object> inst : valid) {
            Map<String, Object> clean = new LinkedHashMap<>(inst);
            clean.remove("_comment");
            String dv = (String) clean.get("_type");
            if (dv == null || !schema.types.containsKey(dv)) {
                continue;
            }
            List<ValidationError> errs = new Validator(r).validate(clean, schema.types.get(dv), schema);
            assertEquals(List.of(), errs);
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void fleet_example_invalid_instances() throws Exception {
        String examples = Paths.get(System.getProperty("user.dir")).getParent().resolve("examples").toString();
        Registry r = new Registry();
        Schema schema = r.loadFile(examples + "/fleet.oojs.json");
        Map<String, Object> data = MAPPER.readValue(new File(examples + "/fleet-instances.json"), Map.class);
        List<Map<String, Object>> invalid = (List<Map<String, Object>>) data.get("invalid");

        for (Map<String, Object> inst : invalid) {
            Map<String, Object> clean = new LinkedHashMap<>(inst);
            clean.remove("_comment");
            String dv = (String) clean.get("_type");
            if (dv == null || !schema.types.containsKey(dv)) {
                continue;
            }
            List<ValidationError> errs = new Validator(r).validate(clean, schema.types.get(dv), schema);
            assertFalse(errs.isEmpty());
        }
    }
}
