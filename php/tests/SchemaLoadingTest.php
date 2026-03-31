<?php

declare(strict_types=1);

namespace Oojs\Tests;

use Oojs\Registry;
use Oojs\SchemaError;
use PHPUnit\Framework\TestCase;

/**
 * §4, §5, §6, §10, §11 — Schema loading and structural validation.
 */
class SchemaLoadingTest extends TestCase
{
    use TestHelpers;

    public function test_minimal_valid_schema(): void
    {
        [$r, $schema] = self::animalRegistry();
        $this->assertNotNull($schema);
        $this->assertArrayHasKey('Animal', $schema->types);
        $this->assertArrayHasKey('Dog', $schema->types);
    }

    public function test_missing_oojs(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/\$oojs/');
        self::makeRegistry(['$id' => 'x', 'types' => ['A' => []]]);
    }

    public function test_wrong_version(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/unsupported/');
        self::makeRegistry(['$oojs' => '2.0', '$id' => 'x', 'types' => ['A' => []]]);
    }

    public function test_missing_id(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/\$id/');
        self::makeRegistry(['$oojs' => '1.0', 'types' => ['A' => []]]);
    }

    public function test_missing_types(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/types/');
        self::makeRegistry(['$oojs' => '1.0', '$id' => 'x']);
    }

    public function test_empty_types(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/types/');
        self::makeRegistry(['$oojs' => '1.0', '$id' => 'x', 'types' => []]);
    }

    public function test_invalid_type_name_lowercase(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/naming rules/');
        self::makeRegistry(['$oojs' => '1.0', '$id' => 'x', 'types' => ['dog' => []]]);
    }

    public function test_reserved_type_name(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/reserved/');
        self::makeRegistry(['$oojs' => '1.0', '$id' => 'x', 'types' => ['string' => []]]);
    }

    public function test_discriminator_collides_with_property(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/collides/');
        self::makeRegistry([
            '$oojs'         => '1.0',
            '$id'           => 'x',
            'discriminator' => 'kind',
            'types'         => ['Foo' => ['properties' => ['kind' => ['type' => 'string']]]],
        ]);
    }

    public function test_inheritance_resolved(): void
    {
        [$r, $schema] = self::animalRegistry();
        $this->assertSame($schema->types['Animal'], $schema->types['Dog']->supertype);
    }

    public function test_cycle_detection(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/cycle/');
        self::makeRegistry([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => ['A' => ['extends' => 'B'], 'B' => ['extends' => 'A']],
        ]);
    }

    public function test_property_redeclaration_forbidden(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/redeclares/');
        self::makeRegistry([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Base'  => ['properties' => ['name' => ['type' => 'string']]],
                'Child' => ['extends' => 'Base', 'properties' => ['name' => ['type' => 'string']]],
            ],
        ]);
    }

    public function test_required_references_own_property(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/not declared in own/');
        self::makeRegistry([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Base'  => ['properties' => ['name' => ['type' => 'string']], 'required' => ['name']],
                'Child' => ['extends' => 'Base', 'required' => ['name']], // illegal
            ],
        ]);
    }

    public function test_duplicate_discriminator_value(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/discriminator value/');
        self::makeRegistry([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'A' => ['discriminatorValue' => 'shared'],
                'B' => ['discriminatorValue' => 'shared'],
            ],
        ]);
    }

    public function test_idempotent_reload(): void
    {
        $r  = new Registry();
        $s1 = $r->loadDict(self::minimalSchema());
        $s2 = $r->loadDict(self::minimalSchema());
        $this->assertSame($s1, $s2);
    }

    public function test_invalid_property_name(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/naming rules/');
        self::makeRegistry([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => ['Foo' => ['properties' => ['BadName' => ['type' => 'string']]]],
        ]);
    }

    public function test_mutually_exclusive_minimum(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/mutually exclusive/');
        self::makeRegistry([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Foo' => [
                    'properties' => [
                        'n' => ['type' => 'integer', 'minimum' => 0, 'exclusiveMinimum' => 0],
                    ],
                ],
            ],
        ]);
    }

    public function test_nested_array_forbidden(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/nested arrays/');
        self::makeRegistry([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Foo' => [
                    'properties' => [
                        'matrix' => [
                            'type'  => 'array',
                            'items' => ['type' => 'array', 'items' => ['type' => 'integer']],
                        ],
                    ],
                ],
            ],
        ]);
    }
}
