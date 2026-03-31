using System.Text.Json;

namespace Oojs;

internal static class JsonUtil
{
    public static object? Normalize(object? value)
    {
        if (value is JsonElement el)
        {
            return FromJson(el);
        }
        if (value is Dictionary<string, object?> dict)
        {
            var normalized = new Dictionary<string, object?>(StringComparer.Ordinal);
            foreach (var kvp in dict)
            {
                normalized[kvp.Key] = Normalize(kvp.Value);
            }
            return normalized;
        }
        if (value is List<object?> list)
        {
            var normalized = new List<object?>(list.Count);
            foreach (var item in list)
            {
                normalized.Add(Normalize(item));
            }
            return normalized;
        }
        return value;
    }

    public static object? FromJson(JsonElement el)
    {
        switch (el.ValueKind)
        {
            case JsonValueKind.Object:
            {
                var dict = new Dictionary<string, object?>(StringComparer.Ordinal);
                foreach (var prop in el.EnumerateObject())
                {
                    dict[prop.Name] = FromJson(prop.Value);
                }
                return dict;
            }
            case JsonValueKind.Array:
            {
                var list = new List<object?>();
                foreach (var item in el.EnumerateArray())
                {
                    list.Add(FromJson(item));
                }
                return list;
            }
            case JsonValueKind.String:
                return el.GetString();
            case JsonValueKind.Number:
                if (el.TryGetInt64(out var i))
                {
                    return i;
                }
                return el.GetDouble();
            case JsonValueKind.True:
                return true;
            case JsonValueKind.False:
                return false;
            case JsonValueKind.Null:
            case JsonValueKind.Undefined:
            default:
                return null;
        }
    }

    public static bool IsIntegerValue(object value)
    {
        return value switch
        {
            long => true,
            int => true,
            double d => Math.Abs(d % 1) < 1e-12,
            float f => Math.Abs(f % 1) < 1e-6,
            _ => false,
        };
    }

    public static double AsDouble(object value)
    {
        return value switch
        {
            long l => l,
            int i => i,
            double d => d,
            float f => f,
            _ => throw new InvalidOperationException("Value is not numeric"),
        };
    }
}
