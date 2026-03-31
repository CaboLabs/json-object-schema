package org.oojs;

import org.junit.jupiter.api.Test;
import org.oojs.model.Schema;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class CarRelationshipsSampleTest extends TestHelpers {

    @Test
    void car_relationships_sample_valid() {
        Map<String, Object> schemaMap = map(
                "$oojs", "1.0",
                "$id", "https://example.org/schemas/car-rel",
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
                                        "model", map("type", "string"),
                                        "ownerId", map("type", "string"),
                                        "garageId", map("type", "string")),
                                "required", list("carId", "make", "model", "ownerId")),
                        "Garage", map(
                                "properties", map(
                                        "garageId", map("type", "string"),
                                        "name", map("type", "string"),
                                        "carIds", map("type", "array", "items", map("type", "string"))),
                                "required", list("garageId", "name")),
                        "Fleet", map(
                                "properties", map(
                                        "fleetId", map("type", "string"),
                                        "name", map("type", "string"),
                                        "carIds", map("type", "array", "items", map("type", "string")),
                                        "personIds", map("type", "array", "items", map("type", "string"))),
                                "required", list("fleetId", "name"))));

        Map<String, Object> instance = map(
                "_type", "Fleet",
                "fleetId", "fleet-1",
                "name", "City Fleet",
                "carIds", list("car-1", "car-2"),
                "personIds", list("person-1"));

        Registry r = new Registry();
        Schema schema = r.loadMap(schemaMap);
        List<ValidationError> errs = new Validator(r).validate(instance, schema.types.get("Fleet"), schema);

        assertEquals(List.of(), errs);
    }
}
