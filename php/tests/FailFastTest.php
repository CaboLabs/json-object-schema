<?php

declare(strict_types=1);

namespace Oojs\Tests;

use PHPUnit\Framework\TestCase;

use function Oojs\validate;

/**
 * §9.6 — Fail-fast mode.
 */
class FailFastTest extends TestCase
{
    use TestHelpers;

    public function test_fail_fast_returns_single_error(): void
    {
        [$r, $schema] = self::animalRegistry();
        $instance = ['_type' => 'Dog']; // missing name and breed
        $errs = validate($instance, $schema->types['Animal'], $schema, $r, failFast: true);
        $this->assertCount(1, $errs);
    }

    public function test_full_mode_returns_all_errors(): void
    {
        [$r, $schema] = self::animalRegistry();
        $instance = ['_type' => 'Dog']; // missing name and breed → ≥2 required errors
        $errs = validate($instance, $schema->types['Animal'], $schema, $r, failFast: false);
        $this->assertGreaterThanOrEqual(2, count($errs));
    }
}
