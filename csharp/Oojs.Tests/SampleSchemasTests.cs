using Oojs;
using Xunit;

namespace Oojs.Tests;

public sealed class SampleSchemasTests
{
    [Fact]
    public void CarMotorWheelsSampleValid()
    {
        var schema = new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "https://example.org/schemas/car",
            ["types"] = new Dictionary<string, object?>
            {
                ["Motor"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["horsepower"] = new Dictionary<string, object?> { ["type"] = "number", ["minimum"] = 1 },
                        ["cylinders"] = new Dictionary<string, object?> { ["type"] = "integer", ["minimum"] = 1 },
                    },
                    ["required"] = new List<object?> { "horsepower", "cylinders" },
                },
                ["Wheel"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["size"] = new Dictionary<string, object?> { ["type"] = "number", ["minimum"] = 10 },
                        ["material"] = new Dictionary<string, object?> { ["type"] = "string", ["enum"] = new List<object?> { "rubber" } },
                    },
                    ["required"] = new List<object?> { "size", "material" },
                },
                ["Car"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["make"] = new Dictionary<string, object?> { ["type"] = "string" },
                        ["model"] = new Dictionary<string, object?> { ["type"] = "string" },
                        ["motor"] = new Dictionary<string, object?> { ["type"] = "Motor" },
                        ["wheels"] = new Dictionary<string, object?>
                        {
                            ["type"] = "array",
                            ["items"] = new Dictionary<string, object?> { ["type"] = "Wheel" },
                            ["minItems"] = 4,
                            ["maxItems"] = 4,
                        },
                    },
                    ["required"] = new List<object?> { "make", "model", "motor", "wheels" },
                },
            },
        };

        var instance = new Dictionary<string, object?>
        {
            ["_type"] = "Car",
            ["make"] = "Acme",
            ["model"] = "Roadster",
            ["motor"] = new Dictionary<string, object?>
            {
                ["_type"] = "Motor",
                ["horsepower"] = 220L,
                ["cylinders"] = 4L,
            },
            ["wheels"] = new List<object?>
            {
                new Dictionary<string, object?> { ["_type"] = "Wheel", ["size"] = 18L, ["material"] = "rubber" },
                new Dictionary<string, object?> { ["_type"] = "Wheel", ["size"] = 18L, ["material"] = "rubber" },
                new Dictionary<string, object?> { ["_type"] = "Wheel", ["size"] = 18L, ["material"] = "rubber" },
                new Dictionary<string, object?> { ["_type"] = "Wheel", ["size"] = 18L, ["material"] = "rubber" },
            },
        };

        var r = new Registry();
        var loaded = r.LoadDict(schema);
        var errs = ValidatorUtil.Validate(instance, loaded.Types["Car"], loaded, r);

        Assert.Empty(errs);
    }

    [Fact]
    public void CarRelationshipsSampleValid()
    {
        var schema = new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "https://example.org/schemas/car-rel",
            ["types"] = new Dictionary<string, object?>
            {
                ["Person"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["personId"] = new Dictionary<string, object?> { ["type"] = "string" },
                        ["name"] = new Dictionary<string, object?> { ["type"] = "string" },
                        ["carIds"] = new Dictionary<string, object?>
                        {
                            ["type"] = "array",
                            ["items"] = new Dictionary<string, object?> { ["type"] = "string" },
                        },
                    },
                    ["required"] = new List<object?> { "personId", "name" },
                },
                ["Car"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["carId"] = new Dictionary<string, object?> { ["type"] = "string" },
                        ["make"] = new Dictionary<string, object?> { ["type"] = "string" },
                        ["model"] = new Dictionary<string, object?> { ["type"] = "string" },
                        ["ownerId"] = new Dictionary<string, object?> { ["type"] = "string" },
                        ["garageId"] = new Dictionary<string, object?> { ["type"] = "string" },
                    },
                    ["required"] = new List<object?> { "carId", "make", "model", "ownerId" },
                },
                ["Garage"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["garageId"] = new Dictionary<string, object?> { ["type"] = "string" },
                        ["name"] = new Dictionary<string, object?> { ["type"] = "string" },
                        ["carIds"] = new Dictionary<string, object?>
                        {
                            ["type"] = "array",
                            ["items"] = new Dictionary<string, object?> { ["type"] = "string" },
                        },
                    },
                    ["required"] = new List<object?> { "garageId", "name" },
                },
                ["Fleet"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["fleetId"] = new Dictionary<string, object?> { ["type"] = "string" },
                        ["name"] = new Dictionary<string, object?> { ["type"] = "string" },
                        ["carIds"] = new Dictionary<string, object?>
                        {
                            ["type"] = "array",
                            ["items"] = new Dictionary<string, object?> { ["type"] = "string" },
                        },
                        ["personIds"] = new Dictionary<string, object?>
                        {
                            ["type"] = "array",
                            ["items"] = new Dictionary<string, object?> { ["type"] = "string" },
                        },
                    },
                    ["required"] = new List<object?> { "fleetId", "name" },
                },
            },
        };

        var instance = new Dictionary<string, object?>
        {
            ["_type"] = "Fleet",
            ["fleetId"] = "fleet-1",
            ["name"] = "City Fleet",
            ["carIds"] = new List<object?> { "car-1", "car-2" },
            ["personIds"] = new List<object?> { "person-1" },
        };

        var r = new Registry();
        var loaded = r.LoadDict(schema);
        var errs = ValidatorUtil.Validate(instance, loaded.Types["Fleet"], loaded, r);

        Assert.Empty(errs);
    }
}
