<?php

declare(strict_types=1);

namespace Oojs\Tests;

use Oojs\Registry;
use PHPUnit\Framework\TestCase;

/**
 * §9.4 — Subtype check (isSubtypeOf).
 */
class SubtypeCheckTest extends TestCase
{
    use TestHelpers;

    public function test_direct_subtype(): void
    {
        [$r, $schema] = self::animalRegistry();
        $this->assertTrue($schema->types['Dog']->isSubtypeOf($schema->types['Animal']));
    }

    public function test_same_type(): void
    {
        [$r, $schema] = self::animalRegistry();
        $this->assertTrue($schema->types['Dog']->isSubtypeOf($schema->types['Dog']));
    }

    public function test_not_subtype(): void
    {
        [$r, $schema] = self::animalRegistry();
        $this->assertFalse($schema->types['Cat']->isSubtypeOf($schema->types['Dog']));
    }

    public function test_transitive(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/deep',
            'types' => [
                'A' => ['abstract' => true],
                'B' => ['extends' => 'A'],
                'C' => ['extends' => 'B'],
                'D' => ['extends' => 'C'],
            ],
        ]);
        $schema = $r->getSchema('https://example.org/schemas/deep');
        $this->assertTrue($schema->types['D']->isSubtypeOf($schema->types['A']));
    }
}
