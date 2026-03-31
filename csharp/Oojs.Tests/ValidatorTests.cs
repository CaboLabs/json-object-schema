using System.Text.Json;
using Oojs;
using Xunit;

namespace Oojs.Tests;

public sealed class ValidatorTests
{
    private sealed class DummyProperty : PropertyDef { }

    [Fact]
    public void ValidationErrorToString()
    {
        var err = new ValidationError("/x", ErrorCode.MISSING_REQUIRED, "missing");
        Assert.Equal("/x: [MISSING_REQUIRED] missing", err.ToString());
    }

    [Fact]
    public void ValidateJsonInvalidJsonThrows()
    {
        var (r, schema) = TestHelpers.AnimalRegistry();
        var validator = new Validator(r);
        Assert.Throws<JsonException>(() => validator.ValidateJson("{", "Dog", schema));
    }

    [Fact]
    public void ValidateJsonUnknownTypeThrows()
    {
        var (r, schema) = TestHelpers.AnimalRegistry();
        var validator = new Validator(r);
        Assert.Throws<ArgumentException>(() => validator.ValidateJson("{\"_type\":\"Dog\"}", "Missing", schema));
    }

    [Fact]
    public void ValidateJsonSuccess()
    {
        var (r, schema) = TestHelpers.AnimalRegistry();
        var validator = new Validator(r);
        var errs = validator.ValidateJson("{\"_type\":\"Dog\",\"name\":\"Rex\",\"breed\":\"Lab\"}", "Dog", schema);
        Assert.Empty(errs);
    }

    [Fact]
    public void TypeRefMismatchReportsTypeMismatch()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "https://example.org/schemas/ref-mismatch",
            ["types"] = new Dictionary<string, object?>
            {
                ["Parent"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["child"] = new Dictionary<string, object?> { ["type"] = "Child" },
                    },
                    ["required"] = new List<object?> { "child" },
                },
                ["Child"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["name"] = new Dictionary<string, object?> { ["type"] = "string" },
                    },
                    ["required"] = new List<object?> { "name" },
                },
            },
        });
        var schema = r.GetSchema("https://example.org/schemas/ref-mismatch")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Parent", ["child"] = "nope" },
            schema.Types["Parent"],
            schema,
            r
        );

        Assert.True(TestHelpers.HasCode(errs, ErrorCode.TYPE_MISMATCH));
    }

    [Fact]
    public void TypeRefUnknownTypeReportsUnknownType()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "https://example.org/schemas/ref-unknown",
            ["types"] = new Dictionary<string, object?>
            {
                ["Parent"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["child"] = new Dictionary<string, object?> { ["type"] = "MissingType" },
                    },
                    ["required"] = new List<object?> { "child" },
                },
            },
        });
        var schema = r.GetSchema("https://example.org/schemas/ref-unknown")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Parent", ["child"] = new Dictionary<string, object?>() },
            schema.Types["Parent"],
            schema,
            r
        );

        Assert.True(TestHelpers.HasCode(errs, ErrorCode.UNKNOWN_TYPE));
    }

    [Fact]
    public void TypeRefViaImportsValidates()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "https://example.org/schemas/other",
            ["types"] = new Dictionary<string, object?>
            {
                ["Pet"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["name"] = new Dictionary<string, object?> { ["type"] = "string" },
                    },
                    ["required"] = new List<object?> { "name" },
                },
            },
        });
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "https://example.org/schemas/owner",
            ["imports"] = new Dictionary<string, object?> { ["other"] = "https://example.org/schemas/other" },
            ["types"] = new Dictionary<string, object?>
            {
                ["Owner"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["pet"] = new Dictionary<string, object?> { ["type"] = "other.Pet" },
                    },
                    ["required"] = new List<object?> { "pet" },
                },
            },
        });
        var schema = r.GetSchema("https://example.org/schemas/owner")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?>
            {
                ["_type"] = "Owner",
                ["pet"] = new Dictionary<string, object?> { ["_type"] = "Pet", ["name"] = "Fido" },
            },
            schema.Types["Owner"],
            schema,
            r
        );

        Assert.Empty(errs);
    }

    [Fact]
    public void ReportsJsonTypeName()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "https://example.org/schemas/type-name",
            ["types"] = new Dictionary<string, object?>
            {
                ["Person"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["age"] = new Dictionary<string, object?> { ["type"] = "integer" },
                    },
                    ["required"] = new List<object?> { "age" },
                },
            },
        });
        var schema = r.GetSchema("https://example.org/schemas/type-name")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Person", ["age"] = new List<object?> { "oops" } },
            schema.Types["Person"],
            schema,
            r
        );

        Assert.Contains(errs, e => e.Code == ErrorCode.TYPE_MISMATCH && e.Message.Contains("got array"));
    }

    [Fact]
    public void UniqueItemsCanonicalizesObjectKeys()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "https://example.org/schemas/uniq-obj",
            ["additionalProperties"] = true,
            ["types"] = new Dictionary<string, object?>
            {
                ["Obj"] = new Dictionary<string, object?>(),
                ["Arr"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["v"] = new Dictionary<string, object?>
                        {
                            ["type"] = "array",
                            ["items"] = new Dictionary<string, object?> { ["type"] = "Obj" },
                            ["uniqueItems"] = true,
                        },
                    },
                    ["required"] = new List<object?> { "v" },
                },
            },
        });
        var schema = r.GetSchema("https://example.org/schemas/uniq-obj")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?>
            {
                ["_type"] = "Arr",
                ["v"] = new List<object?>
                {
                    new Dictionary<string, object?> { ["_type"] = "Obj", ["a"] = 1L, ["b"] = 2L },
                    new Dictionary<string, object?> { ["_type"] = "Obj", ["b"] = 2L, ["a"] = 1L },
                },
            },
            schema.Types["Arr"],
            schema,
            r
        );

        Assert.True(TestHelpers.HasCode(errs, ErrorCode.ARRAY_DUPLICATE_ITEMS));
    }

    [Fact]
    public void FailFastNonObjectInstance()
    {
        var (r, schema) = TestHelpers.AnimalRegistry();
        var errs = ValidatorUtil.Validate("nope", schema.Types["Animal"], schema, r, failFast: true);
        Assert.Single(errs);
        Assert.Equal(ErrorCode.TYPE_MISMATCH, errs[0].Code);
    }

    [Fact]
    public void FailFastAdditionalProperty()
    {
        var (r, schema) = TestHelpers.AnimalRegistry();
        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?>
            {
                ["_type"] = "Dog",
                ["name"] = "Rex",
                ["breed"] = "Lab",
                ["color"] = "black",
            },
            schema.Types["Dog"],
            schema,
            r,
            failFast: true
        );

        Assert.Single(errs);
        Assert.Equal(ErrorCode.ADDITIONAL_PROPERTY, errs[0].Code);
    }

    [Fact]
    public void FailFastArrayMinItems()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Arr"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["v"] = new Dictionary<string, object?>
                        {
                            ["type"] = "array",
                            ["items"] = new Dictionary<string, object?> { ["type"] = "string" },
                            ["minItems"] = 2,
                        },
                    },
                },
            },
        });
        var schema = r.GetSchema("x")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?>
            {
                ["_type"] = "Arr",
                ["v"] = new List<object?> { "a" },
            },
            schema.Types["Arr"],
            schema,
            r,
            failFast: true
        );

        Assert.Single(errs);
        Assert.Equal(ErrorCode.ARRAY_TOO_SHORT, errs[0].Code);
    }

    [Fact]
    public void FailFastArrayMaxItems()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Arr"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["v"] = new Dictionary<string, object?>
                        {
                            ["type"] = "array",
                            ["items"] = new Dictionary<string, object?> { ["type"] = "string" },
                            ["maxItems"] = 1,
                        },
                    },
                },
            },
        });
        var schema = r.GetSchema("x")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?>
            {
                ["_type"] = "Arr",
                ["v"] = new List<object?> { "a", "b" },
            },
            schema.Types["Arr"],
            schema,
            r,
            failFast: true
        );

        Assert.Single(errs);
        Assert.Equal(ErrorCode.ARRAY_TOO_LONG, errs[0].Code);
    }

    [Fact]
    public void FailFastArrayUniqueItems()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Arr"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["v"] = new Dictionary<string, object?>
                        {
                            ["type"] = "array",
                            ["items"] = new Dictionary<string, object?> { ["type"] = "string" },
                            ["uniqueItems"] = true,
                        },
                    },
                },
            },
        });
        var schema = r.GetSchema("x")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?>
            {
                ["_type"] = "Arr",
                ["v"] = new List<object?> { "a", "a" },
            },
            schema.Types["Arr"],
            schema,
            r,
            failFast: true
        );

        Assert.Single(errs);
        Assert.Equal(ErrorCode.ARRAY_DUPLICATE_ITEMS, errs[0].Code);
    }

    [Fact]
    public void FailFastArrayItemValidation()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Arr"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["v"] = new Dictionary<string, object?>
                        {
                            ["type"] = "array",
                            ["items"] = new Dictionary<string, object?> { ["type"] = "string" },
                        },
                    },
                },
            },
        });
        var schema = r.GetSchema("x")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?>
            {
                ["_type"] = "Arr",
                ["v"] = new List<object?> { 123L },
            },
            schema.Types["Arr"],
            schema,
            r,
            failFast: true
        );

        Assert.Single(errs);
        Assert.Equal(ErrorCode.TYPE_MISMATCH, errs[0].Code);
    }

    [Fact]
    public void FailFastIntegerFraction()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Num"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["n"] = new Dictionary<string, object?> { ["type"] = "integer" },
                    },
                },
            },
        });
        var schema = r.GetSchema("x")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Num", ["n"] = 3.5 },
            schema.Types["Num"],
            schema,
            r,
            failFast: true
        );

        Assert.Single(errs);
        Assert.Equal(ErrorCode.NOT_INTEGER, errs[0].Code);
    }

    [Fact]
    public void FailFastStringMinLength()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Str"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["s"] = new Dictionary<string, object?> { ["type"] = "string", ["minLength"] = 2 },
                    },
                },
            },
        });
        var schema = r.GetSchema("x")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Str", ["s"] = "a" },
            schema.Types["Str"],
            schema,
            r,
            failFast: true
        );

        Assert.Single(errs);
        Assert.Equal(ErrorCode.STRING_TOO_SHORT, errs[0].Code);
    }

    [Fact]
    public void FailFastStringMaxLength()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Str"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["s"] = new Dictionary<string, object?> { ["type"] = "string", ["maxLength"] = 2 },
                    },
                },
            },
        });
        var schema = r.GetSchema("x")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Str", ["s"] = "toolong" },
            schema.Types["Str"],
            schema,
            r,
            failFast: true
        );

        Assert.Single(errs);
        Assert.Equal(ErrorCode.STRING_TOO_LONG, errs[0].Code);
    }

    [Fact]
    public void FailFastStringInvalidPattern()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Str"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["s"] = new Dictionary<string, object?> { ["type"] = "string", ["pattern"] = "(" },
                    },
                },
            },
        });
        var schema = r.GetSchema("x")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Str", ["s"] = "a" },
            schema.Types["Str"],
            schema,
            r,
            failFast: true
        );

        Assert.Single(errs);
        Assert.Equal(ErrorCode.PATTERN_MISMATCH, errs[0].Code);
    }

    [Fact]
    public void FailFastStringPatternMismatch()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Str"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["s"] = new Dictionary<string, object?> { ["type"] = "string", ["pattern"] = "^a+$" },
                    },
                },
            },
        });
        var schema = r.GetSchema("x")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Str", ["s"] = "b" },
            schema.Types["Str"],
            schema,
            r,
            failFast: true
        );

        Assert.Single(errs);
        Assert.Equal(ErrorCode.PATTERN_MISMATCH, errs[0].Code);
    }

    [Fact]
    public void FailFastStringEnumMismatch()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Str"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["s"] = new Dictionary<string, object?> { ["type"] = "string", ["enum"] = new List<object?> { "a" } },
                    },
                },
            },
        });
        var schema = r.GetSchema("x")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Str", ["s"] = "b" },
            schema.Types["Str"],
            schema,
            r,
            failFast: true
        );

        Assert.Single(errs);
        Assert.Equal(ErrorCode.ENUM_MISMATCH, errs[0].Code);
    }

    [Fact]
    public void FailFastNumberMinimum()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Num"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["n"] = new Dictionary<string, object?> { ["type"] = "number", ["minimum"] = 0 },
                    },
                },
            },
        });
        var schema = r.GetSchema("x")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Num", ["n"] = -1L },
            schema.Types["Num"],
            schema,
            r,
            failFast: true
        );

        Assert.Single(errs);
        Assert.Equal(ErrorCode.BELOW_MINIMUM, errs[0].Code);
    }

    [Fact]
    public void FailFastNumberMaximum()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Num"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["n"] = new Dictionary<string, object?> { ["type"] = "number", ["maximum"] = 1 },
                    },
                },
            },
        });
        var schema = r.GetSchema("x")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Num", ["n"] = 2L },
            schema.Types["Num"],
            schema,
            r,
            failFast: true
        );

        Assert.Single(errs);
        Assert.Equal(ErrorCode.ABOVE_MAXIMUM, errs[0].Code);
    }

    [Fact]
    public void FailFastNumberExclusiveMinimum()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Num"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["n"] = new Dictionary<string, object?> { ["type"] = "number", ["exclusiveMinimum"] = 0 },
                    },
                },
            },
        });
        var schema = r.GetSchema("x")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Num", ["n"] = 0L },
            schema.Types["Num"],
            schema,
            r,
            failFast: true
        );

        Assert.Single(errs);
        Assert.Equal(ErrorCode.BELOW_EXCLUSIVE_MINIMUM, errs[0].Code);
    }

    [Fact]
    public void FailFastNumberExclusiveMaximum()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Num"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["n"] = new Dictionary<string, object?> { ["type"] = "number", ["exclusiveMaximum"] = 1 },
                    },
                },
            },
        });
        var schema = r.GetSchema("x")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Num", ["n"] = 1L },
            schema.Types["Num"],
            schema,
            r,
            failFast: true
        );

        Assert.Single(errs);
        Assert.Equal(ErrorCode.ABOVE_EXCLUSIVE_MAXIMUM, errs[0].Code);
    }

    [Fact]
    public void FailFastNumberMultipleOf()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Num"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["n"] = new Dictionary<string, object?> { ["type"] = "number", ["multipleOf"] = 2 },
                    },
                },
            },
        });
        var schema = r.GetSchema("x")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Num", ["n"] = 3L },
            schema.Types["Num"],
            schema,
            r,
            failFast: true
        );

        Assert.Single(errs);
        Assert.Equal(ErrorCode.NOT_MULTIPLE_OF, errs[0].Code);
    }

    [Fact]
    public void FailFastNumberEnumMismatch()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Num"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["n"] = new Dictionary<string, object?> { ["type"] = "number", ["enum"] = new List<object?> { 1L, 2L } },
                    },
                },
            },
        });
        var schema = r.GetSchema("x")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Num", ["n"] = 3L },
            schema.Types["Num"],
            schema,
            r,
            failFast: true
        );

        Assert.Single(errs);
        Assert.Equal(ErrorCode.ENUM_MISMATCH, errs[0].Code);
    }

    [Fact]
    public void UnknownPropertyKindIsIgnored()
    {
        var (r, schema) = TestHelpers.AnimalRegistry();
        schema.Types["Dog"].OwnProperties["mystery"] = new DummyProperty();

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?>
            {
                ["_type"] = "Dog",
                ["name"] = "Rex",
                ["breed"] = "Lab",
                ["mystery"] = "x",
            },
            schema.Types["Dog"],
            schema,
            r
        );

        Assert.Empty(errs);
    }

    [Fact]
    public void JsonKindMatchesNullAndBoolean()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Foo"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["n"] = new Dictionary<string, object?> { ["type"] = "null" },
                        ["b"] = new Dictionary<string, object?> { ["type"] = "boolean" },
                    },
                    ["required"] = new List<object?> { "n", "b" },
                },
            },
        });
        var schema = r.GetSchema("x")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Foo", ["n"] = null, ["b"] = true },
            schema.Types["Foo"],
            schema,
            r
        );

        Assert.Empty(errs);
    }

    [Fact]
    public void JsonTypeNameBranches()
    {
        var r = new Registry();
        r.LoadDict(new Dictionary<string, object?>
        {
            ["$oojs"] = "1.0",
            ["$id"] = "x",
            ["types"] = new Dictionary<string, object?>
            {
                ["Str"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["v"] = new Dictionary<string, object?> { ["type"] = "string" },
                    },
                },
                ["Int"] = new Dictionary<string, object?>
                {
                    ["properties"] = new Dictionary<string, object?>
                    {
                        ["v"] = new Dictionary<string, object?> { ["type"] = "integer" },
                    },
                },
            },
        });
        var schema = r.GetSchema("x")!;

        var errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Str", ["v"] = null },
            schema.Types["Str"],
            schema,
            r
        );
        Assert.Contains(errs, e => e.Code == ErrorCode.TYPE_MISMATCH && e.Message.Contains("got null"));

        errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Str", ["v"] = true },
            schema.Types["Str"],
            schema,
            r
        );
        Assert.Contains(errs, e => e.Code == ErrorCode.TYPE_MISMATCH && e.Message.Contains("got boolean"));

        errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Str", ["v"] = 1.5 },
            schema.Types["Str"],
            schema,
            r
        );
        Assert.Contains(errs, e => e.Code == ErrorCode.TYPE_MISMATCH && e.Message.Contains("got number"));

        errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Int", ["v"] = "abc" },
            schema.Types["Int"],
            schema,
            r
        );
        Assert.Contains(errs, e => e.Code == ErrorCode.TYPE_MISMATCH && e.Message.Contains("got string"));

        errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Str", ["v"] = new object() },
            schema.Types["Str"],
            schema,
            r
        );
        Assert.Contains(errs, e => e.Code == ErrorCode.TYPE_MISMATCH && e.Message.Contains("got Object"));

        errs = ValidatorUtil.Validate(
            new Dictionary<string, object?> { ["_type"] = "Str", ["v"] = new List<object?> { "x" } },
            schema.Types["Str"],
            schema,
            r
        );
        Assert.Contains(errs, e => e.Code == ErrorCode.TYPE_MISMATCH && e.Message.Contains("got array"));
    }
}
