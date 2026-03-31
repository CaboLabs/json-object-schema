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
}
