<?php

declare(strict_types=1);

namespace Oojs\Model;

/**
 * A property whose value is an object conforming to another named type.
 * The type name is either unqualified ("TypeName") or qualified ("alias.TypeName").
 */
class TypeRefProperty implements PropertyDef
{
    public function __construct(
        public readonly string $typeName,
        public readonly string $title = '',
        public readonly string $description = '',
    ) {}
}
