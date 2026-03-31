<?php

declare(strict_types=1);

namespace Oojs\Tests;

use Oojs\ErrorCode;
use Oojs\Registry;
use PHPUnit\Framework\TestCase;

use function Oojs\validate;

/**
 * §7, §8 — Polymorphic dispatch via array.
 */
class PolymorphicArrayTest extends TestCase
{
    use TestHelpers;

    private Registry $r;
    private \Oojs\Model\Schema $schema;

    protected function setUp(): void
    {
        $this->r = new Registry();
        $this->r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/poly',
            'types' => [
                'Shape'  => ['abstract' => true, 'properties' => ['color' => ['type' => 'string']]],
                'Circle' => [
                    'extends'    => 'Shape',
                    'properties' => ['radius' => ['type' => 'number']],
                    'required'   => ['radius'],
                ],
                'Rect' => [
                    'extends'    => 'Shape',
                    'properties' => [
                        'width'  => ['type' => 'number'],
                        'height' => ['type' => 'number'],
                    ],
                    'required' => ['width', 'height'],
                ],
                'Canvas' => [
                    'properties' => ['shapes' => ['type' => 'array', 'items' => ['type' => 'Shape']]],
                ],
            ],
        ]);
        $this->schema = $this->r->getSchema('https://example.org/schemas/poly');
    }

    public function test_polymorphic_array_valid(): void
    {
        $instance = [
            '_type'  => 'Canvas',
            'shapes' => [
                ['_type' => 'Circle', 'radius' => 5.0],
                ['_type' => 'Rect', 'width' => 10.0, 'height' => 4.0],
            ],
        ];
        $errs = validate($instance, $this->schema->types['Canvas'], $this->schema, $this->r);
        $this->assertSame([], $errs);
    }

    public function test_polymorphic_array_abstract_item(): void
    {
        $instance = [
            '_type'  => 'Canvas',
            'shapes' => [['_type' => 'Shape', 'color' => 'red']],
        ];
        $errs = validate($instance, $this->schema->types['Canvas'], $this->schema, $this->r);
        $this->assertTrue($this->hasCode($errs, ErrorCode::ABSTRACT_TYPE));
    }

    public function test_polymorphic_array_missing_required(): void
    {
        $instance = [
            '_type'  => 'Canvas',
            'shapes' => [['_type' => 'Circle']], // missing radius
        ];
        $errs = validate($instance, $this->schema->types['Canvas'], $this->schema, $this->r);
        $this->assertTrue($this->hasCode($errs, ErrorCode::MISSING_REQUIRED));
    }
}
