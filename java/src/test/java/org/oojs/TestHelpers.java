package org.oojs;

import org.oojs.model.Schema;

import java.util.*;

public class TestHelpers {

    protected static Map<String, Object> minimalSchema() {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("$oojs", "1.0");
        schema.put("$id", "https://example.org/schemas/test");

        Map<String, Object> animalProps = new LinkedHashMap<>();
        animalProps.put("name", map("type", "string"));
        animalProps.put("age", map("type", "integer", "minimum", 0));

        Map<String, Object> animal = new LinkedHashMap<>();
        animal.put("abstract", true);
        animal.put("properties", animalProps);
        animal.put("required", list("name"));

        Map<String, Object> dogProps = new LinkedHashMap<>();
        dogProps.put("breed", map("type", "string"));

        Map<String, Object> dog = new LinkedHashMap<>();
        dog.put("extends", "Animal");
        dog.put("properties", dogProps);
        dog.put("required", list("breed"));

        Map<String, Object> catProps = new LinkedHashMap<>();
        catProps.put("indoor", map("type", "boolean"));

        Map<String, Object> cat = new LinkedHashMap<>();
        cat.put("extends", "Animal");
        cat.put("properties", catProps);

        Map<String, Object> types = new LinkedHashMap<>();
        types.put("Animal", animal);
        types.put("Dog", dog);
        types.put("Cat", cat);
        schema.put("types", types);
        return schema;
    }

    protected static Registry makeRegistry(Map<String, Object>... schemas) {
        Registry r = new Registry();
        for (Map<String, Object> s : schemas) r.loadMap(s);
        return r;
    }

    protected static Object[] animalRegistry() {
        Registry r = makeRegistry(minimalSchema());
        Schema schema = r.getSchema("https://example.org/schemas/test");
        return new Object[]{r, schema};
    }

    protected boolean hasCode(List<ValidationError> errs, String code) {
        for (ValidationError e : errs) if (e.code.equals(code)) return true;
        return false;
    }

    protected boolean hasCodeAndMessage(List<ValidationError> errs, String code, String fragment) {
        for (ValidationError e : errs) if (e.code.equals(code) && e.message.contains(fragment)) return true;
        return false;
    }

    // Convenience builders
    @SuppressWarnings("unchecked")
    protected static <K, V> Map<K, V> map(Object... kvPairs) {
        Map<Object, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kvPairs.length; i += 2) m.put(kvPairs[i], kvPairs[i + 1]);
        return (Map<K, V>) m;
    }

    protected static List<Object> list(Object... items) {
        return new ArrayList<>(Arrays.asList(items));
    }
}
