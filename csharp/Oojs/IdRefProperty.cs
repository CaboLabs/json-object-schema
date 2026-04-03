namespace Oojs;

/// <summary>
/// A property that holds a string ID referencing another typed object (§6.4).
/// The value in JSON instances is a plain string (the ID). The validator checks
/// the value is a string but does NOT follow or validate the referenced object.
/// </summary>
public sealed class IdRefProperty : PropertyDef
{
    public IdRefProperty(string typeName)
    {
        TypeName = typeName;
    }

    public string TypeName { get; }
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public int? MinLength { get; set; }
    public int? MaxLength { get; set; }
    public string? Pattern { get; set; }

    /// <summary>Populated at load time by Registry pass 3; null until then.</summary>
    public TypeDef? ResolvedType { get; set; }
}
