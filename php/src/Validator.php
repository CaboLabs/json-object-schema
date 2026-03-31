<?php

declare(strict_types=1);

namespace Oojs;

use Oojs\Model\ArrayProperty;
use Oojs\Model\PrimitiveProperty;
use Oojs\Model\Schema;
use Oojs\Model\TypeDef;
use Oojs\Model\TypeRefProperty;

/**
 * Stateful OOJS instance validator (§9 of the spec).
 *
 * A single Validator instance can be reused for many validation calls.
 *
 * Usage:
 *   $registry = new Registry();
 *   $schema   = $registry->loadFile('clinical.oojs.json');
 *   $typedef  = $schema->types['Observation'];
 *   $result   = (new Validator($registry))->validate($instance, $typedef, $schema);
 *   // or use the module-level convenience function:
 *   $result = validate($instance, $typedef, $schema, $registry);
 */
class Validator
{
    public function __construct(
        private readonly Registry $registry,
        private readonly bool $failFast = false,
    ) {}

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    /**
     * Validate $instance as $targetType.
     *
     * @param  mixed               $instance
     * @return list<ValidationError>
     */
    public function validate(mixed $instance, TypeDef $targetType, Schema $schema): array
    {
        $errors = [];
        $this->validateInstance($instance, $targetType, $schema, '/', $errors);
        return $errors;
    }

    /**
     * Parse $text as JSON, look up $targetTypeName, then validate.
     *
     * @return list<ValidationError>
     * @throws \InvalidArgumentException if the type name is not found in the schema
     */
    public function validateJson(string $text, string $targetTypeName, Schema $schema): array
    {
        try {
            $instance = json_decode($text, associative: true, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new \InvalidArgumentException("Invalid JSON: {$e->getMessage()}");
        }
        $typedef = $schema->types[$targetTypeName] ?? null;
        if ($typedef === null) {
            throw new \InvalidArgumentException(
                "Type '$targetTypeName' not found in schema '{$schema->schemaId}'"
            );
        }
        return $this->validate($instance, $typedef, $schema);
    }

    // ------------------------------------------------------------------
    // Phase 1–4  (§9.2)
    // ------------------------------------------------------------------

    /**
     * @param  list<ValidationError> $errors
     */
    private function validateInstance(
        mixed $instance,
        TypeDef $target,
        Schema $schema,
        string $path,
        array &$errors,
    ): bool {
        if (!is_array($instance)) {
            $errors[] = new ValidationError($path, ErrorCode::TYPE_MISMATCH, 'expected a JSON object');
            return !$this->failFast;
        }

        // -- Phase 1: discriminator resolution ----------------------------
        $discName = $schema->discriminator;
        if (!array_key_exists($discName, $instance)) {
            $errors[] = new ValidationError(
                $path,
                ErrorCode::MISSING_DISCRIMINATOR,
                "missing discriminator property '$discName'",
            );
            return !$this->failFast;
        }

        $discVal = $instance[$discName];
        if (!is_string($discVal)) {
            $errors[] = new ValidationError(
                "$path/$discName",
                ErrorCode::INVALID_DISCRIMINATOR_TYPE,
                "discriminator property '$discName' must be a string",
            );
            return !$this->failFast;
        }

        $concrete = $this->registry->lookupByDiscriminatorValue($discVal);
        if ($concrete === null) {
            $errors[] = new ValidationError(
                "$path/$discName",
                ErrorCode::UNKNOWN_TYPE,
                "unknown type '$discVal'",
            );
            return !$this->failFast;
        }

        if ($concrete->abstract) {
            $errors[] = new ValidationError(
                "$path/$discName",
                ErrorCode::ABSTRACT_TYPE,
                "type '$discVal' is abstract and cannot be instantiated",
            );
            return !$this->failFast;
        }

        if (!$concrete->isSubtypeOf($target)) {
            $errors[] = new ValidationError(
                "$path/$discName",
                ErrorCode::TYPE_MISMATCH,
                "type '$discVal' is not a subtype of '{$target->name}'",
            );
            return !$this->failFast;
        }

        // -- Phase 2: required properties ---------------------------------
        foreach ($concrete->effectiveRequired() as $reqName) {
            if (!array_key_exists($reqName, $instance)) {
                $errors[] = new ValidationError(
                    $path,
                    ErrorCode::MISSING_REQUIRED,
                    "missing required property '$reqName'",
                );
                if ($this->failFast) {
                    return false;
                }
            }
        }

        // -- Phase 3: property presence + validation ----------------------
        $effectiveProps = $concrete->effectiveProperties();
        foreach ($instance as $key => $value) {
            if ($key === $discName) {
                continue;
            }
            if (!array_key_exists($key, $effectiveProps)) {
                if ($schema->closedWorld) {
                    $errors[] = new ValidationError(
                        $path . '/' . self::escape((string)$key),
                        ErrorCode::ADDITIONAL_PROPERTY,
                        "unexpected additional property '$key'",
                    );
                    if ($this->failFast) {
                        return false;
                    }
                }
                continue;
            }
            $propDef = $effectiveProps[$key];
            $ok = $this->validateProperty($value, $propDef, $schema, $path . '/' . self::escape((string)$key), $errors);
            if (!$ok && $this->failFast) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param  list<ValidationError> $errors
     */
    private function validateProperty(
        mixed $value,
        object $prop,
        Schema $schema,
        string $path,
        array &$errors,
    ): bool {
        if ($prop instanceof ArrayProperty) {
            return $this->validateArray($value, $prop, $schema, $path, $errors);
        }
        if ($prop instanceof PrimitiveProperty) {
            return $this->validatePrimitive($value, $prop, $path, $errors);
        }
        if ($prop instanceof TypeRefProperty) {
            return $this->validateTypeRef($value, $prop, $schema, $path, $errors);
        }
        return true; // unknown property kind — ignore
    }

    // -- Array (§9.2 Phase 4, array branch) ------------------------------

    /**
     * @param  list<ValidationError> $errors
     */
    private function validateArray(
        mixed $value,
        ArrayProperty $prop,
        Schema $schema,
        string $path,
        array &$errors,
    ): bool {
        if (!is_array($value) || (!empty($value) && !array_is_list($value))) {
            $errors[] = new ValidationError($path, ErrorCode::TYPE_MISMATCH, 'expected an array');
            return !$this->failFast;
        }

        $count = count($value);

        if ($count < $prop->minItems) {
            $errors[] = new ValidationError(
                $path,
                ErrorCode::ARRAY_TOO_SHORT,
                "array has $count item(s), minimum is {$prop->minItems}",
            );
            if ($this->failFast) {
                return false;
            }
        }

        if ($prop->maxItems !== null && $count > $prop->maxItems) {
            $errors[] = new ValidationError(
                $path,
                ErrorCode::ARRAY_TOO_LONG,
                "array has $count item(s), maximum is {$prop->maxItems}",
            );
            if ($this->failFast) {
                return false;
            }
        }

        if ($prop->uniqueItems) {
            $seen = [];
            foreach ($value as $item) {
                $itemKey = self::serialiseForUniqueness($item);
                if (in_array($itemKey, $seen, strict: true)) {
                    $errors[] = new ValidationError(
                        $path,
                        ErrorCode::ARRAY_DUPLICATE_ITEMS,
                        'array items must be unique',
                    );
                    if ($this->failFast) {
                        return false;
                    }
                    break;
                }
                $seen[] = $itemKey;
            }
        }

        foreach ($value as $i => $item) {
            $ok = $this->validateProperty($item, $prop->items, $schema, "$path/$i", $errors);
            if (!$ok && $this->failFast) {
                return false;
            }
        }

        return true;
    }

    // -- Primitive (§9.3) ------------------------------------------------

    /**
     * @param  list<ValidationError> $errors
     */
    private function validatePrimitive(
        mixed $value,
        PrimitiveProperty $prop,
        string $path,
        array &$errors,
    ): bool {
        // JSON kind check
        if (!self::jsonKindMatches($value, $prop->kind)) {
            $errors[] = new ValidationError(
                $path,
                ErrorCode::TYPE_MISMATCH,
                "expected {$prop->kind}, got " . self::jsonTypeName($value),
            );
            return !$this->failFast;
        }

        // Integer fractional check
        if ($prop->kind === 'integer' && is_float($value) && $value !== (float)(int)$value) {
            $errors[] = new ValidationError(
                $path,
                ErrorCode::NOT_INTEGER,
                'value must be an integer (no fractional part)',
            );
            if ($this->failFast) {
                return false;
            }
        }

        if ($prop->kind === 'string') {
            // Use mb_strlen for Unicode code-point count (matches Python len())
            $length = mb_strlen($value, 'UTF-8');

            if ($prop->minLength !== null && $length < $prop->minLength) {
                $errors[] = new ValidationError(
                    $path,
                    ErrorCode::STRING_TOO_SHORT,
                    "string length $length < minLength {$prop->minLength}",
                );
                if ($this->failFast) {
                    return false;
                }
            }
            if ($prop->maxLength !== null && $length > $prop->maxLength) {
                $errors[] = new ValidationError(
                    $path,
                    ErrorCode::STRING_TOO_LONG,
                    "string length $length > maxLength {$prop->maxLength}",
                );
                if ($this->failFast) {
                    return false;
                }
            }
            if ($prop->pattern !== null) {
                $patternStr = '~' . str_replace('~', '\\~', $prop->pattern) . '~u';
                $result = @preg_match($patternStr, $value);
                if ($result === false) {
                    $errors[] = new ValidationError(
                        $path,
                        ErrorCode::PATTERN_MISMATCH,
                        "invalid pattern '{$prop->pattern}': " . preg_last_error_msg(),
                    );
                    if ($this->failFast) {
                        return false;
                    }
                } elseif ($result === 0) {
                    $errors[] = new ValidationError(
                        $path,
                        ErrorCode::PATTERN_MISMATCH,
                        "value does not match pattern '{$prop->pattern}'",
                    );
                    if ($this->failFast) {
                        return false;
                    }
                }
            }
            if ($prop->enum !== null && !in_array($value, $prop->enum)) {
                $errors[] = new ValidationError(
                    $path,
                    ErrorCode::ENUM_MISMATCH,
                    "value '$value' not in enum " . json_encode($prop->enum),
                );
                if ($this->failFast) {
                    return false;
                }
            }
        } elseif ($prop->kind === 'integer' || $prop->kind === 'number') {
            $num = (float)$value;

            if ($prop->minimum !== null && $num < $prop->minimum) {
                $errors[] = new ValidationError(
                    $path,
                    ErrorCode::BELOW_MINIMUM,
                    "value $value < minimum {$prop->minimum}",
                );
                if ($this->failFast) {
                    return false;
                }
            }
            if ($prop->maximum !== null && $num > $prop->maximum) {
                $errors[] = new ValidationError(
                    $path,
                    ErrorCode::ABOVE_MAXIMUM,
                    "value $value > maximum {$prop->maximum}",
                );
                if ($this->failFast) {
                    return false;
                }
            }
            if ($prop->exclusiveMinimum !== null && $num <= $prop->exclusiveMinimum) {
                $errors[] = new ValidationError(
                    $path,
                    ErrorCode::BELOW_EXCLUSIVE_MINIMUM,
                    "value $value must be > {$prop->exclusiveMinimum}",
                );
                if ($this->failFast) {
                    return false;
                }
            }
            if ($prop->exclusiveMaximum !== null && $num >= $prop->exclusiveMaximum) {
                $errors[] = new ValidationError(
                    $path,
                    ErrorCode::ABOVE_EXCLUSIVE_MAXIMUM,
                    "value $value must be < {$prop->exclusiveMaximum}",
                );
                if ($this->failFast) {
                    return false;
                }
            }
            if ($prop->multipleOf !== null) {
                // Floating-point safe: use round(), matching Python's round(x % m, 10)
                $remainder = fmod(abs($num), $prop->multipleOf);
                $rounded   = round($remainder, 10);
                if ($rounded != 0.0 && $rounded != $prop->multipleOf) {
                    $errors[] = new ValidationError(
                        $path,
                        ErrorCode::NOT_MULTIPLE_OF,
                        "value $value is not a multiple of {$prop->multipleOf}",
                    );
                    if ($this->failFast) {
                        return false;
                    }
                }
            }
            if ($prop->enum !== null && !in_array($value, $prop->enum)) {
                $errors[] = new ValidationError(
                    $path,
                    ErrorCode::ENUM_MISMATCH,
                    "value $value not in enum " . json_encode($prop->enum),
                );
                if ($this->failFast) {
                    return false;
                }
            }
        }

        return true;
    }

    // -- Type reference (§9.2 Phase 4, type-ref branch) ------------------

    /**
     * @param  list<ValidationError> $errors
     */
    private function validateTypeRef(
        mixed $value,
        TypeRefProperty $prop,
        Schema $schema,
        string $path,
        array &$errors,
    ): bool {
        if (!is_array($value)) {
            $errors[] = new ValidationError(
                $path,
                ErrorCode::TYPE_MISMATCH,
                'expected a JSON object for type reference',
            );
            return !$this->failFast;
        }

        // Resolve the type (handles both qualified and unqualified names)
        $refTypedef = $this->registry->resolveTypeIn($prop->typeName, $schema->schemaId);

        if ($refTypedef === null) {
            // Fallback: try qualified resolution through the schema's imports
            if (str_contains($prop->typeName, '.')) {
                [$alias, $name] = explode('.', $prop->typeName, 2);
                $importedId = $schema->imports[$alias] ?? null;
                if ($importedId !== null) {
                    $importedSchema = $this->registry->getSchema($importedId);
                    if ($importedSchema !== null) {
                        $refTypedef = $importedSchema->types[$name] ?? null;
                    }
                }
            }
        }

        if ($refTypedef === null) {
            $errors[] = new ValidationError(
                $path,
                ErrorCode::UNKNOWN_TYPE,
                "cannot resolve type '{$prop->typeName}'",
            );
            return !$this->failFast;
        }

        // Determine which schema governs the referenced type
        $refSchema = $this->registry->getSchema($refTypedef->schemaId) ?? $schema;
        return $this->validateInstance($value, $refTypedef, $refSchema, $path, $errors);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static function jsonKindMatches(mixed $value, string $kind): bool
    {
        return match ($kind) {
            'null'    => $value === null,
            'boolean' => is_bool($value),
            'string'  => is_string($value),
            // Booleans are not ints/floats in PHP, so no extra bool check needed
            'integer' => is_int($value) || is_float($value),
            'number'  => is_int($value) || is_float($value),
            default   => false,
        };
    }

    private static function jsonTypeName(mixed $value): string
    {
        if ($value === null) {
            return 'null';
        }
        if (is_bool($value)) {
            return 'boolean';
        }
        if (is_string($value)) {
            return 'string';
        }
        if (is_int($value)) {
            return 'integer';
        }
        if (is_float($value)) {
            return 'number';
        }
        if (is_array($value)) {
            return array_is_list($value) ? 'array' : 'object';
        }
        return get_debug_type($value);
    }

    /**
     * Escape a JSON Pointer token per RFC 6901 (~→~0, /→~1).
     */
    private static function escape(string $token): string
    {
        return str_replace(['~', '/'], ['~0', '~1'], $token);
    }

    /**
     * Produce a canonical JSON string for use in uniqueness comparisons.
     * Object keys are recursively sorted so that {"b":1,"a":2} == {"a":2,"b":1}.
     */
    private static function serialiseForUniqueness(mixed $value): string
    {
        return json_encode(self::sortKeysRecursive($value), JSON_THROW_ON_ERROR);
    }

    private static function sortKeysRecursive(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        if (array_is_list($value)) {
            return array_map([self::class, 'sortKeysRecursive'], $value);
        }
        ksort($value);
        return array_map([self::class, 'sortKeysRecursive'], $value);
    }
}

// ------------------------------------------------------------------
// Convenience function
// ------------------------------------------------------------------

/**
 * Convenience wrapper: create a Validator and validate in one call.
 *
 * @param  mixed             $instance
 * @return list<ValidationError>
 */
function validate(
    mixed $instance,
    TypeDef $targetType,
    Schema $schema,
    Registry $registry,
    bool $failFast = false,
): array {
    return (new Validator($registry, $failFast))->validate($instance, $targetType, $schema);
}
