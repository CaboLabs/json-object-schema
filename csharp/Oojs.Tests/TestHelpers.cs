using Oojs;

namespace Oojs.Tests;

internal static class TestHelpers
{
    public static Dictionary<string, object?> MinimalSchema() => new()
    {
        ["$oojs"] = "1.0",
        ["$id"] = "https://example.org/schemas/test",
        ["types"] = new Dictionary<string, object?>
        {
            ["Animal"] = new Dictionary<string, object?>
            {
                ["abstract"] = true,
                ["properties"] = new Dictionary<string, object?>
                {
                    ["name"] = new Dictionary<string, object?> { ["type"] = "string" },
                    ["age"] = new Dictionary<string, object?> { ["type"] = "integer", ["minimum"] = 0 },
                },
                ["required"] = new List<object?> { "name" },
            },
            ["Dog"] = new Dictionary<string, object?>
            {
                ["extends"] = "Animal",
                ["properties"] = new Dictionary<string, object?>
                {
                    ["breed"] = new Dictionary<string, object?> { ["type"] = "string" },
                },
                ["required"] = new List<object?> { "breed" },
            },
            ["Cat"] = new Dictionary<string, object?>
            {
                ["extends"] = "Animal",
                ["properties"] = new Dictionary<string, object?>
                {
                    ["indoor"] = new Dictionary<string, object?> { ["type"] = "boolean" },
                },
            },
        },
    };

    public static (Registry registry, Schema schema) AnimalRegistry()
    {
        var r = new Registry();
        var schema = r.LoadDict(MinimalSchema());
        return (r, schema);
    }

    public static bool HasCode(IEnumerable<ValidationError> errors, string code) =>
        errors.Any(e => e.Code == code);
}
