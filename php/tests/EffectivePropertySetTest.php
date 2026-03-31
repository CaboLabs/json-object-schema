<?php

declare(strict_types=1);

namespace Oojs\Tests;

use PHPUnit\Framework\TestCase;

/**
 * §9.5 — Effective property set (effectiveProperties / effectiveRequired).
 */
class EffectivePropertySetTest extends TestCase
{
    use TestHelpers;

    public function test_inherits_parent_properties(): void
    {
        [$r, $schema] = self::animalRegistry();
        $eff = $schema->types['Dog']->effectiveProperties();
        $this->assertArrayHasKey('name', $eff);   // from Animal
        $this->assertArrayHasKey('age', $eff);    // from Animal
        $this->assertArrayHasKey('breed', $eff);  // own
    }

    public function test_effective_required_union(): void
    {
        [$r, $schema] = self::animalRegistry();
        $req = $schema->types['Dog']->effectiveRequired();
        $this->assertContains('name', $req);   // inherited
        $this->assertContains('breed', $req);  // own
    }
}
