using System.Text.Json;
using System.Text.RegularExpressions;

namespace Oojs;

public sealed class Validator
{
    private readonly Registry _registry;
    private readonly bool _failFast;

    public Validator(Registry registry, bool failFast = false)
    {
        _registry = registry;
        _failFast = failFast;
    }

    public List<ValidationError> Validate(object? instance, TypeDef targetType, Schema schema)
    {
        var errors = new List<ValidationError>();
        var normalized = JsonUtil.Normalize(instance);
        ValidateInstance(normalized, targetType, schema, "/", errors);
        return errors;
    }

    public List<ValidationError> ValidateJson(string text, string targetTypeName, Schema schema)
    {
        using var doc = JsonDocument.Parse(text);
        var instance = JsonUtil.FromJson(doc.RootElement);
        if (!schema.Types.TryGetValue(targetTypeName, out var typedef))
        {
            throw new ArgumentException(
                $"Type '{targetTypeName}' not found in schema '{schema.SchemaId}'"
            );
        }
        return Validate(instance, typedef, schema);
    }

    private bool ValidateInstance(object? instance, TypeDef target, Schema schema, string path, List<ValidationError> errors)
    {
        if (instance is not Dictionary<string, object?> obj)
        {
            errors.Add(new ValidationError(path, ErrorCode.TYPE_MISMATCH, "expected a JSON object"));
            return !_failFast;
        }

        var discName = schema.Discriminator;
        if (!obj.TryGetValue(discName, out var discValObj))
        {
            errors.Add(new ValidationError(path, ErrorCode.MISSING_DISCRIMINATOR,
                $"missing discriminator property '{discName}'"));
            return !_failFast;
        }

        if (discValObj is not string discVal)
        {
            errors.Add(new ValidationError($"{path}/{discName}", ErrorCode.INVALID_DISCRIMINATOR_TYPE,
                $"discriminator property '{discName}' must be a string"));
            return !_failFast;
        }

        var concrete = _registry.LookupByDiscriminatorValue(discVal);
        if (concrete is null)
        {
            errors.Add(new ValidationError($"{path}/{discName}", ErrorCode.UNKNOWN_TYPE,
                $"unknown type '{discVal}'"));
            return !_failFast;
        }

        if (concrete.Abstract)
        {
            errors.Add(new ValidationError($"{path}/{discName}", ErrorCode.ABSTRACT_TYPE,
                $"type '{discVal}' is abstract and cannot be instantiated"));
            return !_failFast;
        }

        if (!concrete.IsSubtypeOf(target))
        {
            errors.Add(new ValidationError($"{path}/{discName}", ErrorCode.TYPE_MISMATCH,
                $"type '{discVal}' is not a subtype of '{target.Name}'"));
            return !_failFast;
        }

        foreach (var req in concrete.EffectiveRequired())
        {
            if (!obj.ContainsKey(req))
            {
                errors.Add(new ValidationError(path, ErrorCode.MISSING_REQUIRED,
                    $"missing required property '{req}'"));
                if (_failFast)
                {
                    return false;
                }
            }
        }

        var effectiveProps = concrete.EffectiveProperties();
        foreach (var kvp in obj)
        {
            if (kvp.Key == discName)
            {
                continue;
            }
            if (!effectiveProps.TryGetValue(kvp.Key, out var propDef))
            {
                if (schema.ClosedWorld)
                {
                    errors.Add(new ValidationError($"{path}/{Escape(kvp.Key)}", ErrorCode.ADDITIONAL_PROPERTY,
                        $"unexpected additional property '{kvp.Key}'"));
                    if (_failFast)
                    {
                        return false;
                    }
                }
                continue;
            }
            var ok = ValidateProperty(kvp.Value, propDef, schema, $"{path}/{Escape(kvp.Key)}", errors);
            if (!ok && _failFast)
            {
                return false;
            }
        }

        return true;
    }

    private bool ValidateProperty(object? value, PropertyDef prop, Schema schema, string path, List<ValidationError> errors)
    {
        if (prop is ArrayProperty arr)
        {
            return ValidateArray(value, arr, schema, path, errors);
        }
        if (prop is PrimitiveProperty prim)
        {
            return ValidatePrimitive(value, prim, path, errors);
        }
        if (prop is TypeRefProperty typeRef)
        {
            return ValidateTypeRef(value, typeRef, schema, path, errors);
        }
        return true;
    }

    private bool ValidateArray(object? value, ArrayProperty prop, Schema schema, string path, List<ValidationError> errors)
    {
        if (value is not List<object?> list)
        {
            errors.Add(new ValidationError(path, ErrorCode.TYPE_MISMATCH, "expected an array"));
            return !_failFast;
        }

        if (list.Count < prop.MinItems)
        {
            errors.Add(new ValidationError(path, ErrorCode.ARRAY_TOO_SHORT,
                $"array has {list.Count} item(s), minimum is {prop.MinItems}"));
            if (_failFast)
            {
                return false;
            }
        }

        if (prop.MaxItems is not null && list.Count > prop.MaxItems)
        {
            errors.Add(new ValidationError(path, ErrorCode.ARRAY_TOO_LONG,
                $"array has {list.Count} item(s), maximum is {prop.MaxItems}"));
            if (_failFast)
            {
                return false;
            }
        }

        if (prop.UniqueItems)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in list)
            {
                var key = SerialiseForUniqueness(item);
                if (!seen.Add(key))
                {
                    errors.Add(new ValidationError(path, ErrorCode.ARRAY_DUPLICATE_ITEMS,
                        "array items must be unique"));
                    if (_failFast)
                    {
                        return false;
                    }
                    break;
                }
            }
        }

        for (var i = 0; i < list.Count; i++)
        {
            var ok = ValidateProperty(list[i], prop.Items, schema, $"{path}/{i}", errors);
            if (!ok && _failFast)
            {
                return false;
            }
        }

        return true;
    }

    private bool ValidatePrimitive(object? value, PrimitiveProperty prop, string path, List<ValidationError> errors)
    {
        if (!JsonKindMatches(value, prop.Kind))
        {
            errors.Add(new ValidationError(path, ErrorCode.TYPE_MISMATCH,
                $"expected {prop.Kind}, got {JsonTypeName(value)}"));
            return !_failFast;
        }

        if (prop.Kind == "integer" && value is double d && Math.Abs(d % 1) > 1e-12)
        {
            errors.Add(new ValidationError(path, ErrorCode.NOT_INTEGER,
                "value must be an integer (no fractional part)"));
            if (_failFast)
            {
                return false;
            }
        }

        if (prop.Kind == "string" && value is string s)
        {
            var length = s.Length;
            if (prop.MinLength is not null && length < prop.MinLength)
            {
                errors.Add(new ValidationError(path, ErrorCode.STRING_TOO_SHORT,
                    $"string length {length} < minLength {prop.MinLength}"));
                if (_failFast)
                {
                    return false;
                }
            }
            if (prop.MaxLength is not null && length > prop.MaxLength)
            {
                errors.Add(new ValidationError(path, ErrorCode.STRING_TOO_LONG,
                    $"string length {length} > maxLength {prop.MaxLength}"));
                if (_failFast)
                {
                    return false;
                }
            }
            if (prop.Pattern is not null)
            {
                try
                {
                    var re = new Regex(prop.Pattern);
                    if (!re.IsMatch(s))
                    {
                        errors.Add(new ValidationError(path, ErrorCode.PATTERN_MISMATCH,
                            $"value does not match pattern '{prop.Pattern}'"));
                        if (_failFast)
                        {
                            return false;
                        }
                    }
                }
                catch (ArgumentException e)
                {
                    errors.Add(new ValidationError(path, ErrorCode.PATTERN_MISMATCH,
                        $"invalid pattern '{prop.Pattern}': {e.Message}"));
                    if (_failFast)
                    {
                        return false;
                    }
                }
            }
            if (prop.Enum is not null && !EnumContains(prop.Enum, s))
            {
                errors.Add(new ValidationError(path, ErrorCode.ENUM_MISMATCH,
                    $"value '{s}' not in enum [{string.Join(",", prop.Enum)}]"));
                if (_failFast)
                {
                    return false;
                }
            }
        }
        else if ((prop.Kind == "integer" || prop.Kind == "number") && value is not null)
        {
            if (value is not long && value is not int && value is not double && value is not float)
            {
                return !_failFast;
            }
            var num = JsonUtil.AsDouble(value);
            if (prop.Minimum is not null && num < prop.Minimum)
            {
                errors.Add(new ValidationError(path, ErrorCode.BELOW_MINIMUM,
                    $"value {value} < minimum {prop.Minimum}"));
                if (_failFast)
                {
                    return false;
                }
            }
            if (prop.Maximum is not null && num > prop.Maximum)
            {
                errors.Add(new ValidationError(path, ErrorCode.ABOVE_MAXIMUM,
                    $"value {value} > maximum {prop.Maximum}"));
                if (_failFast)
                {
                    return false;
                }
            }
            if (prop.ExclusiveMinimum is not null && num <= prop.ExclusiveMinimum)
            {
                errors.Add(new ValidationError(path, ErrorCode.BELOW_EXCLUSIVE_MINIMUM,
                    $"value {value} must be > {prop.ExclusiveMinimum}"));
                if (_failFast)
                {
                    return false;
                }
            }
            if (prop.ExclusiveMaximum is not null && num >= prop.ExclusiveMaximum)
            {
                errors.Add(new ValidationError(path, ErrorCode.ABOVE_EXCLUSIVE_MAXIMUM,
                    $"value {value} must be < {prop.ExclusiveMaximum}"));
                if (_failFast)
                {
                    return false;
                }
            }
            if (prop.MultipleOf is not null)
            {
                var remainder = Math.Abs(num % prop.MultipleOf.Value);
                var rounded = Math.Round(remainder, 10);
                if (rounded != 0.0 && rounded != prop.MultipleOf.Value)
                {
                    errors.Add(new ValidationError(path, ErrorCode.NOT_MULTIPLE_OF,
                        $"value {value} is not a multiple of {prop.MultipleOf}"));
                    if (_failFast)
                    {
                        return false;
                    }
                }
            }
            if (prop.Enum is not null && !EnumContains(prop.Enum, value))
            {
                errors.Add(new ValidationError(path, ErrorCode.ENUM_MISMATCH,
                    $"value {value} not in enum [{string.Join(",", prop.Enum)}]"));
                if (_failFast)
                {
                    return false;
                }
            }
        }

        return true;
    }

    private bool ValidateTypeRef(object? value, TypeRefProperty prop, Schema schema, string path, List<ValidationError> errors)
    {
        if (value is not Dictionary<string, object?>)
        {
            errors.Add(new ValidationError(path, ErrorCode.TYPE_MISMATCH,
                "expected a JSON object for type reference"));
            return !_failFast;
        }

        var refType = prop.ResolvedType;
        if (refType is null)
        {
            errors.Add(new ValidationError(path, ErrorCode.UNKNOWN_TYPE,
                $"type reference '{prop.TypeName}' was not resolved at load time"));
            return !_failFast;
        }

        var refSchema = _registry.GetSchema(refType.SchemaId) ?? schema;
        return ValidateInstance(value, refType, refSchema, path, errors);
    }

    private static bool JsonKindMatches(object? value, string kind)
    {
        return kind switch
        {
            "null" => value is null,
            "boolean" => value is bool,
            "string" => value is string,
            "integer" => value is long || value is int || value is double || value is float,
            "number" => value is long || value is int || value is double || value is float,
            _ => false,
        };
    }

    private static string JsonTypeName(object? value)
    {
        return value switch
        {
            null => "null",
            bool => "boolean",
            string => "string",
            long => "integer",
            int => "integer",
            double => "number",
            float => "number",
            List<object?> => "array",
            Dictionary<string, object?> => "object",
            _ => value.GetType().Name,
        };
    }

    private static string Escape(string token) => token.Replace("~", "~0").Replace("/", "~1");

    private static string SerialiseForUniqueness(object? value)
    {
        var sorted = SortKeysRecursive(value);
        return JsonSerializer.Serialize(sorted);
    }

    private static object? SortKeysRecursive(object? value)
    {
        if (value is Dictionary<string, object?> dict)
        {
            var sorted = new SortedDictionary<string, object?>(StringComparer.Ordinal);
            foreach (var kvp in dict)
            {
                sorted[kvp.Key] = SortKeysRecursive(kvp.Value);
            }
            return sorted;
        }
        if (value is List<object?> list)
        {
            return list.Select(SortKeysRecursive).ToList();
        }
        return value;
    }

    private static bool EnumContains(List<object?> values, object? candidate)
    {
        foreach (var v in values)
        {
            if (v is null && candidate is null)
            {
                return true;
            }
            if (v is string vs && candidate is string cs && vs == cs)
            {
                return true;
            }
            if (v is bool vb && candidate is bool cb && vb == cb)
            {
                return true;
            }
            if (v is long || v is int || v is double || v is float)
            {
                if (candidate is long || candidate is int || candidate is double || candidate is float)
                {
                    var a = JsonUtil.AsDouble(v!);
                    var b = JsonUtil.AsDouble(candidate!);
                    if (Math.Abs(a - b) < 1e-12)
                    {
                        return true;
                    }
                }
            }
        }
        return false;
    }
}

public static class ValidatorUtil
{
    public static List<ValidationError> Validate(
        object? instance,
        TypeDef targetType,
        Schema schema,
        Registry registry,
        bool failFast = false)
    {
        return new Validator(registry, failFast).Validate(instance, targetType, schema);
    }
}
