<?php

declare(strict_types=1);

namespace Oojs\Model;

/**
 * A property whose value is an object conforming to another named type.
 * The type name is either unqualified ("TypeName") or qualified ("alias.TypeName").
 *
 * $resolvedType is populated by the Registry during the eager type-reference
 * resolution pass (§10.2 step 5 / Appendix A.3). It is null only between
 * initial parsing and resolution; after a successful schema load it is always set.
 */
class TypeRefProperty implements PropertyDef
{
    /** Resolved at load time by Registry. Never null after successful schema load. */
    public ?TypeDef $resolvedType = null;

    public function __construct(
        public readonly string $typeName,
        public readonly string $title = '',
        public readonly string $description = '',
    ) {}
}
