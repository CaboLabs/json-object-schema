<?php

declare(strict_types=1);

namespace Oojs\Tests;

use Oojs\ErrorCode;
use Oojs\Registry;
use PHPUnit\Framework\TestCase;

use function Oojs\validate;

/**
 * §5.6, §9.2 Phase 2 — Required properties.
 */
class RequiredTest extends TestCase
{
    use TestHelpers;

    private Registry $r;
    private \Oojs\Model\Schema $schema;

    protected function setUp(): void
    {
        [$this->r, $this->schema] = self::animalRegistry();
    }

    private function doValidate(array $instance, string $typeName = 'Animal'): array
    {
        return validate($instance, $this->schema->types[$typeName], $this->schema, $this->r);
    }

    public function test_missing_own_required(): void
    {
        $errs = $this->doValidate(['_type' => 'Dog', 'name' => 'Rex']); // missing breed
        $this->assertTrue($this->hasCodeAndMessage($errs, ErrorCode::MISSING_REQUIRED, 'breed'));
    }

    public function test_missing_inherited_required(): void
    {
        $errs = $this->doValidate(['_type' => 'Dog', 'breed' => 'Labrador']); // missing name
        $this->assertTrue($this->hasCodeAndMessage($errs, ErrorCode::MISSING_REQUIRED, 'name'));
    }

    public function test_all_required_present(): void
    {
        $errs = $this->doValidate(['_type' => 'Dog', 'name' => 'Rex', 'breed' => 'Labrador']);
        $this->assertSame([], $errs);
    }

    public function test_optional_property_absent_is_ok(): void
    {
        $errs = $this->doValidate(['_type' => 'Cat', 'name' => 'Whiskers']); // indoor is optional
        $this->assertSame([], $errs);
    }
}
