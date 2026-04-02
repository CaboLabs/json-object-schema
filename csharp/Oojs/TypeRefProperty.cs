namespace Oojs;

public sealed class TypeRefProperty : PropertyDef
{
    public TypeRefProperty(string typeName)
    {
        TypeName = typeName;
    }

    public string TypeName { get; }
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;

    /// <summary>Populated at load time by Registry pass 3; null until then.</summary>
    public TypeDef? ResolvedType { get; set; }
}
