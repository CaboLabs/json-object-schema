<?php

declare(strict_types=1);

namespace Oojs\Model;

/**
 * An OOJS schema document (one per $id).
 *
 * Immutable metadata is set via the constructor.
 * Mutable collections (imports, types) are populated by the Registry.
 */
class Schema
{
    /** @var array<string, string> alias → schema $id */
    public array $imports = [];

    /** @var array<string, TypeDef> type name → TypeDef */
    public array $types = [];

    public function __construct(
        public readonly string $oojsVersion,
        public readonly string $schemaId,
        public readonly string $title = '',
        public readonly string $description = '',
        public readonly string $discriminator = '_type',
        public readonly bool $closedWorld = true,
    ) {}
}
