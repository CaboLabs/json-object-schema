namespace Oojs;

public sealed class PrimitiveProperty : PropertyDef
{
    public PrimitiveProperty(string kind)
    {
        Kind = kind;
    }

    public string Kind { get; }
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;

    public int? MinLength { get; set; }
    public int? MaxLength { get; set; }
    public string? Pattern { get; set; }
    public string? Format { get; set; }

    public double? Minimum { get; set; }
    public double? Maximum { get; set; }
    public double? ExclusiveMinimum { get; set; }
    public double? ExclusiveMaximum { get; set; }
    public double? MultipleOf { get; set; }

    public List<object?>? Enum { get; set; }
}
