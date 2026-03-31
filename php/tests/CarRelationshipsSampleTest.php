<?php

declare(strict_types=1);

namespace Oojs\Tests;

use Oojs\Registry;
use PHPUnit\Framework\TestCase;

use function Oojs\validate;

/**
 * Sample schema + instance: horizontal has-one / has-many via IDs.
 */
class CarRelationshipsSampleTest extends TestCase
{
    public function test_car_relationships_sample_valid(): void
    {
        $schema = [
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/car-rel',
            'types' => [
                'Person' => [
                    'properties' => [
                        'personId' => ['type' => 'string'],
                        'name'     => ['type' => 'string'],
                        // has-many: list of car IDs owned/managed by the person
                        'carIds'   => ['type' => 'array', 'items' => ['type' => 'string']],
                    ],
                    'required' => ['personId', 'name'],
                ],
                'Car' => [
                    'properties' => [
                        'carId'   => ['type' => 'string'],
                        'make'    => ['type' => 'string'],
                        'model'   => ['type' => 'string'],
                        // has-one: owner is referenced by ID (not embedded)
                        'ownerId' => ['type' => 'string'],
                        // has-one: current garage by ID (not embedded)
                        'garageId' => ['type' => 'string'],
                    ],
                    'required' => ['carId', 'make', 'model', 'ownerId'],
                ],
                'Garage' => [
                    'properties' => [
                        'garageId' => ['type' => 'string'],
                        'name'     => ['type' => 'string'],
                        // has-many: list of car IDs stored in the garage
                        'carIds'   => ['type' => 'array', 'items' => ['type' => 'string']],
                    ],
                    'required' => ['garageId', 'name'],
                ],
                'Fleet' => [
                    'properties' => [
                        'fleetId'   => ['type' => 'string'],
                        'name'      => ['type' => 'string'],
                        // has-many: list of car IDs in the fleet
                        'carIds'    => ['type' => 'array', 'items' => ['type' => 'string']],
                        // has-many: list of people IDs associated with the fleet
                        'personIds' => ['type' => 'array', 'items' => ['type' => 'string']],
                    ],
                    'required' => ['fleetId', 'name'],
                ],
            ],
        ];

        $instance = [
            '_type' => 'Fleet',
            'fleetId' => 'fleet-1',
            'name' => 'City Fleet',
            'carIds' => ['car-1', 'car-2'],
            'personIds' => ['person-1'],
        ];

        $r = new Registry();
        $loaded = $r->loadDict($schema);
        $errs = validate($instance, $loaded->types['Fleet'], $loaded, $r);

        $this->assertSame([], $errs);
    }
}
