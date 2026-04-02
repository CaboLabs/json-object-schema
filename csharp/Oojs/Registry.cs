using System.Text.Json;
using System.Text.RegularExpressions;

namespace Oojs;

public sealed class Registry
{
    private static readonly Regex TypeNameRe = new("^[A-Z][A-Za-z0-9_]*$", RegexOptions.Compiled);
    private static readonly Regex PropNameRe = new("^[a-z_][A-Za-z0-9_]*$", RegexOptions.Compiled);

    private static readonly HashSet<string> PrimitiveTypes = new(StringComparer.Ordinal)
    {
        "string", "integer", "number", "boolean", "null",
    };

    private static readonly HashSet<string> ReservedTypeNames = new(StringComparer.Ordinal)
    {
        "string", "integer", "number", "boolean", "null", "array",
    };

    private readonly Dictionary<string, Schema> _schemas = new(StringComparer.Ordinal);
    private readonly Dictionary<string, TypeDef> _byDv = new(StringComparer.Ordinal);

    public Schema LoadFile(string path)
    {
        var text = File.ReadAllText(path);
        try
        {
            using var doc = JsonDocument.Parse(text);
            return Load(doc.RootElement, path);
        }
        catch (JsonException e)
        {
            throw new SchemaError($"{path}: invalid JSON: {e.Message}");
        }
    }

    public Schema LoadJson(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            return Load(doc.RootElement, "<string>");
        }
        catch (JsonException e)
        {
            throw new SchemaError($"<string>: invalid JSON: {e.Message}");
        }
    }

    public Schema LoadDict(Dictionary<string, object?> data)
    {
        var element = JsonSerializer.SerializeToElement(data);
        return Load(element, "<dict>");
    }

    private Schema Load(JsonElement data, string source)
    {
        if (data.ValueKind != JsonValueKind.Object)
        {
            throw new SchemaError($"{source}: schema must be a JSON object");
        }

        if (!data.TryGetProperty("$oojs", out var oojsEl))
        {
            throw new SchemaError($"{source}: missing required field '$oojs'");
        }
        if (oojsEl.ValueKind != JsonValueKind.String)
        {
            throw new SchemaError($"{source}: unsupported $oojs version '{oojsEl.ToString()}'");
        }
        var oojs = oojsEl.GetString() ?? string.Empty;
        if (oojs != "1.0")
        {
            throw new SchemaError($"{source}: unsupported $oojs version '{oojs}'");
        }

        if (!data.TryGetProperty("$id", out var idEl))
        {
            throw new SchemaError($"{source}: missing required field '$id'");
        }
        if (idEl.ValueKind != JsonValueKind.String || string.IsNullOrEmpty(idEl.GetString()))
        {
            throw new SchemaError($"{source}: '$id' must be a non-empty string");
        }
        var schemaId = idEl.GetString()!;

        if (_schemas.TryGetValue(schemaId, out var existing))
        {
            return existing;
        }

        string discriminator = "_type";
        if (data.TryGetProperty("discriminator", out var discEl))
        {
            if (discEl.ValueKind != JsonValueKind.String || string.IsNullOrEmpty(discEl.GetString()))
            {
                throw new SchemaError($"{source}: 'discriminator' must be a non-empty string");
            }
            discriminator = discEl.GetString()!;
        }

        var rawImports = new Dictionary<string, string>(StringComparer.Ordinal);
        if (data.TryGetProperty("imports", out var importsEl))
        {
            if (importsEl.ValueKind != JsonValueKind.Object)
            {
                throw new SchemaError($"{source}: 'imports' must be an object");
            }
            foreach (var prop in importsEl.EnumerateObject())
            {
                var alias = prop.Name;
                if (!PropNameRe.IsMatch(alias))
                {
                    throw new SchemaError($"{source}: import alias '{alias}' violates naming rules");
                }
                if (prop.Value.ValueKind != JsonValueKind.String)
                {
                    throw new SchemaError($"{source}: import value for alias '{alias}' must be a string");
                }
                rawImports[alias] = prop.Value.GetString()!;
            }
        }

        if (!data.TryGetProperty("types", out var typesEl))
        {
            throw new SchemaError($"{source}: missing required field 'types'");
        }
        if (typesEl.ValueKind != JsonValueKind.Object || !typesEl.EnumerateObject().Any())
        {
            throw new SchemaError($"{source}: 'types' must be a non-empty object");
        }

        var schema = new Schema(
            oojsVersion: oojs,
            schemaId: schemaId,
            title: data.TryGetProperty("title", out var titleEl) && titleEl.ValueKind == JsonValueKind.String
                ? titleEl.GetString() ?? string.Empty
                : string.Empty,
            description: data.TryGetProperty("description", out var descEl) && descEl.ValueKind == JsonValueKind.String
                ? descEl.GetString() ?? string.Empty
                : string.Empty,
            discriminator: discriminator,
            closedWorld: !(data.TryGetProperty("additionalProperties", out var addProps) && addProps.ValueKind == JsonValueKind.True)
        );
        foreach (var kvp in rawImports)
        {
            schema.Imports[kvp.Key] = kvp.Value;
        }

        _schemas[schemaId] = schema;

        foreach (var typeProp in typesEl.EnumerateObject())
        {
            var typeName = typeProp.Name;
            if (ReservedTypeNames.Contains(typeName))
            {
                throw new SchemaError($"{source}: '{typeName}' is a reserved name");
            }
            if (!TypeNameRe.IsMatch(typeName))
            {
                throw new SchemaError($"{source}: type name '{typeName}' violates naming rules");
            }
            var typedef = ParseType(typeName, typeProp.Value, schema, source);
            schema.Types[typeName] = typedef;
        }

        foreach (var kvp in schema.Types)
        {
            if (kvp.Value.OwnProperties.ContainsKey(discriminator))
            {
                throw new SchemaError(
                    $"{source}: type '{kvp.Key}' declares property '{discriminator}' " +
                    "which collides with the schema discriminator"
                );
            }
        }

        ResolveHierarchy(schema, source);
        ResolvePropertyTypeRefs(schema, source);

        foreach (var kvp in schema.Types)
        {
            foreach (var req in kvp.Value.OwnRequired)
            {
                if (!kvp.Value.OwnProperties.ContainsKey(req))
                {
                    throw new SchemaError(
                        $"{source}: type '{kvp.Key}' lists '{req}' in 'required' " +
                        "but it is not declared in own 'properties'"
                    );
                }
            }
        }

        foreach (var kvp in schema.Types)
        {
            if (kvp.Value.Supertype is not null)
            {
                var inherited = kvp.Value.Supertype.EffectiveProperties().Keys.ToHashSet(StringComparer.Ordinal);
                var own = kvp.Value.OwnProperties.Keys.ToHashSet(StringComparer.Ordinal);
                inherited.IntersectWith(own);
                if (inherited.Count > 0)
                {
                    var overlap = string.Join(", ", inherited.OrderBy(x => x));
                    throw new SchemaError(
                        $"{source}: type '{kvp.Key}' redeclares inherited properties: [{overlap}]"
                    );
                }
            }
        }

        foreach (var kvp in schema.Types)
        {
            var dv = kvp.Value.EffectiveDiscriminatorValue;
            if (_byDv.TryGetValue(dv, out var existingType) && !ReferenceEquals(existingType, kvp.Value))
            {
                throw new SchemaError(
                    $"{source}: discriminator value '{dv}' is already used by " +
                    $"type '{existingType.Name}' in schema '{existingType.SchemaId}'"
                );
            }
            _byDv[dv] = kvp.Value;
        }

        return schema;
    }

    private TypeDef ParseType(string name, JsonElement data, Schema schema, string source)
    {
        if (data.ValueKind != JsonValueKind.Object)
        {
            throw new SchemaError($"{source}: type '{name}' definition must be a JSON object");
        }

        string? extends = null;
        if (data.TryGetProperty("extends", out var extendsEl))
        {
            if (extendsEl.ValueKind != JsonValueKind.String)
            {
                throw new SchemaError($"{source}: type '{name}' 'extends' must be a string");
            }
            extends = extendsEl.GetString();
        }

        bool isAbstract = false;
        if (data.TryGetProperty("abstract", out var absEl))
        {
            if (absEl.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            {
                throw new SchemaError($"{source}: type '{name}' 'abstract' must be a boolean");
            }
            isAbstract = absEl.GetBoolean();
        }

        string? dv = null;
        if (data.TryGetProperty("discriminatorValue", out var dvEl))
        {
            if (dvEl.ValueKind != JsonValueKind.String)
            {
                throw new SchemaError($"{source}: type '{name}' 'discriminatorValue' must be a string");
            }
            dv = dvEl.GetString();
        }

        var typedef = new TypeDef(
            name: name,
            schemaId: schema.SchemaId,
            isAbstract: isAbstract,
            extends: extends,
            discriminatorValue: dv,
            title: data.TryGetProperty("title", out var titleEl) && titleEl.ValueKind == JsonValueKind.String
                ? titleEl.GetString() ?? string.Empty
                : string.Empty,
            description: data.TryGetProperty("description", out var descEl) && descEl.ValueKind == JsonValueKind.String
                ? descEl.GetString() ?? string.Empty
                : string.Empty
        );

        if (data.TryGetProperty("properties", out var propsEl))
        {
            if (propsEl.ValueKind != JsonValueKind.Object)
            {
                throw new SchemaError($"{source}: type '{name}' 'properties' must be an object");
            }
            foreach (var prop in propsEl.EnumerateObject())
            {
                if (!PropNameRe.IsMatch(prop.Name))
                {
                    throw new SchemaError(
                        $"{source}: property '{prop.Name}' in type '{name}' violates naming rules"
                    );
                }
                typedef.OwnProperties[prop.Name] = ParseProperty(prop.Name, prop.Value, name, source);
            }
        }
        else
        {
            // default empty
        }

        if (data.TryGetProperty("required", out var requiredEl))
        {
            if (requiredEl.ValueKind != JsonValueKind.Array)
            {
                throw new SchemaError($"{source}: type '{name}' 'required' must be an array");
            }
            foreach (var item in requiredEl.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.String)
                {
                    throw new SchemaError($"{source}: type '{name}' 'required' entries must be strings");
                }
                var req = item.GetString()!;
                if (typedef.OwnRequired.Contains(req))
                {
                    throw new SchemaError($"{source}: type '{name}' 'required' lists '{req}' more than once");
                }
                typedef.OwnRequired.Add(req);
            }
        }

        return typedef;
    }

    private PropertyDef ParseProperty(string propName, JsonElement data, string typeName, string source)
    {
        if (data.ValueKind != JsonValueKind.Object)
        {
            throw new SchemaError(
                $"{source}: property '{propName}' in type '{typeName}' must be a JSON object"
            );
        }
        if (!data.TryGetProperty("type", out var typeEl))
        {
            throw new SchemaError(
                $"{source}: property '{propName}' in type '{typeName}' missing 'type'"
            );
        }
        if (typeEl.ValueKind != JsonValueKind.String)
        {
            throw new SchemaError(
                $"{source}: property '{propName}' in type '{typeName}' 'type' must be a string"
            );
        }
        var kind = typeEl.GetString()!;

        if (kind == "array")
        {
            return ParseArrayProperty(propName, data, typeName, source);
        }
        if (PrimitiveTypes.Contains(kind))
        {
            return ParsePrimitiveProperty(propName, data, typeName, source);
        }

        return new TypeRefProperty(kind)
        {
            Title = data.TryGetProperty("title", out var titleEl) && titleEl.ValueKind == JsonValueKind.String
                ? titleEl.GetString() ?? string.Empty
                : string.Empty,
            Description = data.TryGetProperty("description", out var descEl) && descEl.ValueKind == JsonValueKind.String
                ? descEl.GetString() ?? string.Empty
                : string.Empty,
        };
    }

    private PrimitiveProperty ParsePrimitiveProperty(
        string propName,
        JsonElement data,
        string typeName,
        string source)
    {
        var kind = data.GetProperty("type").GetString()!;
        var p = new PrimitiveProperty(kind)
        {
            Title = data.TryGetProperty("title", out var titleEl) && titleEl.ValueKind == JsonValueKind.String
                ? titleEl.GetString() ?? string.Empty
                : string.Empty,
            Description = data.TryGetProperty("description", out var descEl) && descEl.ValueKind == JsonValueKind.String
                ? descEl.GetString() ?? string.Empty
                : string.Empty,
        };

        int? IntGeZero(string key)
        {
            if (!data.TryGetProperty(key, out var el))
            {
                return null;
            }
            if (el.ValueKind != JsonValueKind.Number || !el.TryGetInt32(out var v) || v < 0)
            {
                throw new SchemaError(
                    $"{source}: '{key}' on property '{propName}' in '{typeName}' must be a non-negative integer"
                );
            }
            return v;
        }

        double? Number(string key)
        {
            if (!data.TryGetProperty(key, out var el))
            {
                return null;
            }
            if (el.ValueKind != JsonValueKind.Number)
            {
                throw new SchemaError(
                    $"{source}: '{key}' on property '{propName}' in '{typeName}' must be a number"
                );
            }
            return el.GetDouble();
        }

        if (kind == "string")
        {
            p.MinLength = IntGeZero("minLength");
            p.MaxLength = IntGeZero("maxLength");
            if (p.MinLength is not null && p.MaxLength is not null && p.MinLength > p.MaxLength)
            {
                throw new SchemaError(
                    $"{source}: 'minLength' > 'maxLength' on '{propName}' in '{typeName}'"
                );
            }
            if (data.TryGetProperty("pattern", out var patternEl))
            {
                if (patternEl.ValueKind != JsonValueKind.String)
                {
                    throw new SchemaError($"{source}: 'pattern' on '{propName}' must be a string");
                }
                p.Pattern = patternEl.GetString();
            }
            if (data.TryGetProperty("format", out var formatEl) && formatEl.ValueKind == JsonValueKind.String)
            {
                p.Format = formatEl.GetString();
            }
            if (data.TryGetProperty("enum", out var enumEl))
            {
                if (enumEl.ValueKind != JsonValueKind.Array || !enumEl.EnumerateArray().Any())
                {
                    throw new SchemaError($"{source}: 'enum' on '{propName}' must be a non-empty array");
                }
                p.Enum = enumEl.EnumerateArray().Select(JsonUtil.FromJson).ToList();
            }
        }
        else if (kind == "integer" || kind == "number")
        {
            p.Minimum = Number("minimum");
            p.Maximum = Number("maximum");
            p.ExclusiveMinimum = Number("exclusiveMinimum");
            p.ExclusiveMaximum = Number("exclusiveMaximum");
            if (p.Minimum is not null && p.ExclusiveMinimum is not null)
            {
                throw new SchemaError(
                    $"{source}: 'minimum' and 'exclusiveMinimum' are mutually exclusive on '{propName}' in '{typeName}'"
                );
            }
            if (p.Maximum is not null && p.ExclusiveMaximum is not null)
            {
                throw new SchemaError(
                    $"{source}: 'maximum' and 'exclusiveMaximum' are mutually exclusive on '{propName}' in '{typeName}'"
                );
            }
            if (data.TryGetProperty("multipleOf", out var moEl))
            {
                if (moEl.ValueKind != JsonValueKind.Number || moEl.GetDouble() <= 0)
                {
                    throw new SchemaError($"{source}: 'multipleOf' on '{propName}' must be > 0");
                }
                p.MultipleOf = moEl.GetDouble();
            }
            if (data.TryGetProperty("enum", out var enumEl))
            {
                if (enumEl.ValueKind != JsonValueKind.Array || !enumEl.EnumerateArray().Any())
                {
                    throw new SchemaError($"{source}: 'enum' on '{propName}' must be a non-empty array");
                }
                p.Enum = enumEl.EnumerateArray().Select(JsonUtil.FromJson).ToList();
            }
        }

        return p;
    }

    private ArrayProperty ParseArrayProperty(
        string propName,
        JsonElement data,
        string typeName,
        string source)
    {
        if (!data.TryGetProperty("items", out var itemsEl))
        {
            throw new SchemaError(
                $"{source}: array property '{propName}' in '{typeName}' missing 'items'"
            );
        }
        var items = ParseProperty(propName + ".items", itemsEl, typeName, source);
        if (items is ArrayProperty)
        {
            throw new SchemaError(
                $"{source}: nested arrays are not supported in v1.0 (property '{propName}' in '{typeName}')"
            );
        }

        int? IntGeZero(string key)
        {
            if (!data.TryGetProperty(key, out var el))
            {
                return null;
            }
            if (el.ValueKind != JsonValueKind.Number || !el.TryGetInt32(out var v) || v < 0)
            {
                throw new SchemaError(
                    $"{source}: '{key}' on '{propName}' in '{typeName}' must be a non-negative integer"
                );
            }
            return v;
        }

        var minItems = IntGeZero("minItems") ?? 0;
        var maxItems = IntGeZero("maxItems");
        if (maxItems is not null && minItems > maxItems)
        {
            throw new SchemaError($"{source}: 'minItems' > 'maxItems' on '{propName}' in '{typeName}'");
        }

        bool uniqueItems = false;
        if (data.TryGetProperty("uniqueItems", out var uniqueEl))
        {
            if (uniqueEl.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            {
                throw new SchemaError($"{source}: 'uniqueItems' on '{propName}' must be a boolean");
            }
            uniqueItems = uniqueEl.GetBoolean();
        }

        return new ArrayProperty(items)
        {
            MinItems = minItems,
            MaxItems = maxItems,
            UniqueItems = uniqueItems,
            Title = data.TryGetProperty("title", out var titleEl) && titleEl.ValueKind == JsonValueKind.String
                ? titleEl.GetString() ?? string.Empty
                : string.Empty,
            Description = data.TryGetProperty("description", out var descEl) && descEl.ValueKind == JsonValueKind.String
                ? descEl.GetString() ?? string.Empty
                : string.Empty,
        };
    }

    private void ResolveHierarchy(Schema schema, string source)
    {
        foreach (var kvp in schema.Types)
        {
            if (!string.IsNullOrEmpty(kvp.Value.Extends))
            {
                kvp.Value.Supertype = ResolveTypeRef(kvp.Value.Extends!, schema, source, $"type '{kvp.Key}'");
            }
        }

        foreach (var kvp in schema.Types)
        {
            var visited = new HashSet<string>(StringComparer.Ordinal);
            var current = kvp.Value;
            while (current is not null)
            {
                var key = $"{current.SchemaId}#{current.Name}";
                if (visited.Contains(key))
                {
                    throw new SchemaError(
                        $"{source}: inheritance cycle detected involving type '{kvp.Key}'"
                    );
                }
                visited.Add(key);
                current = current.Supertype;
            }
        }
    }

    private TypeDef ResolveTypeRef(string reference, Schema schema, string source, string context)
    {
        if (reference.Contains('.'))
        {
            var parts = reference.Split('.', 2);
            var alias = parts[0];
            var name = parts[1];
            if (!schema.Imports.TryGetValue(alias, out var importedId))
            {
                throw new SchemaError($"{source}: {context}: unknown import alias '{alias}'");
            }
            if (!_schemas.TryGetValue(importedId, out var importedSchema))
            {
                throw new SchemaError(
                    $"{source}: {context}: imported schema '{importedId}' (alias '{alias}') is not loaded"
                );
            }
            if (!importedSchema.Types.TryGetValue(name, out var typedef))
            {
                throw new SchemaError(
                    $"{source}: {context}: type '{name}' not found in schema '{importedId}'"
                );
            }
            return typedef;
        }

        if (!schema.Types.TryGetValue(reference, out var localType))
        {
            throw new SchemaError(
                $"{source}: {context}: type '{reference}' not found in schema '{schema.SchemaId}'"
            );
        }
        return localType;
    }

    private void ResolvePropertyTypeRefs(Schema schema, string source)
    {
        foreach (var (typeName, typedef) in schema.Types)
        {
            foreach (var (propName, prop) in typedef.OwnProperties)
            {
                ResolvePropertyTypeRef(prop, schema, source, $"type '{typeName}', property '{propName}'");
            }
        }
    }

    private void ResolvePropertyTypeRef(PropertyDef prop, Schema schema, string source, string context)
    {
        if (prop is TypeRefProperty trp)
        {
            trp.ResolvedType = ResolveTypeRef(trp.TypeName, schema, source, context);
        }
        else if (prop is ArrayProperty ap)
        {
            ResolvePropertyTypeRef(ap.Items, schema, source, context + ".items");
        }
    }

    public Schema? GetSchema(string schemaId) => _schemas.TryGetValue(schemaId, out var s) ? s : null;

    public TypeDef? LookupByDiscriminatorValue(string dv) => _byDv.TryGetValue(dv, out var t) ? t : null;

    public TypeDef? ResolveType(string name, Schema schema)
    {
        try
        {
            return ResolveTypeRef(name, schema, "<lookup>", string.Empty);
        }
        catch (SchemaError)
        {
            return null;
        }
    }

    public TypeDef? ResolveTypeIn(string name, string schemaId)
    {
        if (!_schemas.TryGetValue(schemaId, out var schema))
        {
            return null;
        }
        try
        {
            return ResolveTypeRef(name, schema, "<lookup>", string.Empty);
        }
        catch (SchemaError)
        {
            return null;
        }
    }
}
