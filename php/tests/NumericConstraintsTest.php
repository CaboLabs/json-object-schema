<?php

declare(strict_types=1);

namespace Oojs\Tests;

use Oojs\ErrorCode;
use Oojs\Registry;
use PHPUnit\Framework\TestCase;

use function Oojs\validate;

/**
 * §6.1, §9.3 — Numeric constraints (integer and number kinds).
 */
class NumericConstraintsTest extends TestCase
{
    use TestHelpers;

    private function errs(mixed $value, string $kind = 'number', array $constraints = []): array
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/num-test',
            'types' => [
                'Num' => ['properties' => ['v' => array_merge(['type' => $kind], $constraints)]],
            ],
        ]);
        $schema = $r->getSchema('https://example.org/schemas/num-test');
        return validate(['_type' => 'Num', 'v' => $value], $schema->types['Num'], $schema, $r);
    }

    public function test_minimum_ok(): void
    {
        $this->assertSame([], $this->errs(5, constraints: ['minimum' => 0]));
    }

    public function test_minimum_fail(): void
    {
        $this->assertTrue($this->hasCode($this->errs(-1, constraints: ['minimum' => 0]), ErrorCode::BELOW_MINIMUM));
    }

    public function test_maximum_ok(): void
    {
        $this->assertSame([], $this->errs(10, constraints: ['maximum' => 10]));
    }

    public function test_maximum_fail(): void
    {
        $this->assertTrue($this->hasCode($this->errs(11, constraints: ['maximum' => 10]), ErrorCode::ABOVE_MAXIMUM));
    }

    public function test_exclusive_minimum_ok(): void
    {
        $this->assertSame([], $this->errs(1, constraints: ['exclusiveMinimum' => 0]));
    }

    public function test_exclusive_minimum_fail(): void
    {
        $this->assertTrue($this->hasCode($this->errs(0, constraints: ['exclusiveMinimum' => 0]), ErrorCode::BELOW_EXCLUSIVE_MINIMUM));
    }

    public function test_exclusive_maximum_ok(): void
    {
        $this->assertSame([], $this->errs(9, constraints: ['exclusiveMaximum' => 10]));
    }

    public function test_exclusive_maximum_fail(): void
    {
        $this->assertTrue($this->hasCode($this->errs(10, constraints: ['exclusiveMaximum' => 10]), ErrorCode::ABOVE_EXCLUSIVE_MAXIMUM));
    }

    public function test_multiple_of_ok(): void
    {
        $this->assertSame([], $this->errs(6, constraints: ['multipleOf' => 3]));
    }

    public function test_multiple_of_fail(): void
    {
        $this->assertTrue($this->hasCode($this->errs(7, constraints: ['multipleOf' => 3]), ErrorCode::NOT_MULTIPLE_OF));
    }

    public function test_integer_ok(): void
    {
        $this->assertSame([], $this->errs(3, kind: 'integer'));
    }

    public function test_integer_float_with_fraction(): void
    {
        $this->assertTrue($this->hasCode($this->errs(3.5, kind: 'integer'), ErrorCode::NOT_INTEGER));
    }

    public function test_integer_float_no_fraction(): void
    {
        // 3.0 is acceptable as integer (no fractional part)
        $this->assertSame([], $this->errs(3.0, kind: 'integer'));
    }

    public function test_enum_number_ok(): void
    {
        $this->assertSame([], $this->errs(2, constraints: ['enum' => [1, 2, 3]]));
    }

    public function test_enum_number_fail(): void
    {
        $this->assertTrue($this->hasCode($this->errs(5, constraints: ['enum' => [1, 2, 3]]), ErrorCode::ENUM_MISMATCH));
    }
}
