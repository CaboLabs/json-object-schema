package org.oojs;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.oojs.model.*;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.*;
import java.util.regex.Pattern;

/**
 * Holds loaded schemas and indexes types by discriminator value.
 */
public class Registry {

    private static final Pattern TYPE_NAME_RE = Pattern.compile("^[A-Z][A-Za-z0-9_]*$");
    private static final Pattern PROP_NAME_RE = Pattern.compile("^[a-z_][A-Za-z0-9_]*$");
    private static final Set<String> PRIMITIVE_TYPES = new HashSet<>(
            Arrays.asList("string", "integer", "number", "boolean", "null"));
    private static final Set<String> RESERVED_TYPE_NAMES = new HashSet<>(
            Arrays.asList("string", "integer", "number", "boolean", "null", "array"));

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final Map<String, org.oojs.model.Schema> schemas = new LinkedHashMap<>();
    private final Map<String, TypeDef> byDv = new LinkedHashMap<>();

    // ------------------------------------------------------------------
    // Loading
    // ------------------------------------------------------------------

    public org.oojs.model.Schema loadFile(String path) {
        String text;
        try {
            text = new String(Files.readAllBytes(Paths.get(path)));
        } catch (IOException e) {
            throw new SchemaError("Cannot read file: " + path);
        }
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> data = MAPPER.readValue(text, Map.class);
            return load(data, path);
        } catch (JsonProcessingException e) {
            throw new SchemaError(path + ": invalid JSON: " + e.getMessage());
        }
    }

    public org.oojs.model.Schema loadJson(String text) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> data = MAPPER.readValue(text, Map.class);
            return load(data, "<string>");
        } catch (JsonProcessingException e) {
            throw new SchemaError("<string>: invalid JSON: " + e.getMessage());
        }
    }

    public org.oojs.model.Schema loadMap(Map<String, Object> data) {
        return load(data, "<dict>");
    }

    @SuppressWarnings("unchecked")
    private org.oojs.model.Schema load(Map<String, Object> data, String source) {
        // $oojs version
        if (!data.containsKey("$oojs")) {
            throw new SchemaError(source + ": missing required field '$oojs'");
        }
        Object oojs = data.get("$oojs");
        if (!"1.0".equals(oojs)) {
            throw new SchemaError(source + ": unsupported $oojs version '" + oojs + "'");
        }

        // $id
        if (!data.containsKey("$id")) {
            throw new SchemaError(source + ": missing required field '$id'");
        }
        Object idObj = data.get("$id");
        if (!(idObj instanceof String) || ((String) idObj).isEmpty()) {
            throw new SchemaError(source + ": '$id' must be a non-empty string");
        }
        String schemaId = (String) idObj;

        // Idempotent reload
        if (schemas.containsKey(schemaId)) {
            return schemas.get(schemaId);
        }

        // discriminator
        Object discObj = data.getOrDefault("discriminator", "_type");
        if (!(discObj instanceof String) || ((String) discObj).isEmpty()) {
            throw new SchemaError(source + ": 'discriminator' must be a non-empty string");
        }
        String discriminator = (String) discObj;

        // imports
        Map<String, String> rawImports = new LinkedHashMap<>();
        if (data.containsKey("imports")) {
            Object imp = data.get("imports");
            if (!(imp instanceof Map)) {
                throw new SchemaError(source + ": 'imports' must be an object");
            }
            for (Map.Entry<?, ?> entry : ((Map<?, ?>) imp).entrySet()) {
                String alias = String.valueOf(entry.getKey());
                if (!PROP_NAME_RE.matcher(alias).matches()) {
                    throw new SchemaError(source + ": import alias '" + alias + "' violates naming rules");
                }
                if (!(entry.getValue() instanceof String)) {
                    throw new SchemaError(source + ": import value for alias '" + alias + "' must be a string");
                }
                rawImports.put(alias, (String) entry.getValue());
            }
        }

        // types
        if (!data.containsKey("types")) {
            throw new SchemaError(source + ": missing required field 'types'");
        }
        Object rawTypesObj = data.get("types");
        if (!(rawTypesObj instanceof Map) || ((Map<?, ?>) rawTypesObj).isEmpty()) {
            throw new SchemaError(source + ": 'types' must be a non-empty object");
        }
        Map<String, Object> rawTypes = (Map<String, Object>) rawTypesObj;

        boolean closedWorld = !Boolean.TRUE.equals(data.get("additionalProperties"));
        org.oojs.model.Schema schema = new org.oojs.model.Schema(
                "1.0", schemaId,
                data.getOrDefault("title", "").toString(),
                data.getOrDefault("description", "").toString(),
                discriminator, closedWorld);
        schema.imports = rawImports;

        // Register early to handle circular imports
        schemas.put(schemaId, schema);

        // Pass 1: parse type definitions
        for (Map.Entry<String, Object> entry : rawTypes.entrySet()) {
            String typeName = entry.getKey();
            if (RESERVED_TYPE_NAMES.contains(typeName)) {
                throw new SchemaError(source + ": '" + typeName + "' is a reserved name");
            }
            if (!TYPE_NAME_RE.matcher(typeName).matches()) {
                throw new SchemaError(source + ": type name '" + typeName + "' violates naming rules");
            }
            if (!(entry.getValue() instanceof Map)) {
                throw new SchemaError(source + ": type '" + typeName + "' definition must be a JSON object");
            }
            schema.types.put(typeName, parseType(typeName, (Map<String, Object>) entry.getValue(), schema, source));
        }

        // Check discriminator collision
        for (Map.Entry<String, TypeDef> entry : schema.types.entrySet()) {
            if (entry.getValue().ownProperties.containsKey(discriminator)) {
                throw new SchemaError(source + ": type '" + entry.getKey() + "' declares property '"
                        + discriminator + "' which collides with the schema discriminator");
            }
        }

        // Pass 2: resolve hierarchy
        resolveHierarchy(schema, source);

        // Pass 3: eagerly resolve TypeRef property type names to TypeDef objects.
        // Broken references are caught at load time, not deferred to validation (§A.3).
        resolvePropertyTypeRefs(schema, source);

        // Check required entries reference own properties only
        for (Map.Entry<String, TypeDef> entry : schema.types.entrySet()) {
            String typeName = entry.getKey();
            TypeDef typedef = entry.getValue();
            for (String req : typedef.ownRequired) {
                if (!typedef.ownProperties.containsKey(req)) {
                    throw new SchemaError(source + ": type '" + typeName + "' lists '" + req
                            + "' in 'required' but it is not declared in own 'properties'");
                }
            }
        }

        // Check for property redeclaration
        for (Map.Entry<String, TypeDef> entry : schema.types.entrySet()) {
            String typeName = entry.getKey();
            TypeDef typedef = entry.getValue();
            if (typedef.supertype != null) {
                Set<String> inherited = typedef.supertype.effectiveProperties().keySet();
                List<String> overlap = new ArrayList<>();
                for (String own : typedef.ownProperties.keySet()) {
                    if (inherited.contains(own)) overlap.add(own);
                }
                if (!overlap.isEmpty()) {
                    Collections.sort(overlap);
                    throw new SchemaError(source + ": type '" + typeName + "' redeclares inherited properties: "
                            + overlap);
                }
            }
        }

        // Index by discriminator value
        for (Map.Entry<String, TypeDef> entry : schema.types.entrySet()) {
            TypeDef typedef = entry.getValue();
            String dv = typedef.getEffectiveDiscriminatorValue();
            if (byDv.containsKey(dv)) {
                TypeDef existing = byDv.get(dv);
                if (existing != typedef) {
                    throw new SchemaError(source + ": discriminator value '" + dv
                            + "' is already used by type '" + existing.name
                            + "' in schema '" + existing.schemaId + "'");
                }
            }
            byDv.put(dv, typedef);
        }

        return schema;
    }

    // ------------------------------------------------------------------
    // Type parsing
    // ------------------------------------------------------------------

    @SuppressWarnings("unchecked")
    private TypeDef parseType(String name, Map<String, Object> data, org.oojs.model.Schema schema, String source) {
        Object extendsObj = data.get("extends");
        if (extendsObj != null && !(extendsObj instanceof String)) {
            throw new SchemaError(source + ": type '" + name + "' 'extends' must be a string");
        }
        String extendsName = (String) extendsObj;

        Object abstractObj = data.getOrDefault("abstract", Boolean.FALSE);
        if (!(abstractObj instanceof Boolean)) {
            throw new SchemaError(source + ": type '" + name + "' 'abstract' must be a boolean");
        }
        boolean abstractType = (Boolean) abstractObj;

        Object dvObj = data.get("discriminatorValue");
        if (dvObj != null && !(dvObj instanceof String)) {
            throw new SchemaError(source + ": type '" + name + "' 'discriminatorValue' must be a string");
        }
        String dv = (String) dvObj;

        // properties
        Map<String, PropertyDef> ownProps = new LinkedHashMap<>();
        Object propsObj = data.getOrDefault("properties", Collections.emptyMap());
        if (!(propsObj instanceof Map)) {
            throw new SchemaError(source + ": type '" + name + "' 'properties' must be an object");
        }
        for (Map.Entry<?, ?> entry : ((Map<?, ?>) propsObj).entrySet()) {
            String propName = String.valueOf(entry.getKey());
            if (!PROP_NAME_RE.matcher(propName).matches()) {
                throw new SchemaError(source + ": property '" + propName + "' in type '" + name + "' violates naming rules");
            }
            if (!(entry.getValue() instanceof Map)) {
                throw new SchemaError(source + ": property '" + propName + "' in type '" + name + "' must be a JSON object");
            }
            ownProps.put(propName, parseProperty(propName, (Map<String, Object>) entry.getValue(), name, source));
        }

        // required
        List<String> ownRequired = new ArrayList<>();
        Object reqObj = data.getOrDefault("required", Collections.emptyList());
        if (!(reqObj instanceof List)) {
            throw new SchemaError(source + ": type '" + name + "' 'required' must be an array");
        }
        for (Object req : (List<?>) reqObj) {
            if (!(req instanceof String)) {
                throw new SchemaError(source + ": type '" + name + "' 'required' entries must be strings");
            }
            String reqStr = (String) req;
            if (ownRequired.contains(reqStr)) {
                throw new SchemaError(source + ": type '" + name + "' 'required' lists '" + reqStr + "' more than once");
            }
            ownRequired.add(reqStr);
        }

        TypeDef typedef = new TypeDef(name, schema.schemaId, abstractType, extendsName, dv,
                data.getOrDefault("title", "").toString(),
                data.getOrDefault("description", "").toString());
        typedef.ownProperties = ownProps;
        typedef.ownRequired = ownRequired;
        return typedef;
    }

    @SuppressWarnings("unchecked")
    private PropertyDef parseProperty(String propName, Map<String, Object> data, String typeName, String source) {
        if (!data.containsKey("type")) {
            throw new SchemaError(source + ": property '" + propName + "' in type '" + typeName + "' missing 'type'");
        }
        Object kindObj = data.get("type");
        if (!(kindObj instanceof String)) {
            throw new SchemaError(source + ": property '" + propName + "' in type '" + typeName + "' 'type' must be a string");
        }
        String kind = (String) kindObj;

        if ("array".equals(kind)) return parseArrayProperty(propName, data, typeName, source);
        if (PRIMITIVE_TYPES.contains(kind)) return parsePrimitiveProperty(propName, data, typeName, source);
        return new TypeRefProperty(kind,
                data.getOrDefault("title", "").toString(),
                data.getOrDefault("description", "").toString());
    }

    private PrimitiveProperty parsePrimitiveProperty(String propName, Map<String, Object> data,
            String typeName, String source) {
        String kind = (String) data.get("type");

        Integer minLength = null, maxLength = null;
        String pattern = null, format = null;
        Double minimum = null, maximum = null, exclusiveMinimum = null, exclusiveMaximum = null, multipleOf = null;
        List<Object> enumValues = null;

        if ("string".equals(kind)) {
            minLength = readNonNegInt(data, "minLength", propName, typeName, source);
            maxLength = readNonNegInt(data, "maxLength", propName, typeName, source);
            if (minLength != null && maxLength != null && minLength > maxLength) {
                throw new SchemaError(source + ": 'minLength' > 'maxLength' on '" + propName + "' in '" + typeName + "'");
            }
            Object patObj = data.get("pattern");
            if (patObj != null) {
                if (!(patObj instanceof String)) throw new SchemaError(source + ": 'pattern' on '" + propName + "' must be a string");
                pattern = (String) patObj;
            }
            Object fmtObj = data.get("format");
            if (fmtObj instanceof String) format = (String) fmtObj;
            enumValues = readEnum(data, propName, source);
        } else if ("integer".equals(kind) || "number".equals(kind)) {
            minimum = readNumber(data, "minimum", propName, typeName, source);
            maximum = readNumber(data, "maximum", propName, typeName, source);
            exclusiveMinimum = readNumber(data, "exclusiveMinimum", propName, typeName, source);
            exclusiveMaximum = readNumber(data, "exclusiveMaximum", propName, typeName, source);
            if (minimum != null && exclusiveMinimum != null) {
                throw new SchemaError(source + ": 'minimum' and 'exclusiveMinimum' are mutually exclusive on '"
                        + propName + "' in '" + typeName + "'");
            }
            if (maximum != null && exclusiveMaximum != null) {
                throw new SchemaError(source + ": 'maximum' and 'exclusiveMaximum' are mutually exclusive on '"
                        + propName + "' in '" + typeName + "'");
            }
            Object moObj = data.get("multipleOf");
            if (moObj != null) {
                if (moObj instanceof Boolean || !(moObj instanceof Number) || ((Number) moObj).doubleValue() <= 0) {
                    throw new SchemaError(source + ": 'multipleOf' on '" + propName + "' must be > 0");
                }
                multipleOf = ((Number) moObj).doubleValue();
            }
            enumValues = readEnum(data, propName, source);
        }

        return new PrimitiveProperty(kind,
                data.getOrDefault("title", "").toString(),
                data.getOrDefault("description", "").toString(),
                minLength, maxLength, pattern, format,
                minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, enumValues);
    }

    private ArrayProperty parseArrayProperty(String propName, Map<String, Object> data,
            String typeName, String source) {
        if (!data.containsKey("items")) {
            throw new SchemaError(source + ": array property '" + propName + "' in '" + typeName + "' missing 'items'");
        }
        Object itemsObj = data.get("items");
        if (!(itemsObj instanceof Map)) {
            throw new SchemaError(source + ": array property '" + propName + "' in '" + typeName + "' 'items' must be an object");
        }
        @SuppressWarnings("unchecked")
        PropertyDef items = parseProperty(propName + ".items", (Map<String, Object>) itemsObj, typeName, source);
        if (items instanceof ArrayProperty) {
            throw new SchemaError(source + ": nested arrays are not supported in v1.0 (property '" + propName + "' in '" + typeName + "')");
        }

        Integer minItems = readNonNegInt(data, "minItems", propName, typeName, source);
        int minItemsVal = minItems != null ? minItems : 0;
        Integer maxItems = readNonNegInt(data, "maxItems", propName, typeName, source);
        if (maxItems != null && minItemsVal > maxItems) {
            throw new SchemaError(source + ": 'minItems' > 'maxItems' on '" + propName + "' in '" + typeName + "'");
        }

        Object uniqueObj = data.getOrDefault("uniqueItems", Boolean.FALSE);
        if (!(uniqueObj instanceof Boolean)) {
            throw new SchemaError(source + ": 'uniqueItems' on '" + propName + "' must be a boolean");
        }

        return new ArrayProperty(items, minItemsVal, maxItems, (Boolean) uniqueObj,
                data.getOrDefault("title", "").toString(),
                data.getOrDefault("description", "").toString());
    }

    // ------------------------------------------------------------------
    // Hierarchy resolution
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // Property type-reference resolution (pass 3)
    // ------------------------------------------------------------------

    private void resolvePropertyTypeRefs(org.oojs.model.Schema schema, String source) {
        for (Map.Entry<String, TypeDef> typeEntry : schema.types.entrySet()) {
            String typeName = typeEntry.getKey();
            for (Map.Entry<String, PropertyDef> propEntry : typeEntry.getValue().ownProperties.entrySet()) {
                resolvePropertyTypeRef(propEntry.getValue(), schema, source,
                        "type '" + typeName + "', property '" + propEntry.getKey() + "'");
            }
        }
    }

    private void resolvePropertyTypeRef(PropertyDef prop, org.oojs.model.Schema schema,
            String source, String context) {
        if (prop instanceof TypeRefProperty) {
            TypeRefProperty trp = (TypeRefProperty) prop;
            trp.resolvedType = resolveTypeRef(trp.typeName, schema, source, context);
        } else if (prop instanceof ArrayProperty) {
            resolvePropertyTypeRef(((ArrayProperty) prop).items, schema, source, context + ".items");
        }
        // PrimitiveProperty has no type references to resolve
    }

    private void resolveHierarchy(org.oojs.model.Schema schema, String source) {
        for (Map.Entry<String, TypeDef> entry : schema.types.entrySet()) {
            TypeDef typedef = entry.getValue();
            if (typedef.extendsName != null) {
                typedef.supertype = resolveTypeRef(typedef.extendsName, schema, source, "type '" + entry.getKey() + "'");
            }
        }

        // Cycle detection
        for (Map.Entry<String, TypeDef> entry : schema.types.entrySet()) {
            String typeName = entry.getKey();
            Set<String> visited = new LinkedHashSet<>();
            TypeDef current = entry.getValue();
            while (current != null) {
                String key = current.schemaId + "#" + current.name;
                if (visited.contains(key)) {
                    throw new SchemaError(source + ": inheritance cycle detected involving type '" + typeName + "'");
                }
                visited.add(key);
                current = current.supertype;
            }
        }
    }

    private TypeDef resolveTypeRef(String ref, org.oojs.model.Schema schema, String source, String context) {
        if (ref.contains(".")) {
            String[] parts = ref.split("\\.", 2);
            String alias = parts[0], name = parts[1];
            String importedId = schema.imports.get(alias);
            if (importedId == null) {
                throw new SchemaError(source + ": " + context + ": unknown import alias '" + alias + "'");
            }
            org.oojs.model.Schema importedSchema = schemas.get(importedId);
            if (importedSchema == null) {
                throw new SchemaError(source + ": " + context + ": imported schema '" + importedId
                        + "' (alias '" + alias + "') is not loaded");
            }
            TypeDef typedef = importedSchema.types.get(name);
            if (typedef == null) {
                throw new SchemaError(source + ": " + context + ": type '" + name
                        + "' not found in schema '" + importedId + "'");
            }
            return typedef;
        }

        TypeDef typedef = schema.types.get(ref);
        if (typedef == null) {
            throw new SchemaError(source + ": " + context + ": type '" + ref
                    + "' not found in schema '" + schema.schemaId + "'");
        }
        return typedef;
    }

    // ------------------------------------------------------------------
    // Public lookup API
    // ------------------------------------------------------------------

    public org.oojs.model.Schema getSchema(String schemaId) {
        return schemas.get(schemaId);
    }

    public TypeDef lookupByDiscriminatorValue(String dv) {
        return byDv.get(dv);
    }

    public TypeDef resolveType(String name, org.oojs.model.Schema schema) {
        try {
            return resolveTypeRef(name, schema, "<lookup>", "");
        } catch (SchemaError e) {
            return null;
        }
    }

    public TypeDef resolveTypeIn(String name, String schemaId) {
        org.oojs.model.Schema schema = schemas.get(schemaId);
        if (schema == null) return null;
        try {
            return resolveTypeRef(name, schema, "<lookup>", "");
        } catch (SchemaError e) {
            return null;
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private Integer readNonNegInt(Map<String, Object> data, String key, String propName, String typeName, String source) {
        Object v = data.get(key);
        if (v == null) return null;
        if (!(v instanceof Integer) || (Integer) v < 0) {
            throw new SchemaError(source + ": '" + key + "' on property '" + propName
                    + "' in '" + typeName + "' must be a non-negative integer");
        }
        return (Integer) v;
    }

    private Double readNumber(Map<String, Object> data, String key, String propName, String typeName, String source) {
        Object v = data.get(key);
        if (v == null) return null;
        if (v instanceof Boolean || !(v instanceof Number)) {
            throw new SchemaError(source + ": '" + key + "' on property '" + propName
                    + "' in '" + typeName + "' must be a number");
        }
        return ((Number) v).doubleValue();
    }

    @SuppressWarnings("unchecked")
    private List<Object> readEnum(Map<String, Object> data, String propName, String source) {
        Object rawEnum = data.get("enum");
        if (rawEnum == null) return null;
        if (!(rawEnum instanceof List) || ((List<?>) rawEnum).isEmpty()) {
            throw new SchemaError(source + ": 'enum' on '" + propName + "' must be a non-empty array");
        }
        return new ArrayList<>((List<Object>) rawEnum);
    }
}
