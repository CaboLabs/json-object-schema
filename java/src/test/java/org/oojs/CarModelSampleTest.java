package org.oojs;

import org.junit.jupiter.api.Test;
import org.oojs.model.Schema;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class CarModelSampleTest extends TestHelpers {

    @Test
    void car_motor_wheels_sample_valid() {
        Map<String, Object> schemaMap = map(
                "$oojs", "1.0",
                "$id", "https://example.org/schemas/car",
                "types", map(
                        "Motor", map(
                                "properties", map(
                                        "horsepower", map("type", "number", "minimum", 1),
                                        "cylinders", map("type", "integer", "minimum", 1)),
                                "required", list("horsepower", "cylinders")),
                        "Wheel", map(
                                "properties", map(
                                        "size", map("type", "number", "minimum", 10),
                                        "material", map("type", "string", "enum", list("rubber"))),
                                "required", list("size", "material")),
                        "Car", map(
                                "properties", map(
                                        "make", map("type", "string"),
                                        "model", map("type", "string"),
                                        "motor", map("type", "Motor"),
                                        "wheels", map("type", "array", "items", map("type", "Wheel"), "minItems", 4, "maxItems", 4)),
                                "required", list("make", "model", "motor", "wheels"))));

        Map<String, Object> instance = map(
                "_type", "Car",
                "make", "Acme",
                "model", "Roadster",
                "motor", map("_type", "Motor", "horsepower", 220, "cylinders", 4),
                "wheels", list(
                        map("_type", "Wheel", "size", 18, "material", "rubber"),
                        map("_type", "Wheel", "size", 18, "material", "rubber"),
                        map("_type", "Wheel", "size", 18, "material", "rubber"),
                        map("_type", "Wheel", "size", 18, "material", "rubber")));

        Registry r = new Registry();
        Schema schema = r.loadMap(schemaMap);
        List<ValidationError> errs = new Validator(r).validate(instance, schema.types.get("Car"), schema);

        assertEquals(List.of(), errs);
    }
}
