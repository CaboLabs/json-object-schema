namespace Oojs;

public sealed class Schema
{
    public Schema(
        string oojsVersion,
        string schemaId,
        string title = "",
        string description = "",
        string discriminator = "_type",
        bool closedWorld = true)
    {
        OojsVersion = oojsVersion;
        SchemaId = schemaId;
        Title = title;
        Description = description;
        Discriminator = discriminator;
        ClosedWorld = closedWorld;
    }

    public string OojsVersion { get; }
    public string SchemaId { get; }
    public string Title { get; }
    public string Description { get; }
    public string Discriminator { get; }
    public bool ClosedWorld { get; }

    public Dictionary<string, string> Imports { get; } = new();
    public Dictionary<string, TypeDef> Types { get; } = new();
}
