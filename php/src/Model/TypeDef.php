<?php

declare(strict_types=1);

namespace Oojs\Model;

/**
 * An OOJS type definition.
 *
 * Immutable fields are set via the constructor.
 * Mutable fields (ownProperties, ownRequired, supertype) are populated by the
 * Registry during loading and should not be modified afterwards.
 */
class TypeDef
{
    /** @var array<string, PropertyDef> Own (non-inherited) properties */
    public array $ownProperties = [];

    /** @var list<string> Own (non-inherited) required property names */
    public array $ownRequired = [];

    /** Resolved supertype, set by Registry during hierarchy resolution. */
    public ?TypeDef $supertype = null;

    public function __construct(
        public readonly string $name,
        public readonly string $schemaId,
        public readonly bool $abstract = false,
        public readonly ?string $extends = null,
        public readonly ?string $discriminatorValue = null,
        public readonly string $title = '',
        public readonly string $description = '',
    ) {}

    /**
     * The discriminator value used in instances.
     * Falls back to the type name if no override is declared.
     */
    public function getEffectiveDiscriminatorValue(): string
    {
        return $this->discriminatorValue ?? $this->name;
    }

    /**
     * Union of all required property names in the inheritance chain,
     * from root to self (ancestor-first order).
     *
     * @return list<string>
     */
    public function effectiveRequired(): array
    {
        if ($this->supertype === null) {
            return $this->ownRequired;
        }
        return array_merge($this->supertype->effectiveRequired(), $this->ownRequired);
    }

    /**
     * Merged property map from the full inheritance chain.
     * Child properties shadow ancestor properties with the same name (though
     * redeclaration is forbidden at load time, so no shadowing occurs in
     * valid schemas).
     *
     * @return array<string, PropertyDef>
     */
    public function effectiveProperties(): array
    {
        if ($this->supertype === null) {
            return $this->ownProperties;
        }
        return array_merge($this->supertype->effectiveProperties(), $this->ownProperties);
    }

    /**
     * Returns true if $this equals $other or $this descends from $other.
     */
    public function isSubtypeOf(TypeDef $other): bool
    {
        $current = $this;
        while ($current !== null) {
            if ($current === $other) {
                return true;
            }
            $current = $current->supertype;
        }
        return false;
    }
}
