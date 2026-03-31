package org.oojs;

/** String constants for all validation error codes. */
public final class ErrorCode {
    public static final String MISSING_DISCRIMINATOR      = "MISSING_DISCRIMINATOR";
    public static final String INVALID_DISCRIMINATOR_TYPE = "INVALID_DISCRIMINATOR_TYPE";
    public static final String UNKNOWN_TYPE               = "UNKNOWN_TYPE";
    public static final String ABSTRACT_TYPE              = "ABSTRACT_TYPE";
    public static final String TYPE_MISMATCH              = "TYPE_MISMATCH";
    public static final String MISSING_REQUIRED           = "MISSING_REQUIRED";
    public static final String ADDITIONAL_PROPERTY        = "ADDITIONAL_PROPERTY";
    public static final String STRING_TOO_SHORT           = "STRING_TOO_SHORT";
    public static final String STRING_TOO_LONG            = "STRING_TOO_LONG";
    public static final String PATTERN_MISMATCH           = "PATTERN_MISMATCH";
    public static final String ENUM_MISMATCH              = "ENUM_MISMATCH";
    public static final String BELOW_MINIMUM              = "BELOW_MINIMUM";
    public static final String ABOVE_MAXIMUM              = "ABOVE_MAXIMUM";
    public static final String BELOW_EXCLUSIVE_MINIMUM    = "BELOW_EXCLUSIVE_MINIMUM";
    public static final String ABOVE_EXCLUSIVE_MAXIMUM    = "ABOVE_EXCLUSIVE_MAXIMUM";
    public static final String NOT_MULTIPLE_OF            = "NOT_MULTIPLE_OF";
    public static final String NOT_INTEGER                = "NOT_INTEGER";
    public static final String ARRAY_TOO_SHORT            = "ARRAY_TOO_SHORT";
    public static final String ARRAY_TOO_LONG             = "ARRAY_TOO_LONG";
    public static final String ARRAY_DUPLICATE_ITEMS      = "ARRAY_DUPLICATE_ITEMS";

    private ErrorCode() {}
}
