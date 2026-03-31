<?php

declare(strict_types=1);

namespace Oojs\Tests;

use Oojs\ErrorCode;
use Oojs\Registry;
use PHPUnit\Framework\TestCase;

use function Oojs\validate;

/**
 * §6.1, §9.3 — String constraints.
 */
class StringConstraintsTest extends TestCase
{
    use TestHelpers;

    private function errs(mixed $value, array $constraints): array
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/str-test',
            'types' => [
                'Str' => ['properties' => ['v' => array_merge(['type' => 'string'], $constraints)]],
            ],
        ]);
        $schema = $r->getSchema('https://example.org/schemas/str-test');
        return validate(['_type' => 'Str', 'v' => $value], $schema->types['Str'], $schema, $r);
    }

    public function test_min_length_ok(): void
    {
        $this->assertSame([], $this->errs('hi', ['minLength' => 2]));
    }

    public function test_min_length_fail(): void
    {
        $this->assertTrue($this->hasCode($this->errs('x', ['minLength' => 2]), ErrorCode::STRING_TOO_SHORT));
    }

    public function test_max_length_ok(): void
    {
        $this->assertSame([], $this->errs('hi', ['maxLength' => 5]));
    }

    public function test_max_length_fail(): void
    {
        $this->assertTrue($this->hasCode($this->errs('toolong', ['maxLength' => 5]), ErrorCode::STRING_TOO_LONG));
    }

    public function test_pattern_match(): void
    {
        $this->assertSame([], $this->errs('abc123', ['pattern' => '^[a-z]+[0-9]+$']));
    }

    public function test_pattern_no_match(): void
    {
        $this->assertTrue($this->hasCode($this->errs('123abc', ['pattern' => '^[a-z]+[0-9]+$']), ErrorCode::PATTERN_MISMATCH));
    }

    public function test_enum_match(): void
    {
        $this->assertSame([], $this->errs('yes', ['enum' => ['yes', 'no']]));
    }

    public function test_enum_mismatch(): void
    {
        $this->assertTrue($this->hasCode($this->errs('maybe', ['enum' => ['yes', 'no']]), ErrorCode::ENUM_MISMATCH));
    }

    public function test_type_mismatch(): void
    {
        $this->assertTrue($this->hasCode($this->errs(42, []), ErrorCode::TYPE_MISMATCH));
    }
}
