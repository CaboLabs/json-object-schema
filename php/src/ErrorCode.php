<?php

declare(strict_types=1);

namespace Oojs;

/**
 * String constants for all validation error codes.
 */
final class ErrorCode
{
    // Discriminator errors
    public const MISSING_DISCRIMINATOR      = 'MISSING_DISCRIMINATOR';
    public const INVALID_DISCRIMINATOR_TYPE = 'INVALID_DISCRIMINATOR_TYPE';
    public const UNKNOWN_TYPE               = 'UNKNOWN_TYPE';
    public const ABSTRACT_TYPE              = 'ABSTRACT_TYPE';
    public const TYPE_MISMATCH              = 'TYPE_MISMATCH';

    // Required property errors
    public const MISSING_REQUIRED           = 'MISSING_REQUIRED';

    // Additional property errors
    public const ADDITIONAL_PROPERTY        = 'ADDITIONAL_PROPERTY';

    // String constraint errors
    public const STRING_TOO_SHORT           = 'STRING_TOO_SHORT';
    public const STRING_TOO_LONG            = 'STRING_TOO_LONG';
    public const PATTERN_MISMATCH           = 'PATTERN_MISMATCH';
    public const ENUM_MISMATCH              = 'ENUM_MISMATCH';

    // Numeric constraint errors
    public const BELOW_MINIMUM              = 'BELOW_MINIMUM';
    public const ABOVE_MAXIMUM              = 'ABOVE_MAXIMUM';
    public const BELOW_EXCLUSIVE_MINIMUM    = 'BELOW_EXCLUSIVE_MINIMUM';
    public const ABOVE_EXCLUSIVE_MAXIMUM    = 'ABOVE_EXCLUSIVE_MAXIMUM';
    public const NOT_MULTIPLE_OF            = 'NOT_MULTIPLE_OF';
    public const NOT_INTEGER                = 'NOT_INTEGER';

    // Array constraint errors
    public const ARRAY_TOO_SHORT            = 'ARRAY_TOO_SHORT';
    public const ARRAY_TOO_LONG             = 'ARRAY_TOO_LONG';
    public const ARRAY_DUPLICATE_ITEMS      = 'ARRAY_DUPLICATE_ITEMS';

    // Graph document errors (§8.12)
    public const UNRESOLVED_REFERENCE       = 'UNRESOLVED_REFERENCE';

    private function __construct() {}
}
