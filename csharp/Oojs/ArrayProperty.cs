namespace Oojs;

public sealed class ArrayProperty : PropertyDef
{
    public ArrayProperty(PropertyDef items)
    {
        Items = items;
    }

    public PropertyDef Items { get; }
    public int MinItems { get; set; } = 0;
    public int? MaxItems { get; set; }
    public bool UniqueItems { get; set; } = false;
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
}
