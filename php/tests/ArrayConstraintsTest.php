<?php

declare(strict_types=1);

namespace Oojs\Tests;

use Oojs\ErrorCode;
use Oojs\Registry;
use PHPUnit\Framework\TestCase;

use function Oojs\validate;

/**
 * §6.3, §9.2 Phase 4 — Array constraints.
 */
class ArrayConstraintsTest extends TestCase
{
    use TestHelpers;

    private function errs(mixed $value, string $itemType = 'string', array $constraints = []): array
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/arr-test',
            'types' => [
                'Arr' => [
                    'properties' => [
                        'v' => array_merge(
                            ['type' => 'array', 'items' => ['type' => $itemType]],
                            $constraints,
                        ),
                    ],
                ],
            ],
        ]);
        $schema = $r->getSchema('https://example.org/schemas/arr-test');
        return validate(['_type' => 'Arr', 'v' => $value], $schema->types['Arr'], $schema, $r);
    }

    public function test_not_array(): void
    {
        $this->assertTrue($this->hasCode($this->errs('notarray'), ErrorCode::TYPE_MISMATCH));
    }

    public function test_min_items_ok(): void
    {
        $this->assertSame([], $this->errs(['a', 'b'], constraints: ['minItems' => 2]));
    }

    public function test_min_items_fail(): void
    {
        $this->assertTrue($this->hasCode($this->errs(['a'], constraints: ['minItems' => 2]), ErrorCode::ARRAY_TOO_SHORT));
    }

    public function test_max_items_ok(): void
    {
        $this->assertSame([], $this->errs(['a'], constraints: ['maxItems' => 2]));
    }

    public function test_max_items_fail(): void
    {
        $this->assertTrue($this->hasCode($this->errs(['a', 'b', 'c'], constraints: ['maxItems' => 2]), ErrorCode::ARRAY_TOO_LONG));
    }

    public function test_unique_items_ok(): void
    {
        $this->assertSame([], $this->errs(['a', 'b'], constraints: ['uniqueItems' => true]));
    }

    public function test_unique_items_fail(): void
    {
        $this->assertTrue($this->hasCode($this->errs(['a', 'a'], constraints: ['uniqueItems' => true]), ErrorCode::ARRAY_DUPLICATE_ITEMS));
    }

    public function test_item_constraint_propagated(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/arr-item-constraint',
            'types' => [
                'Arr' => [
                    'properties' => [
                        'v' => ['type' => 'array', 'items' => ['type' => 'string', 'maxLength' => 5]],
                    ],
                ],
            ],
        ]);
        $schema = $r->getSchema('https://example.org/schemas/arr-item-constraint');
        $errs   = validate(['_type' => 'Arr', 'v' => ['toolong']], $schema->types['Arr'], $schema, $r);
        $this->assertTrue($this->hasCode($errs, ErrorCode::STRING_TOO_LONG));
    }
}
