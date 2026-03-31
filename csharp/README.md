# Oojs C# Implementation

This folder contains a C# port of the OOJS schema/validation model used in the PHP and Python implementations. It mirrors the same core concepts and APIs: schema parsing, type registry, and JSON instance validation.

**Project layout**
- `csharp/Oojs`: library with the schema model, registry, and validator.
- `csharp/Oojs.Tests`: xUnit tests that cover schema parsing, validation behavior, and the sample schemas.

## Requirements
- .NET SDK 8.0 or newer

## Build
```bash
cd csharp
dotnet build Oojs/Oojs.csproj
```

## Run Tests
```bash
cd csharp
dotnet test Oojs.Tests/Oojs.Tests.csproj
```

## Usage
The API mirrors the PHP/Python implementations:

- `Registry` parses schemas (`LoadJson`, `LoadFile`, `LoadDict`) and resolves types.
- `Validator` validates instances and can parse JSON text (`ValidateJson`).
- `ValidatorUtil.Validate(...)` is a helper for direct validation.

Example (load schema + validate a JSON instance):

```csharp
using Oojs;

var schema = new Dictionary<string, object?>
{
    ["$oojs"] = "1.0",
    ["$id"] = "https://example.org/schemas/example",
    ["types"] = new Dictionary<string, object?>
    {
        ["Person"] = new Dictionary<string, object?>
        {
            ["properties"] = new Dictionary<string, object?>
            {
                ["name"] = new Dictionary<string, object?> { ["type"] = "string" },
                ["age"] = new Dictionary<string, object?> { ["type"] = "integer", ["minimum"] = 0 },
            },
            ["required"] = new List<object?> { "name" },
        },
    },
};

var instance = new Dictionary<string, object?>
{
    ["_type"] = "Person",
    ["name"] = "Ada",
    ["age"] = 36L,
};

var registry = new Registry();
var loaded = registry.LoadDict(schema);
var errors = ValidatorUtil.Validate(instance, loaded.Types["Person"], loaded, registry);

if (errors.Count == 0)
{
    Console.WriteLine("valid");
}
else
{
    foreach (var err in errors)
    {
        Console.WriteLine(err);
    }
}
```

## Notes
- The schema discriminator defaults to `_type`, matching the PHP/Python implementations.
- Use `Dictionary<string, object?>` and `List<object?>` to represent JSON objects and arrays when validating in-memory instances.
- `additionalProperties: true` in a schema allows extra JSON fields (open-world mode). By default, schemas are closed-world and extra properties are errors.
