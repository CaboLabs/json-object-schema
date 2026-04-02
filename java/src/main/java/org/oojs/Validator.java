package org.oojs;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.oojs.model.*;

import java.util.*;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/** Stateful OOJS instance validator. */
public class Validator {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final Registry registry;
    private final boolean failFast;
    private Map<String, Map<String, Object>> graphIndex = null;

    public Validator(Registry registry) {
        this(registry, false);
    }

    public Validator(Registry registry, boolean failFast) {
        this.registry = registry;
        this.failFast = failFast;
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    public List<ValidationError> validate(Object instance, TypeDef targetType, Schema schema) {
        List<ValidationError> errors = new ArrayList<>();
        validateInstance(instance, targetType, schema, "/", errors);
        return errors;
    }

    public List<ValidationError> validateJson(String text, String targetTypeName, Schema schema) {
        Object instance;
        try {
            instance = MAPPER.readValue(text, Object.class);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Invalid JSON: " + e.getMessage());
        }
        TypeDef typedef = schema.types.get(targetTypeName);
        if (typedef == null) {
            throw new IllegalArgumentException("Type '" + targetTypeName + "' not found in schema '" + schema.schemaId + "'");
        }
        return validate(instance, typedef, schema);
    }

    @SuppressWarnings("unchecked")
    public List<ValidationError> validateGraphDocument(Map<String, Object> graphDoc, Schema schema) {
        List<ValidationError> errors = new ArrayList<>();
        String discName = schema.discriminator;

        // Build $id -> raw-object index from roots and objects.
        Map<String, Map<String, Object>> index = new LinkedHashMap<>();
        Object rawRoots = graphDoc.get("roots");
        if (rawRoots instanceof List) {
            List<?> roots = (List<?>) rawRoots;
            for (Object rootObj : roots) {
                if (!(rootObj instanceof Map)) {
                    continue;
                }
                Map<String, Object> root = (Map<String, Object>) rootObj;
                Object idObj = root.get("$id");
                if (idObj instanceof String) {
                    index.put((String) idObj, root);
                }
            }
        }
        Object rawObjects = graphDoc.get("objects");
        if (rawObjects instanceof Map) {
            Map<?, ?> objects = (Map<?, ?>) rawObjects;
            for (Map.Entry<?, ?> entry : objects.entrySet()) {
                if (!(entry.getValue() instanceof Map)) {
                    continue;
                }
                index.put(String.valueOf(entry.getKey()), (Map<String, Object>) entry.getValue());
            }
        }
        graphIndex = index;

        Map<String, Map<String, Object>> positions = new LinkedHashMap<>();
        if (rawRoots instanceof List) {
            List<?> roots = (List<?>) rawRoots;
            for (int i = 0; i < roots.size(); i++) {
                if (roots.get(i) instanceof Map) {
                    positions.put("roots/" + i, (Map<String, Object>) roots.get(i));
                }
            }
        }
        if (rawObjects instanceof Map) {
            Map<?, ?> objects = (Map<?, ?>) rawObjects;
            for (Map.Entry<?, ?> entry : objects.entrySet()) {
                if (entry.getValue() instanceof Map) {
                    positions.put("objects/" + escape(String.valueOf(entry.getKey())),
                            (Map<String, Object>) entry.getValue());
                }
            }
        }

        for (Map.Entry<String, Map<String, Object>> pos : positions.entrySet()) {
            String path = pos.getKey();
            Map<String, Object> raw = pos.getValue();

            // Convert graph-object shape to regular instance shape.
            Map<String, Object> instance = new LinkedHashMap<>();
            for (Map.Entry<String, Object> entry : raw.entrySet()) {
                String key = entry.getKey();
                if ("$id".equals(key)) {
                    continue;
                }
                if ("$type".equals(key)) {
                    instance.put(discName, entry.getValue());
                    continue;
                }
                instance.put(key, entry.getValue());
            }

            Object discVal = instance.get(discName);
            if (!(discVal instanceof String)) {
                errors.add(new ValidationError(path, ErrorCode.MISSING_DISCRIMINATOR,
                        "graph object missing $type field"));
                continue;
            }
            TypeDef typedef = registry.lookupByDiscriminatorValue((String) discVal);
            if (typedef == null) {
                errors.add(new ValidationError(path + "/$type", ErrorCode.UNKNOWN_TYPE,
                        "unknown type '" + discVal + "'"));
                continue;
            }

            validateInstance(instance, typedef, schema, path, errors);
        }

        graphIndex = null;
        return errors;
    }

    // ------------------------------------------------------------------
    // Core validation phases (§9.2)
    // ------------------------------------------------------------------

    private boolean validateInstance(Object instance, TypeDef target, Schema schema,
            String path, List<ValidationError> errors) {
        if (!(instance instanceof Map)) {
            errors.add(new ValidationError(path, ErrorCode.TYPE_MISMATCH, "expected a JSON object"));
            return !failFast;
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> obj = (Map<String, Object>) instance;

        // Phase 1: discriminator resolution
        String discName = schema.discriminator;
        if (!obj.containsKey(discName)) {
            errors.add(new ValidationError(path, ErrorCode.MISSING_DISCRIMINATOR,
                    "missing discriminator property '" + discName + "'"));
            return !failFast;
        }
        Object discVal = obj.get(discName);
        if (!(discVal instanceof String)) {
            errors.add(new ValidationError(path + "/" + discName, ErrorCode.INVALID_DISCRIMINATOR_TYPE,
                    "discriminator property '" + discName + "' must be a string"));
            return !failFast;
        }
        String discStr = (String) discVal;
        TypeDef concrete = registry.lookupByDiscriminatorValue(discStr);
        if (concrete == null) {
            errors.add(new ValidationError(path + "/" + discName, ErrorCode.UNKNOWN_TYPE,
                    "unknown type '" + discStr + "'"));
            return !failFast;
        }
        if (concrete.abstractType) {
            errors.add(new ValidationError(path + "/" + discName, ErrorCode.ABSTRACT_TYPE,
                    "type '" + discStr + "' is abstract and cannot be instantiated"));
            return !failFast;
        }
        if (!concrete.isSubtypeOf(target)) {
            errors.add(new ValidationError(path + "/" + discName, ErrorCode.TYPE_MISMATCH,
                    "type '" + discStr + "' is not a subtype of '" + target.name + "'"));
            return !failFast;
        }

        // Phase 2: required properties
        for (String reqName : concrete.effectiveRequired()) {
            if (!obj.containsKey(reqName)) {
                errors.add(new ValidationError(path, ErrorCode.MISSING_REQUIRED,
                        "missing required property '" + reqName + "'"));
                if (failFast) return false;
            }
        }

        // Phase 3: property presence + validation
        Map<String, PropertyDef> effectiveProps = concrete.effectiveProperties();
        for (Map.Entry<String, Object> entry : obj.entrySet()) {
            String key = entry.getKey();
            if (key.equals(discName)) continue;
            if (!effectiveProps.containsKey(key)) {
                if (schema.closedWorld) {
                    errors.add(new ValidationError(path + "/" + escape(key), ErrorCode.ADDITIONAL_PROPERTY,
                            "unexpected additional property '" + key + "'"));
                    if (failFast) return false;
                }
                continue;
            }
            boolean ok = validateProperty(entry.getValue(), effectiveProps.get(key), schema,
                    path + "/" + escape(key), errors);
            if (!ok && failFast) return false;
        }

        return true;
    }

    private boolean validateProperty(Object value, PropertyDef prop, Schema schema,
            String path, List<ValidationError> errors) {
        if (prop instanceof ArrayProperty) return validateArray(value, (ArrayProperty) prop, schema, path, errors);
        if (prop instanceof PrimitiveProperty) return validatePrimitive(value, (PrimitiveProperty) prop, path, errors);
        if (prop instanceof TypeRefProperty) return validateTypeRef(value, (TypeRefProperty) prop, schema, path, errors);
        return true;
    }

    // -- Array (§9.2 Phase 4, array branch) ------------------------------

    private boolean validateArray(Object value, ArrayProperty prop, Schema schema,
            String path, List<ValidationError> errors) {
        if (!(value instanceof List)) {
            errors.add(new ValidationError(path, ErrorCode.TYPE_MISMATCH, "expected an array"));
            return !failFast;
        }
        List<?> list = (List<?>) value;
        int count = list.size();

        if (count < prop.minItems) {
            errors.add(new ValidationError(path, ErrorCode.ARRAY_TOO_SHORT,
                    "array has " + count + " item(s), minimum is " + prop.minItems));
            if (failFast) return false;
        }
        if (prop.maxItems != null && count > prop.maxItems) {
            errors.add(new ValidationError(path, ErrorCode.ARRAY_TOO_LONG,
                    "array has " + count + " item(s), maximum is " + prop.maxItems));
            if (failFast) return false;
        }
        if (prop.uniqueItems) {
            Set<String> seen = new LinkedHashSet<>();
            for (Object item : list) {
                String key = serialiseForUniqueness(item);
                if (!seen.add(key)) {
                    errors.add(new ValidationError(path, ErrorCode.ARRAY_DUPLICATE_ITEMS, "array items must be unique"));
                    if (failFast) return false;
                    break;
                }
            }
        }
        for (int i = 0; i < list.size(); i++) {
            boolean ok = validateProperty(list.get(i), prop.items, schema, path + "/" + i, errors);
            if (!ok && failFast) return false;
        }
        return true;
    }

    // -- Primitive (§9.3) ------------------------------------------------

    private boolean validatePrimitive(Object value, PrimitiveProperty prop,
            String path, List<ValidationError> errors) {
        if (!jsonKindMatches(value, prop.kind)) {
            errors.add(new ValidationError(path, ErrorCode.TYPE_MISMATCH,
                    "expected " + prop.kind + ", got " + jsonTypeName(value)));
            return !failFast;
        }

        if ("integer".equals(prop.kind) && value instanceof Double) {
            double d = (Double) value;
            if (d != Math.floor(d) || Double.isInfinite(d)) {
                errors.add(new ValidationError(path, ErrorCode.NOT_INTEGER, "value must be an integer (no fractional part)"));
                if (failFast) return false;
            }
        }

        if ("string".equals(prop.kind)) {
            String s = (String) value;
            int length = s.codePointCount(0, s.length());
            if (prop.minLength != null && length < prop.minLength) {
                errors.add(new ValidationError(path, ErrorCode.STRING_TOO_SHORT,
                        "string length " + length + " < minLength " + prop.minLength));
                if (failFast) return false;
            }
            if (prop.maxLength != null && length > prop.maxLength) {
                errors.add(new ValidationError(path, ErrorCode.STRING_TOO_LONG,
                        "string length " + length + " > maxLength " + prop.maxLength));
                if (failFast) return false;
            }
            if (prop.pattern != null) {
                try {
                    if (!Pattern.compile(prop.pattern).matcher(s).find()) {
                        errors.add(new ValidationError(path, ErrorCode.PATTERN_MISMATCH,
                                "value does not match pattern '" + prop.pattern + "'"));
                        if (failFast) return false;
                    }
                } catch (PatternSyntaxException e) {
                    errors.add(new ValidationError(path, ErrorCode.PATTERN_MISMATCH,
                            "invalid pattern '" + prop.pattern + "': " + e.getMessage()));
                    if (failFast) return false;
                }
            }
            if (prop.enumValues != null && !prop.enumValues.contains(value)) {
                errors.add(new ValidationError(path, ErrorCode.ENUM_MISMATCH,
                        "value '" + value + "' not in enum " + prop.enumValues));
                if (failFast) return false;
            }
        } else if ("integer".equals(prop.kind) || "number".equals(prop.kind)) {
            double num = ((Number) value).doubleValue();
            if (prop.minimum != null && num < prop.minimum) {
                errors.add(new ValidationError(path, ErrorCode.BELOW_MINIMUM,
                        "value " + value + " < minimum " + prop.minimum));
                if (failFast) return false;
            }
            if (prop.maximum != null && num > prop.maximum) {
                errors.add(new ValidationError(path, ErrorCode.ABOVE_MAXIMUM,
                        "value " + value + " > maximum " + prop.maximum));
                if (failFast) return false;
            }
            if (prop.exclusiveMinimum != null && num <= prop.exclusiveMinimum) {
                errors.add(new ValidationError(path, ErrorCode.BELOW_EXCLUSIVE_MINIMUM,
                        "value " + value + " must be > " + prop.exclusiveMinimum));
                if (failFast) return false;
            }
            if (prop.exclusiveMaximum != null && num >= prop.exclusiveMaximum) {
                errors.add(new ValidationError(path, ErrorCode.ABOVE_EXCLUSIVE_MAXIMUM,
                        "value " + value + " must be < " + prop.exclusiveMaximum));
                if (failFast) return false;
            }
            if (prop.multipleOf != null) {
                double remainder = Math.abs(num) % prop.multipleOf;
                double rounded = Math.round(remainder * 1e10) / 1e10;
                if (rounded != 0.0 && rounded != prop.multipleOf) {
                    errors.add(new ValidationError(path, ErrorCode.NOT_MULTIPLE_OF,
                            "value " + value + " is not a multiple of " + prop.multipleOf));
                    if (failFast) return false;
                }
            }
            if (prop.enumValues != null) {
                boolean found = false;
                for (Object ev : prop.enumValues) {
                    if (ev instanceof Number && ((Number) ev).doubleValue() == num) { found = true; break; }
                }
                if (!found) {
                    errors.add(new ValidationError(path, ErrorCode.ENUM_MISMATCH,
                            "value " + value + " not in enum " + prop.enumValues));
                    if (failFast) return false;
                }
            }
        }
        return true;
    }

    // -- Type reference (§9.2 Phase 4, type-ref branch) ------------------

    private boolean validateTypeRef(Object value, TypeRefProperty prop, Schema schema,
            String path, List<ValidationError> errors) {
        // Graph-document mode: { "$ref-id": "..." } references another top-level
        // graph object. We type-check the referenced object's $type and avoid
        // recursive inline validation so cycles terminate naturally.
        if (graphIndex != null && value instanceof Map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> maybeRef = (Map<String, Object>) value;
            if (maybeRef.size() == 1 && maybeRef.containsKey("$ref-id")) {
                Object refIdObj = maybeRef.get("$ref-id");
                if (!(refIdObj instanceof String)) {
                    errors.add(new ValidationError(path, ErrorCode.TYPE_MISMATCH, "$ref-id must be a string"));
                    return !failFast;
                }
                String refId = (String) refIdObj;
                Map<String, Object> target = graphIndex.get(refId);
                if (target == null) {
                    errors.add(new ValidationError(path, ErrorCode.UNRESOLVED_REFERENCE,
                            "unresolved $ref-id '" + refId + "'"));
                    return !failFast;
                }
                Object targetTypeNameObj = target.get("$type");
                if (!(targetTypeNameObj instanceof String)) {
                    errors.add(new ValidationError(path, ErrorCode.MISSING_DISCRIMINATOR,
                            "referenced object missing $type"));
                    return !failFast;
                }
                String targetTypeName = (String) targetTypeNameObj;
                TypeDef targetTypedef = registry.lookupByDiscriminatorValue(targetTypeName);
                TypeDef refTypedef = prop.resolvedType;
                if (targetTypedef == null || refTypedef == null) {
                    errors.add(new ValidationError(path, ErrorCode.UNKNOWN_TYPE,
                            "cannot resolve type '" + prop.typeName + "'"));
                    return !failFast;
                }
                if (!targetTypedef.isSubtypeOf(refTypedef)) {
                    errors.add(new ValidationError(path, ErrorCode.TYPE_MISMATCH,
                            "type '" + targetTypeName + "' is not a subtype of '" + prop.typeName + "'"));
                    return !failFast;
                }
                return true;
            }
        }

        if (!(value instanceof Map)) {
            errors.add(new ValidationError(path, ErrorCode.TYPE_MISMATCH, "expected a JSON object for type reference"));
            return !failFast;
        }

        // resolvedType is guaranteed non-null by eager registry resolution (§A.3).
        // A null here indicates a schema that bypassed the registry load path.
        TypeDef refTypedef = prop.resolvedType;
        if (refTypedef == null) {
            errors.add(new ValidationError(path, ErrorCode.UNKNOWN_TYPE,
                    "type reference '" + prop.typeName + "' was not resolved at load time"));
            return !failFast;
        }

        Schema refSchema = registry.getSchema(refTypedef.schemaId);
        if (refSchema == null) refSchema = schema;
        return validateInstance(value, refTypedef, refSchema, path, errors);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static boolean jsonKindMatches(Object value, String kind) {
        switch (kind) {
            case "null":    return value == null;
            case "boolean": return value instanceof Boolean;
            case "string":  return value instanceof String;
            case "integer": return value instanceof Integer || value instanceof Long || value instanceof Double;
            case "number":  return value instanceof Integer || value instanceof Long || value instanceof Double;
            default:        return false;
        }
    }

    private static String jsonTypeName(Object value) {
        if (value == null)             return "null";
        if (value instanceof Boolean)  return "boolean";
        if (value instanceof String)   return "string";
        if (value instanceof Integer || value instanceof Long) return "integer";
        if (value instanceof Double || value instanceof Float) return "number";
        if (value instanceof List)     return "array";
        if (value instanceof Map)      return "object";
        return value.getClass().getSimpleName();
    }

    private static String escape(String token) {
        return token.replace("~", "~0").replace("/", "~1");
    }

    private static String serialiseForUniqueness(Object value) {
        try {
            return MAPPER.writeValueAsString(sortKeysRecursive(value));
        } catch (JsonProcessingException e) {
            return String.valueOf(value);
        }
    }

    @SuppressWarnings("unchecked")
    private static Object sortKeysRecursive(Object value) {
        if (value instanceof Map) {
            Map<String, Object> sorted = new TreeMap<>();
            for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
                sorted.put(String.valueOf(entry.getKey()), sortKeysRecursive(entry.getValue()));
            }
            return sorted;
        }
        if (value instanceof List) {
            List<Object> result = new ArrayList<>();
            for (Object item : (List<?>) value) result.add(sortKeysRecursive(item));
            return result;
        }
        return value;
    }
}
