<?php

declare(strict_types=1);

namespace Oojs\Tests;

use Oojs\ErrorCode;
use Oojs\Registry;
use PHPUnit\Framework\TestCase;

use function Oojs\validate;

/**
 * §7, §9.2 Phase 1 — Discriminator resolution.
 */
class DiscriminatorTest extends TestCase
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

    public function test_missing_discriminator(): void
    {
        $errs = $this->doValidate(['name' => 'Rex', 'breed' => 'Labrador']);
        $this->assertTrue($this->hasCode($errs, ErrorCode::MISSING_DISCRIMINATOR));
    }

    public function test_invalid_discriminator_type(): void
    {
        $errs = $this->doValidate(['_type' => 42, 'name' => 'Rex', 'breed' => 'Labrador']);
        $this->assertTrue($this->hasCode($errs, ErrorCode::INVALID_DISCRIMINATOR_TYPE));
    }

    public function test_unknown_type(): void
    {
        $errs = $this->doValidate(['_type' => 'Fish', 'name' => 'Nemo']);
        $this->assertTrue($this->hasCode($errs, ErrorCode::UNKNOWN_TYPE));
    }

    public function test_abstract_type(): void
    {
        $errs = $this->doValidate(['_type' => 'Animal', 'name' => 'Generic']);
        $this->assertTrue($this->hasCode($errs, ErrorCode::ABSTRACT_TYPE));
    }

    public function test_type_not_subtype_of_target(): void
    {
        $errs = $this->doValidate(
            ['_type' => 'Dog', 'name' => 'Rex', 'breed' => 'Labrador'],
            'Cat',
        );
        $this->assertTrue($this->hasCode($errs, ErrorCode::TYPE_MISMATCH));
    }

    public function test_valid_concrete_subtype(): void
    {
        $errs = $this->doValidate(['_type' => 'Dog', 'name' => 'Rex', 'breed' => 'Labrador']);
        $this->assertSame([], $errs);
    }

    public function test_custom_discriminator_value(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/dv-test',
            'types' => [
                'Vehicle' => ['abstract' => true, 'properties' => ['speed' => ['type' => 'number']]],
                'Car'     => ['extends' => 'Vehicle', 'discriminatorValue' => 'automobile'],
            ],
        ]);
        $schema  = $r->getSchema('https://example.org/schemas/dv-test');
        $typedef = $schema->types['Vehicle'];
        $errs    = validate(['_type' => 'automobile', 'speed' => 100], $typedef, $schema, $r);
        $this->assertSame([], $errs);
    }
}
