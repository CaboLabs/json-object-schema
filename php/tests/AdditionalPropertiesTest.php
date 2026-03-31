<?php

declare(strict_types=1);

namespace Oojs\Tests;

use Oojs\ErrorCode;
use Oojs\Registry;
use PHPUnit\Framework\TestCase;

use function Oojs\validate;

/**
 * §8.4, §9.2 Phase 3 — Closed-world / additional properties.
 */
class AdditionalPropertiesTest extends TestCase
{
    use TestHelpers;

    private Registry $r;
    private \Oojs\Model\Schema $schema;

    protected function setUp(): void
    {
        [$this->r, $this->schema] = self::animalRegistry();
    }

    public function test_additional_property_rejected(): void
    {
        $errs = validate(
            ['_type' => 'Dog', 'name' => 'Rex', 'breed' => 'Lab', 'color' => 'black'],
            $this->schema->types['Dog'],
            $this->schema,
            $this->r,
        );
        $this->assertTrue($this->hasCode($errs, ErrorCode::ADDITIONAL_PROPERTY));
    }

    public function test_open_world_allows_extra(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs'                => '1.0',
            '$id'                  => 'https://example.org/schemas/open',
            'additionalProperties' => true,
            'types'                => ['Foo' => ['properties' => ['x' => ['type' => 'string']]]],
        ]);
        $schema = $r->getSchema('https://example.org/schemas/open');
        $errs   = validate(
            ['_type' => 'Foo', 'x' => 'hello', 'extra' => 99],
            $schema->types['Foo'],
            $schema,
            $r,
        );
        $this->assertSame([], $errs);
    }
}
