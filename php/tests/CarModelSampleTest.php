<?php

declare(strict_types=1);

namespace Oojs\Tests;

use Oojs\Registry;
use PHPUnit\Framework\TestCase;

use function Oojs\validate;

/**
 * Sample schema + instance: car → motor → wheels.
 */
class CarModelSampleTest extends TestCase
{
    public function test_car_motor_wheels_sample_valid(): void
    {
        $schema = [
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/car',
            'types' => [
                'Motor' => [
                    'properties' => [
                        'horsepower' => ['type' => 'number', 'minimum' => 1],
                        'cylinders'  => ['type' => 'integer', 'minimum' => 1],
                    ],
                    'required' => ['horsepower', 'cylinders'],
                ],
                'Wheel' => [
                    'properties' => [
                        'size'     => ['type' => 'number', 'minimum' => 10],
                        'material' => ['type' => 'string', 'enum' => ['rubber']],
                    ],
                    'required' => ['size', 'material'],
                ],
                'Car' => [
                    'properties' => [
                        'make'   => ['type' => 'string'],
                        'model'  => ['type' => 'string'],
                        'motor'  => ['type' => 'Motor'],
                        'wheels' => [
                            'type'     => 'array',
                            'items'    => ['type' => 'Wheel'],
                            'minItems' => 4,
                            'maxItems' => 4,
                        ],
                    ],
                    'required' => ['make', 'model', 'motor', 'wheels'],
                ],
            ],
        ];

        $instance = [
            '_type'  => 'Car',
            'make'   => 'Acme',
            'model'  => 'Roadster',
            'motor'  => ['_type' => 'Motor', 'horsepower' => 220, 'cylinders' => 4],
            'wheels' => [
                ['_type' => 'Wheel', 'size' => 18, 'material' => 'rubber'],
                ['_type' => 'Wheel', 'size' => 18, 'material' => 'rubber'],
                ['_type' => 'Wheel', 'size' => 18, 'material' => 'rubber'],
                ['_type' => 'Wheel', 'size' => 18, 'material' => 'rubber'],
            ],
        ];

        $r = new Registry();
        $loaded = $r->loadDict($schema);
        $errs = validate($instance, $loaded->types['Car'], $loaded, $r);

        $this->assertSame([], $errs);
    }
}
