namespace Oojs;

public static class ErrorCode
{
    public const string MISSING_DISCRIMINATOR = "MISSING_DISCRIMINATOR";
    public const string INVALID_DISCRIMINATOR_TYPE = "INVALID_DISCRIMINATOR_TYPE";
    public const string UNKNOWN_TYPE = "UNKNOWN_TYPE";
    public const string ABSTRACT_TYPE = "ABSTRACT_TYPE";
    public const string TYPE_MISMATCH = "TYPE_MISMATCH";

    public const string MISSING_REQUIRED = "MISSING_REQUIRED";
    public const string ADDITIONAL_PROPERTY = "ADDITIONAL_PROPERTY";

    public const string STRING_TOO_SHORT = "STRING_TOO_SHORT";
    public const string STRING_TOO_LONG = "STRING_TOO_LONG";
    public const string PATTERN_MISMATCH = "PATTERN_MISMATCH";
    public const string ENUM_MISMATCH = "ENUM_MISMATCH";

    public const string BELOW_MINIMUM = "BELOW_MINIMUM";
    public const string ABOVE_MAXIMUM = "ABOVE_MAXIMUM";
    public const string BELOW_EXCLUSIVE_MINIMUM = "BELOW_EXCLUSIVE_MINIMUM";
    public const string ABOVE_EXCLUSIVE_MAXIMUM = "ABOVE_EXCLUSIVE_MAXIMUM";
    public const string NOT_MULTIPLE_OF = "NOT_MULTIPLE_OF";
    public const string NOT_INTEGER = "NOT_INTEGER";

    public const string ARRAY_TOO_SHORT = "ARRAY_TOO_SHORT";
    public const string ARRAY_TOO_LONG = "ARRAY_TOO_LONG";
    public const string ARRAY_DUPLICATE_ITEMS = "ARRAY_DUPLICATE_ITEMS";
}
