namespace Oojs;

public sealed class TypeDef
{
    public TypeDef(
        string name,
        string schemaId,
        bool isAbstract = false,
        string? extends = null,
        string? discriminatorValue = null,
        string title = "",
        string description = "")
    {
        Name = name;
        SchemaId = schemaId;
        Abstract = isAbstract;
        Extends = extends;
        DiscriminatorValue = discriminatorValue;
        Title = title;
        Description = description;
    }

    public string Name { get; }
    public string SchemaId { get; }
    public bool Abstract { get; }
    public string? Extends { get; }
    public string? DiscriminatorValue { get; }
    public string Title { get; }
    public string Description { get; }

    public Dictionary<string, PropertyDef> OwnProperties { get; } = new();
    public List<string> OwnRequired { get; } = new();
    public TypeDef? Supertype { get; set; }

    public string EffectiveDiscriminatorValue => DiscriminatorValue ?? Name;

    public List<string> EffectiveRequired()
    {
        if (Supertype is null)
        {
            return new List<string>(OwnRequired);
        }
        var req = Supertype.EffectiveRequired();
        req.AddRange(OwnRequired);
        return req;
    }

    public Dictionary<string, PropertyDef> EffectiveProperties()
    {
        if (Supertype is null)
        {
            return new Dictionary<string, PropertyDef>(OwnProperties);
        }
        var props = Supertype.EffectiveProperties();
        foreach (var kvp in OwnProperties)
        {
            props[kvp.Key] = kvp.Value;
        }
        return props;
    }

    public bool IsSubtypeOf(TypeDef other)
    {
        var current = this as TypeDef?;
        while (current is not null)
        {
            if (ReferenceEquals(current, other))
            {
                return true;
            }
            current = current.Supertype;
        }
        return false;
    }
}
