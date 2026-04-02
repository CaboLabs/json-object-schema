using Oojs;
using Xunit;

namespace Oojs.Tests;

public sealed class SchemaLoadingTests
{
    [Fact]
    public void MinimalValidSchema()
    {
        var (r, schema) = TestHelpers.AnimalRegistry();
        Assert.NotNull(schema);
        Assert.True(schema.Types.ContainsKey("Animal"));
        Assert.True(schema.Types.ContainsKey("Dog"));
    }

    [Fact]
    public void MissingOojs()
    {
        var r = new Registry();
        Assert.Throws<SchemaError>(() => r.LoadDict(new Dictionary<string, object?>
        {
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?> { ["A"] = new Dictionary<string, object?>() },
        }));
    }

    [Fact]
    public void WrongVersion()
    {
        var r = new Registry();
        Assert.Throws<SchemaError>(() => r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "2.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?> { ["A"] = new Dictionary<string, object?>() },
        }));
    }

    [Fact]
    public void MissingId()
    {
        var r = new Registry();
        Assert.Throws<SchemaError>(() => r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["types"] = new Dictionary<string, object?> { ["A"] = new Dictionary<string, object?>() },
        }));
    }

    [Fact]
    public void MissingTypes()
    {
        var r = new Registry();
        Assert.Throws<SchemaError>(() => r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
        }));
    }

    [Fact]
    public void InvalidTypeName()
    {
        var r = new Registry();
        Assert.Throws<SchemaError>(() => r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?> { ["dog"] = new Dictionary<string, object?>() },
        }));
    }

    [Fact]
    public void ReservedTypeName()
    {
        var r = new Registry();
        Assert.Throws<SchemaError>(() => r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?> { ["string"] = new Dictionary<string, object?>() },
        }));
    }

    [Fact]
    public void DiscriminatorCollidesWithProperty()
    {
        var r = new Registry();
        Assert.Throws<SchemaError>(() => r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["discriminator"] = "kind",
            ["types"] = new Dictionary<string, object?>
            {
                ["Foo"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["kind"] = new Dictionary<string, object?> { ["type"] = "string" },
                    }
                }
            },
        }));
    }

    [Fact]
    public void InheritanceResolved()
    {
        var (_, schema) = TestHelpers.AnimalRegistry();
        Assert.Same(schema.Types["Animal"], schema.Types["Dog"].Supertype);
    }

    [Fact]
    public void CycleDetection()
    {
        var r = new Registry();
        Assert.Throws<SchemaError>(() => r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["A"] = new Dictionary<string, object?> { ["extends"] = "B" },
                ["B"] = new Dictionary<string, object?> { ["extends"] = "A" },
            },
        }));
    }

    [Fact]
    public void PropertyRedeclarationForbidden()
    {
        var r = new Registry();
        Assert.Throws<SchemaError>(() => r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Base"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["name"] = new Dictionary<string, object?> { ["type"] = "string" },
                    }
                },
                ["Child"] = new Dictionary<string, object?>
                {
                    ["extends"] = "Base",
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["name"] = new Dictionary<string, object?> { ["type"] = "string" },
                    }
                }
            },
        }));
    }

    [Fact]
    public void RequiredReferencesOwnProperty()
    {
        var r = new Registry();
        Assert.Throws<SchemaError>(() => r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Base"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["name"] = new Dictionary<string, object?> { ["type"] = "string" },
                    },
                    ["required"] = new List<object?> { "name" },
                },
                ["Child"] = new Dictionary<string, object?>
                {
                    ["extends"] = "Base",
                    ["required"] = new List<object?> { "name" },
                }
            },
        }));
    }

    [Fact]
    public void DuplicateDiscriminatorValue()
    {
        var r = new Registry();
        Assert.Throws<SchemaError>(() => r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["A"] = new Dictionary<string, object?> { ["discriminatorValue"] = "shared" },
                ["B"] = new Dictionary<string, object?> { ["discriminatorValue"] = "shared" },
            },
        }));
    }

    [Fact]
    public void IdempotentReload()
    {
        var r = new Registry();
        var s1 = r.LoadDict(TestHelpers.MinimalSchema());
        var s2 = r.LoadDict(TestHelpers.MinimalSchema());
        Assert.Same(s1, s2);
    }

    [Fact]
    public void MutuallyExclusiveMinimum()
    {
        var r = new Registry();
        Assert.Throws<SchemaError>(() => r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Foo"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["n"] = new Dictionary<string, object?>
                        {
                            ["type"] = "integer",
                            ["minimum"] = 0,
                            ["exclusiveMinimum"] = 0,
                        },
                    },
                },
            },
        }));
    }

    [Fact]
    public void NestedArrayForbidden()
    {
        var r = new Registry();
        Assert.Throws<SchemaError>(() => r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Foo"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["matrix"] = new Dictionary<string, object?>
                        {
                            ["type"] = "array",
                            ["items"] = new Dictionary<string, object?>
                            {
                                ["type"] = "array",
                                ["items"] = new Dictionary<string, object?> { ["type"] = "integer" },
                            },
                        }
                    }
                }
            },
        }));
    }

    [Fact]
    public void PropertyTypeRefToUnknownTypeFailsAtLoadTime()
    {
        var r = new Registry();
        Assert.Throws<SchemaError>(() => r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "https://example.org/schemas/test-unknown",
            ["types"] = new Dictionary<string, object?>
            {
                ["Owner"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["pet"] = new Dictionary<string, object?> { ["type"] = "GhostType" },
                    },
                },
            },
        }));
    }

    [Fact]
    public void PropertyTypeRefToUnknownTypeInImportFailsAtLoadTime()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "https://example.org/schemas/lib",
            ["types"] = new Dictionary<string, object?>
            {
                ["RealType"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?> { ["x"] = new Dictionary<string, object?> { ["type"] = "integer" } },
                },
            },
        });

        Assert.Throws<SchemaError>(() => r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "https://example.org/schemas/consumer",
            ["$imports"] = new Dictionary<string, object?> { ["lib"] = "https://example.org/schemas/lib" },
            ["types"] = new Dictionary<string, object?>
            {
                ["Consumer"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["item"] = new Dictionary<string, object?> { ["type"] = "lib.GhostType" },
                    },
                },
            },
        }));
    }
}
