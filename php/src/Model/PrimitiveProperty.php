<?php

declare(strict_types=1);

namespace Oojs\Model;

/**
 * A property whose value is one of the JSON primitive types:
 * string, integer, number, boolean, null.
 */
class PrimitiveProperty implements PropertyDef
{
    /**
     * @param string          $kind             One of: string, integer, number, boolean, null
     * @param string          $title
     * @param string          $description
     * @param int|null        $minLength        String: minimum length (Unicode code points)
     * @param int|null        $maxLength        String: maximum length (Unicode code points)
     * @param string|null     $pattern          String: ECMA regex pattern
     * @param string|null     $format           String: informational format hint (not enforced v1.0)
     * @param float|null      $minimum          Numeric: inclusive minimum
     * @param float|null      $maximum          Numeric: inclusive maximum
     * @param float|null      $exclusiveMinimum Numeric: exclusive minimum
     * @param float|null      $exclusiveMaximum Numeric: exclusive maximum
     * @param float|null      $multipleOf       Numeric: divisor constraint (> 0)
     * @param list<mixed>|null $enum            Allowed values enumeration
     */
    public function __construct(
        public readonly string $kind,
        public readonly string $title = '',
        public readonly string $description = '',
        public readonly ?int $minLength = null,
        public readonly ?int $maxLength = null,
        public readonly ?string $pattern = null,
        public readonly ?string $format = null,
        public readonly ?float $minimum = null,
        public readonly ?float $maximum = null,
        public readonly ?float $exclusiveMinimum = null,
        public readonly ?float $exclusiveMaximum = null,
        public readonly ?float $multipleOf = null,
        public readonly ?array $enum = null,
    ) {}
}
