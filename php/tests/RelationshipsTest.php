<?php

declare(strict_types=1);

namespace Oojs\Tests;

use Oojs\ErrorCode;
use Oojs\Registry;
use PHPUnit\Framework\TestCase;

use function Oojs\validate;

/**
 * Tests for vertical and horizontal relationships (§8.6–§8.11).
 *
 * Vertical (embedded): the associated object is embedded directly in the JSON.
 * Horizontal (reference by ID): the associated object is referenced by a bare ID string.
 *
 * Unidirectional: only one side holds a reference.
 * Bidirectional: both sides hold references; OOJS validates each independently.
 */
class RelationshipsTest extends TestCase
{
    // ------------------------------------------------------------------
    // Schemas
    // ------------------------------------------------------------------

    /** Vertical has-one (Car embeds Motor) and has-many (Car embeds Wheels). */
    private function verticalSchema(): array
    {
        return [
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/vertical',
            'types' => [
                'Motor' => [
                    'properties' => [
                        'horsepower' => ['type' => 'integer', 'minimum' => 1],
                        'fuelType'   => ['type' => 'string', 'enum' => ['petrol', 'electric']],
                    ],
                    'required' => ['horsepower', 'fuelType'],
                ],
                'Wheel' => [
                    'properties' => [
                        'size' => ['type' => 'number', 'minimum' => 10],
                    ],
                    'required' => ['size'],
                ],
                'Car' => [
                    'properties' => [
                        'carId'  => ['type' => 'string'],
                        'make'   => ['type' => 'string'],
                        'motor'  => ['type' => 'Motor'],           // HAS-ONE VERTICAL
                        'wheels' => [                               // HAS-MANY VERTICAL
                            'type'     => 'array',
                            'items'    => ['type' => 'Wheel'],
                            'minItems' => 4,
                            'maxItems' => 4,
                        ],
                    ],
                    'required' => ['carId', 'make', 'motor', 'wheels'],
                ],
            ],
        ];
    }

    /**
     * Horizontal has-one (Car.ownerId → Person) and has-many (Fleet.carIds → [Car]).
     * Bidirectional: Person also carries carIds back-reference.
     */
    private function horizontalSchema(): array
    {
        return [
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/horizontal',
            'types' => [
                'Person' => [
                    'properties' => [
                        'personId' => ['type' => 'string'],
                        'name'     => ['type' => 'string'],
                        // HAS-MANY HORIZONTAL (inverse/bidirectional side)
                        'carIds'   => ['type' => 'array', 'items' => ['type' => 'string']],
                    ],
                    'required' => ['personId', 'name'],
                ],
                'Car' => [
                    'properties' => [
                        'carId'   => ['type' => 'string'],
                        'make'    => ['type' => 'string'],
                        // HAS-ONE HORIZONTAL (owning side)
                        'ownerId' => ['type' => 'string'],
                    ],
                    'required' => ['carId', 'make', 'ownerId'],
                ],
                'Fleet' => [
                    'properties' => [
                        'fleetId'    => ['type' => 'string'],
                        'name'       => ['type' => 'string'],
                        // HAS-MANY HORIZONTAL
                        'carIds'     => ['type' => 'array', 'items' => ['type' => 'string']],
                        'personIds'  => ['type' => 'array', 'items' => ['type' => 'string']],
                    ],
                    'required' => ['fleetId', 'name'],
                ],
            ],
        ];
    }

    /** Unidirectional: Invoice → Customer only; Customer has no back-reference. */
    private function unidirectionalSchema(): array
    {
        return [
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/unidirectional',
            'types' => [
                'Customer' => [
                    'properties' => [
                        'customerId' => ['type' => 'string'],
                        'name'       => ['type' => 'string'],
                    ],
                    'required' => ['customerId', 'name'],
                ],
                'Invoice' => [
                    'properties' => [
                        'invoiceId'  => ['type' => 'string'],
                        'amount'     => ['type' => 'number', 'minimum' => 0],
                        // UNIDIRECTIONAL HAS-ONE HORIZONTAL → Customer
                        'customerId' => ['type' => 'string'],
                    ],
                    'required' => ['invoiceId', 'amount', 'customerId'],
                ],
            ],
        ];
    }

    // ------------------------------------------------------------------
    // Vertical has-one
    // ------------------------------------------------------------------

    public function test_vertical_has_one_valid(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->verticalSchema());
        $car = [
            '_type'  => 'Car',
            'carId'  => 'car-1',
            'make'   => 'Acme',
            'motor'  => ['_type' => 'Motor', 'horsepower' => 180, 'fuelType' => 'petrol'],
            'wheels' => array_fill(0, 4, ['_type' => 'Wheel', 'size' => 18]),
        ];
        $this->assertSame([], validate($car, $schema->types['Car'], $schema, $r));
    }

    public function test_vertical_has_one_embedded_missing_required_field(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->verticalSchema());
        $car = [
            '_type'  => 'Car',
            'carId'  => 'car-1',
            'make'   => 'Acme',
            // Motor is missing required 'fuelType'
            'motor'  => ['_type' => 'Motor', 'horsepower' => 180],
            'wheels' => array_fill(0, 4, ['_type' => 'Wheel', 'size' => 18]),
        ];
        $errs = validate($car, $schema->types['Car'], $schema, $r);
        $this->assertNotEmpty($errs);
        $this->assertSame(ErrorCode::MISSING_REQUIRED, $errs[0]->code);
    }

    public function test_vertical_has_one_type_mismatch(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->verticalSchema());
        $car = [
            '_type'  => 'Car',
            'carId'  => 'car-1',
            'make'   => 'Acme',
            // Passing a Wheel where Motor is expected
            'motor'  => ['_type' => 'Wheel', 'size' => 18],
            'wheels' => array_fill(0, 4, ['_type' => 'Wheel', 'size' => 18]),
        ];
        $errs = validate($car, $schema->types['Car'], $schema, $r);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::TYPE_MISMATCH, $codes);
    }

    // ------------------------------------------------------------------
    // Vertical has-many
    // ------------------------------------------------------------------

    public function test_vertical_has_many_valid(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->verticalSchema());
        $car = [
            '_type'  => 'Car',
            'carId'  => 'car-1',
            'make'   => 'Acme',
            'motor'  => ['_type' => 'Motor', 'horsepower' => 200, 'fuelType' => 'electric'],
            'wheels' => [
                ['_type' => 'Wheel', 'size' => 20],
                ['_type' => 'Wheel', 'size' => 20],
                ['_type' => 'Wheel', 'size' => 20],
                ['_type' => 'Wheel', 'size' => 20],
            ],
        ];
        $this->assertSame([], validate($car, $schema->types['Car'], $schema, $r));
    }

    public function test_vertical_has_many_wrong_count(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->verticalSchema());
        $car = [
            '_type'  => 'Car',
            'carId'  => 'car-1',
            'make'   => 'Acme',
            'motor'  => ['_type' => 'Motor', 'horsepower' => 200, 'fuelType' => 'petrol'],
            'wheels' => [  // only 3 wheels — violates minItems=4
                ['_type' => 'Wheel', 'size' => 18],
                ['_type' => 'Wheel', 'size' => 18],
                ['_type' => 'Wheel', 'size' => 18],
            ],
        ];
        $errs = validate($car, $schema->types['Car'], $schema, $r);
        $this->assertNotEmpty($errs);
        $this->assertSame(ErrorCode::ARRAY_TOO_SHORT, $errs[0]->code);
    }

    public function test_vertical_has_many_item_invalid(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->verticalSchema());
        $car = [
            '_type'  => 'Car',
            'carId'  => 'car-1',
            'make'   => 'Acme',
            'motor'  => ['_type' => 'Motor', 'horsepower' => 200, 'fuelType' => 'petrol'],
            'wheels' => [
                ['_type' => 'Wheel', 'size' => 18],
                ['_type' => 'Wheel', 'size' => 18],
                ['_type' => 'Wheel', 'size' => 18],
                ['_type' => 'Wheel', 'size' => 5],  // too small — violates minimum:10
            ],
        ];
        $errs = validate($car, $schema->types['Car'], $schema, $r);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::BELOW_MINIMUM, $codes);
    }

    // ------------------------------------------------------------------
    // Horizontal has-one
    // ------------------------------------------------------------------

    public function test_horizontal_has_one_valid(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->horizontalSchema());
        $car = [
            '_type'   => 'Car',
            'carId'   => 'car-1',
            'make'    => 'Acme',
            'ownerId' => 'person-1',  // HAS-ONE HORIZONTAL: just an ID string
        ];
        $this->assertSame([], validate($car, $schema->types['Car'], $schema, $r));
    }

    public function test_horizontal_has_one_missing_required_id(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->horizontalSchema());
        $car = [
            '_type' => 'Car',
            'carId' => 'car-1',
            'make'  => 'Acme',
            // missing required 'ownerId'
        ];
        $errs = validate($car, $schema->types['Car'], $schema, $r);
        $this->assertNotEmpty($errs);
        $this->assertSame(ErrorCode::MISSING_REQUIRED, $errs[0]->code);
    }

    public function test_horizontal_has_one_wrong_type_for_id(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->horizontalSchema());
        $car = [
            '_type'   => 'Car',
            'carId'   => 'car-1',
            'make'    => 'Acme',
            'ownerId' => 12345,  // must be a string, not an integer
        ];
        $errs = validate($car, $schema->types['Car'], $schema, $r);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::TYPE_MISMATCH, $codes);
    }

    // ------------------------------------------------------------------
    // Horizontal has-many
    // ------------------------------------------------------------------

    public function test_horizontal_has_many_valid(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->horizontalSchema());
        $fleet = [
            '_type'     => 'Fleet',
            'fleetId'   => 'fleet-1',
            'name'      => 'City Fleet',
            'carIds'    => ['car-1', 'car-2', 'car-3'],  // HAS-MANY HORIZONTAL
            'personIds' => ['person-1'],
        ];
        $this->assertSame([], validate($fleet, $schema->types['Fleet'], $schema, $r));
    }

    public function test_horizontal_has_many_empty_is_valid(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->horizontalSchema());
        $fleet = [
            '_type'   => 'Fleet',
            'fleetId' => 'fleet-2',
            'name'    => 'Empty Fleet',
            'carIds'  => [],
        ];
        $this->assertSame([], validate($fleet, $schema->types['Fleet'], $schema, $r));
    }

    public function test_horizontal_has_many_item_wrong_type(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->horizontalSchema());
        $fleet = [
            '_type'   => 'Fleet',
            'fleetId' => 'fleet-1',
            'name'    => 'Bad Fleet',
            'carIds'  => ['car-1', 42],  // 42 is not a string ID
        ];
        $errs = validate($fleet, $schema->types['Fleet'], $schema, $r);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::TYPE_MISMATCH, $codes);
    }

    // ------------------------------------------------------------------
    // Unidirectional: each side validated independently
    // ------------------------------------------------------------------

    public function test_unidirectional_source_valid(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->unidirectionalSchema());
        $invoice = [
            '_type'      => 'Invoice',
            'invoiceId'  => 'inv-001',
            'amount'     => 450.00,
            'customerId' => 'cust-1',  // UNIDIRECTIONAL → Customer
        ];
        $this->assertSame([], validate($invoice, $schema->types['Invoice'], $schema, $r));
    }

    public function test_unidirectional_target_valid_with_no_back_reference(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->unidirectionalSchema());
        // Customer has no knowledge of its Invoices — no back-reference field
        $customer = [
            '_type'      => 'Customer',
            'customerId' => 'cust-1',
            'name'       => 'Acme Corp',
        ];
        $this->assertSame([], validate($customer, $schema->types['Customer'], $schema, $r));
    }

    public function test_unidirectional_source_missing_required_id(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->unidirectionalSchema());
        $invoice = [
            '_type'     => 'Invoice',
            'invoiceId' => 'inv-bad',
            'amount'    => 99.00,
            // missing required customerId — removes the only directional link
        ];
        $errs = validate($invoice, $schema->types['Invoice'], $schema, $r);
        $this->assertNotEmpty($errs);
        $this->assertSame(ErrorCode::MISSING_REQUIRED, $errs[0]->code);
    }

    // ------------------------------------------------------------------
    // Bidirectional: both sides valid independently; OOJS cannot detect
    // inconsistency between the two ends (§8.11.3)
    // ------------------------------------------------------------------

    public function test_bidirectional_owning_side_valid(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->horizontalSchema());
        $car = [
            '_type'   => 'Car',
            'carId'   => 'car-1',
            'make'    => 'Acme',
            'ownerId' => 'person-1',  // BIDIRECTIONAL owning side
        ];
        $this->assertSame([], validate($car, $schema->types['Car'], $schema, $r));
    }

    public function test_bidirectional_inverse_side_valid(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->horizontalSchema());
        $person = [
            '_type'    => 'Person',
            'personId' => 'person-1',
            'name'     => 'Alice',
            'carIds'   => ['car-1', 'car-2'],  // BIDIRECTIONAL inverse side
        ];
        $this->assertSame([], validate($person, $schema->types['Person'], $schema, $r));
    }

    public function test_bidirectional_inconsistent_state_passes_individual_validation(): void
    {
        // §8.11.3: OOJS validates each object independently.
        // Person claims car-X but Car.ownerId points to a different person.
        // Both are structurally valid — OOJS reports no error.
        $r      = new Registry();
        $schema = $r->loadDict($this->horizontalSchema());

        $person = [
            '_type'    => 'Person',
            'personId' => 'person-1',
            'name'     => 'Alice',
            'carIds'   => ['car-X'],  // claims car-X
        ];
        $car = [
            '_type'   => 'Car',
            'carId'   => 'car-X',
            'make'    => 'Acme',
            'ownerId' => 'person-99',  // but car-X says person-99 owns it
        ];

        $this->assertSame([], validate($person, $schema->types['Person'], $schema, $r));
        $this->assertSame([], validate($car,    $schema->types['Car'],    $schema, $r));
    }

    // ------------------------------------------------------------------
    // File-based integration: directionality and fleet examples
    // ------------------------------------------------------------------

    public function test_directionality_example_valid_instances(): void
    {
        $examples = __DIR__ . '/../../examples';
        $r        = new Registry();
        $schema   = $r->loadFile("$examples/directionality.oojs.json");
        $data     = json_decode(
            file_get_contents("$examples/directionality-instances.json"),
            associative: true,
            flags: JSON_THROW_ON_ERROR,
        );

        foreach ($data['valid'] as $inst) {
            $clean = array_filter($inst, static fn($k) => $k !== '_comment', ARRAY_FILTER_USE_KEY);
            $dv    = $clean['_type'] ?? null;
            if ($dv === null || !isset($schema->types[$dv])) {
                continue;
            }
            $errs = validate($clean, $schema->types[$dv], $schema, $r);
            $this->assertSame([], $errs, "Expected valid: $dv — " . implode(', ', array_map('strval', $errs)));
        }
    }

    public function test_directionality_example_structurally_invalid_instances(): void
    {
        $examples = __DIR__ . '/../../examples';
        $r        = new Registry();
        $schema   = $r->loadFile("$examples/directionality.oojs.json");
        $data     = json_decode(
            file_get_contents("$examples/directionality-instances.json"),
            associative: true,
            flags: JSON_THROW_ON_ERROR,
        );

        // Only the first three invalid instances are structurally invalid (missing required).
        // The last three are individually valid but bidirectionally inconsistent.
        $structurallyInvalid = array_slice($data['invalid'], 0, 3);
        foreach ($structurallyInvalid as $inst) {
            $clean = array_filter($inst, static fn($k) => $k !== '_comment', ARRAY_FILTER_USE_KEY);
            $dv    = $clean['_type'] ?? null;
            if ($dv === null || !isset($schema->types[$dv])) {
                continue;
            }
            $errs = validate($clean, $schema->types[$dv], $schema, $r);
            $this->assertNotEmpty($errs, "Expected errors for: {$inst['_comment']}");
        }
    }

    public function test_fleet_example_valid_instances(): void
    {
        $examples = __DIR__ . '/../../examples';
        $r        = new Registry();
        $schema   = $r->loadFile("$examples/fleet.oojs.json");
        $data     = json_decode(
            file_get_contents("$examples/fleet-instances.json"),
            associative: true,
            flags: JSON_THROW_ON_ERROR,
        );

        foreach ($data['valid'] as $inst) {
            $clean = array_filter($inst, static fn($k) => $k !== '_comment', ARRAY_FILTER_USE_KEY);
            $dv    = $clean['_type'] ?? null;
            if ($dv === null || !isset($schema->types[$dv])) {
                continue;
            }
            $errs = validate($clean, $schema->types[$dv], $schema, $r);
            $this->assertSame([], $errs, "Expected valid: $dv — " . implode(', ', array_map('strval', $errs)));
        }
    }

    public function test_fleet_example_invalid_instances(): void
    {
        $examples = __DIR__ . '/../../examples';
        $r        = new Registry();
        $schema   = $r->loadFile("$examples/fleet.oojs.json");
        $data     = json_decode(
            file_get_contents("$examples/fleet-instances.json"),
            associative: true,
            flags: JSON_THROW_ON_ERROR,
        );

        foreach ($data['invalid'] as $inst) {
            $clean = array_filter($inst, static fn($k) => $k !== '_comment', ARRAY_FILTER_USE_KEY);
            $dv    = $clean['_type'] ?? null;
            if ($dv === null || !isset($schema->types[$dv])) {
                continue;
            }
            $errs = validate($clean, $schema->types[$dv], $schema, $r);
            $this->assertNotEmpty($errs, "Expected errors for: {$inst['_comment']}");
        }
    }
}
