<?php

declare(strict_types=1);

namespace Oojs\Model;

/**
 * A property whose value is a JSON array with homogeneous items.
 * Nested arrays are not supported in v1.0.
 */
class ArrayProperty implements PropertyDef
{
    public function __construct(
        public readonly PropertyDef $items,
        public readonly int $minItems = 0,
        public readonly ?int $maxItems = null,
        public readonly bool $uniqueItems = false,
        public readonly string $title = '',
        public readonly string $description = '',
    ) {}
}
