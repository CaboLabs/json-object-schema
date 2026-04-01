<?php

declare(strict_types=1);

namespace Oojs\Tests;

use Oojs\ErrorCode;
use Oojs\Registry;
use PHPUnit\Framework\TestCase;

use function Oojs\validate;

/**
 * Tests for all four combinations of cardinality × structure (§8.7).
 *
 * The matrix:
 *
 *              | Has-one              | Has-many
 *   -----------+----------------------+-----------------------------
 *   Vertical   | TypeRefProperty      | ArrayProperty{items:TypeRef}
 *   (embedded) | Employee.address     | Employee.badges
 *   -----------+----------------------+-----------------------------
 *   Horizontal | PrimitiveProperty    | ArrayProperty{items:string}
 *   (ID ref)   | Employee.departmentId| Employee.projectIds
 *
 * Uses the relationships.oojs.json / relationships-instances.json example fixtures.
 */
class RelationshipsCardinalityTest extends TestCase
{
    private Registry $r;
    private \Oojs\Model\Schema $schema;
    private array $typedef;

    protected function setUp(): void
    {
        $examples      = __DIR__ . '/../../examples';
        $this->r       = new Registry();
        $this->schema  = $this->r->loadFile("$examples/relationships.oojs.json");
        $this->typedef = $this->schema->types;
    }

    // ------------------------------------------------------------------
    // Example file round-trips
    // ------------------------------------------------------------------

    public function test_example_file_valid_instances_all_pass(): void
    {
        $data = $this->loadInstances();
        foreach ($data['valid'] as $inst) {
            $clean = $this->strip($inst);
            $errs  = validate($clean, $this->typedef[$clean['_type']], $this->schema, $this->r);
            $this->assertSame(
                [],
                $errs,
                "Expected valid ({$inst['_comment']}): " . implode(', ', array_map('strval', $errs)),
            );
        }
    }

    public function test_example_file_invalid_instances_all_fail(): void
    {
        $data = $this->loadInstances();
        foreach ($data['invalid'] as $inst) {
            $clean = $this->strip($inst);
            $type  = $clean['_type'] ?? 'Employee';
            $errs  = validate($clean, $this->typedef[$type], $this->schema, $this->r);
            $this->assertNotEmpty($errs, "Expected errors ({$inst['_comment']})");
        }
    }

    // ------------------------------------------------------------------
    // §8.7 — Has-one vertical (Employee.address → Address embedded)
    // ------------------------------------------------------------------

    public function test_has_one_vertical_valid(): void
    {
        $emp = [
            '_type'        => 'Employee',
            'employeeId'   => 'emp-001',
            'name'         => 'Alice',
            'departmentId' => 'dept-eng',
            'address'      => [
                '_type'  => 'Address',
                'street' => '1 Main St',
                'city'   => 'Springfield',
            ],
        ];
        $this->assertSame([], validate($emp, $this->typedef['Employee'], $this->schema, $this->r));
    }

    public function test_has_one_vertical_optional_may_be_absent(): void
    {
        // address is optional — Employee is valid without it
        $emp = [
            '_type'        => 'Employee',
            'employeeId'   => 'emp-002',
            'name'         => 'Bob',
            'departmentId' => 'dept-ops',
        ];
        $this->assertSame([], validate($emp, $this->typedef['Employee'], $this->schema, $this->r));
    }

    public function test_has_one_vertical_missing_required_field_in_embedded_object(): void
    {
        // Address is present but missing required 'street'
        $emp = [
            '_type'        => 'Employee',
            'employeeId'   => 'emp-003',
            'name'         => 'Carol',
            'departmentId' => 'dept-eng',
            'address'      => [
                '_type' => 'Address',
                'city'  => 'Springfield',
                // 'street' absent
            ],
        ];
        $errs  = validate($emp, $this->typedef['Employee'], $this->schema, $this->r);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::MISSING_REQUIRED, $codes);
    }

    public function test_has_one_vertical_type_mismatch_in_embedded_object(): void
    {
        // Passing a Badge where Address is expected
        $emp = [
            '_type'        => 'Employee',
            'employeeId'   => 'emp-004',
            'name'         => 'Dave',
            'departmentId' => 'dept-eng',
            'address'      => ['_type' => 'Badge', 'badgeId' => 'b-1', 'label' => 'X'],
        ];
        $errs  = validate($emp, $this->typedef['Employee'], $this->schema, $this->r);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::TYPE_MISMATCH, $codes);
    }

    public function test_has_one_vertical_must_be_object_not_string(): void
    {
        $emp = [
            '_type'        => 'Employee',
            'employeeId'   => 'emp-005',
            'name'         => 'Eve',
            'departmentId' => 'dept-eng',
            'address'      => 'not-an-object',
        ];
        $errs  = validate($emp, $this->typedef['Employee'], $this->schema, $this->r);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::TYPE_MISMATCH, $codes);
    }

    // ------------------------------------------------------------------
    // §8.7 — Has-many vertical (Employee.badges → Badge[] embedded)
    // ------------------------------------------------------------------

    public function test_has_many_vertical_valid_multiple_items(): void
    {
        $emp = [
            '_type'        => 'Employee',
            'employeeId'   => 'emp-010',
            'name'         => 'Frank',
            'departmentId' => 'dept-eng',
            'badges'       => [
                ['_type' => 'Badge', 'badgeId' => 'b-1', 'label' => 'Safety', 'level' => 3],
                ['_type' => 'Badge', 'badgeId' => 'b-2', 'label' => 'Leader'],
            ],
        ];
        $this->assertSame([], validate($emp, $this->typedef['Employee'], $this->schema, $this->r));
    }

    public function test_has_many_vertical_valid_empty_array(): void
    {
        // Zero items is valid (minItems defaults to 0)
        $emp = [
            '_type'        => 'Employee',
            'employeeId'   => 'emp-011',
            'name'         => 'Grace',
            'departmentId' => 'dept-hr',
            'badges'       => [],
        ];
        $this->assertSame([], validate($emp, $this->typedef['Employee'], $this->schema, $this->r));
    }

    public function test_has_many_vertical_missing_required_field_in_one_item(): void
    {
        $emp = [
            '_type'        => 'Employee',
            'employeeId'   => 'emp-012',
            'name'         => 'Henry',
            'departmentId' => 'dept-eng',
            'badges'       => [
                ['_type' => 'Badge', 'badgeId' => 'b-ok',  'label' => 'OK'],
                ['_type' => 'Badge', 'badgeId' => 'b-bad'],  // missing required 'label'
            ],
        ];
        $errs  = validate($emp, $this->typedef['Employee'], $this->schema, $this->r);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::MISSING_REQUIRED, $codes);
    }

    public function test_has_many_vertical_constraint_violation_in_one_item(): void
    {
        // Badge.level has maximum: 5 — level 10 should fail
        $emp = [
            '_type'        => 'Employee',
            'employeeId'   => 'emp-013',
            'name'         => 'Iris',
            'departmentId' => 'dept-eng',
            'badges'       => [
                ['_type' => 'Badge', 'badgeId' => 'b-1', 'label' => 'Expert', 'level' => 10],
            ],
        ];
        $errs  = validate($emp, $this->typedef['Employee'], $this->schema, $this->r);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::ABOVE_MAXIMUM, $codes);
    }

    public function test_has_many_vertical_must_be_array_not_object(): void
    {
        $emp = [
            '_type'        => 'Employee',
            'employeeId'   => 'emp-014',
            'name'         => 'Jack',
            'departmentId' => 'dept-eng',
            'badges'       => ['_type' => 'Badge', 'badgeId' => 'b-1', 'label' => 'X'],
        ];
        $errs  = validate($emp, $this->typedef['Employee'], $this->schema, $this->r);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::TYPE_MISMATCH, $codes);
    }

    // ------------------------------------------------------------------
    // §8.7 — Has-one horizontal (Employee.departmentId → ID string)
    // ------------------------------------------------------------------

    public function test_has_one_horizontal_valid(): void
    {
        $emp = [
            '_type'        => 'Employee',
            'employeeId'   => 'emp-020',
            'name'         => 'Karen',
            'departmentId' => 'dept-eng',  // just an ID string; no Department embedded
        ];
        $this->assertSame([], validate($emp, $this->typedef['Employee'], $this->schema, $this->r));
    }

    public function test_has_one_horizontal_required_must_be_present(): void
    {
        $emp = [
            '_type'      => 'Employee',
            'employeeId' => 'emp-021',
            'name'       => 'Leo',
            // departmentId absent — required field
        ];
        $errs  = validate($emp, $this->typedef['Employee'], $this->schema, $this->r);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::MISSING_REQUIRED, $codes);
    }

    public function test_has_one_horizontal_must_be_string_not_integer(): void
    {
        $emp = [
            '_type'        => 'Employee',
            'employeeId'   => 'emp-022',
            'name'         => 'Mia',
            'departmentId' => 42,  // must be a string
        ];
        $errs  = validate($emp, $this->typedef['Employee'], $this->schema, $this->r);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::TYPE_MISMATCH, $codes);
    }

    public function test_has_one_horizontal_must_be_string_not_array(): void
    {
        $emp = [
            '_type'        => 'Employee',
            'employeeId'   => 'emp-023',
            'name'         => 'Nick',
            'departmentId' => ['dept-eng'],  // array instead of bare string
        ];
        $errs  = validate($emp, $this->typedef['Employee'], $this->schema, $this->r);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::TYPE_MISMATCH, $codes);
    }

    public function test_has_one_horizontal_minlength_enforced(): void
    {
        // departmentId has minLength: 1 — empty string is invalid
        $emp = [
            '_type'        => 'Employee',
            'employeeId'   => 'emp-024',
            'name'         => 'Olivia',
            'departmentId' => '',
        ];
        $errs  = validate($emp, $this->typedef['Employee'], $this->schema, $this->r);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::STRING_TOO_SHORT, $codes);
    }

    // ------------------------------------------------------------------
    // §8.7 — Has-many horizontal (Employee.projectIds → string[] IDs)
    // ------------------------------------------------------------------

    public function test_has_many_horizontal_valid_multiple_ids(): void
    {
        $emp = [
            '_type'        => 'Employee',
            'employeeId'   => 'emp-030',
            'name'         => 'Paul',
            'departmentId' => 'dept-eng',
            'projectIds'   => ['proj-alpha', 'proj-beta', 'proj-gamma'],
        ];
        $this->assertSame([], validate($emp, $this->typedef['Employee'], $this->schema, $this->r));
    }

    public function test_has_many_horizontal_valid_empty_array(): void
    {
        $emp = [
            '_type'        => 'Employee',
            'employeeId'   => 'emp-031',
            'name'         => 'Quinn',
            'departmentId' => 'dept-eng',
            'projectIds'   => [],
        ];
        $this->assertSame([], validate($emp, $this->typedef['Employee'], $this->schema, $this->r));
    }

    public function test_has_many_horizontal_item_must_be_string_not_integer(): void
    {
        $emp = [
            '_type'        => 'Employee',
            'employeeId'   => 'emp-032',
            'name'         => 'Rose',
            'departmentId' => 'dept-eng',
            'projectIds'   => ['proj-ok', 99],  // 99 is not a string
        ];
        $errs  = validate($emp, $this->typedef['Employee'], $this->schema, $this->r);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::TYPE_MISMATCH, $codes);
    }

    public function test_has_many_horizontal_must_be_array_not_string(): void
    {
        $emp = [
            '_type'        => 'Employee',
            'employeeId'   => 'emp-033',
            'name'         => 'Sam',
            'departmentId' => 'dept-eng',
            'projectIds'   => 'proj-alpha',  // bare string instead of array
        ];
        $errs  = validate($emp, $this->typedef['Employee'], $this->schema, $this->r);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::TYPE_MISMATCH, $codes);
    }

    public function test_has_many_horizontal_all_four_present_together(): void
    {
        // All four quadrants populated simultaneously — the common real-world case
        $emp = [
            '_type'        => 'Employee',
            'employeeId'   => 'emp-040',
            'name'         => 'Tina',
            'address'      => ['_type' => 'Address', 'street' => '5 Oak Rd', 'city' => 'Shelbyville'],
            'badges'       => [
                ['_type' => 'Badge', 'badgeId' => 'b-1', 'label' => 'Expert', 'level' => 4],
                ['_type' => 'Badge', 'badgeId' => 'b-2', 'label' => 'Mentor'],
            ],
            'departmentId' => 'dept-rd',
            'projectIds'   => ['proj-x', 'proj-y'],
        ];
        $this->assertSame([], validate($emp, $this->typedef['Employee'], $this->schema, $this->r));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private function loadInstances(): array
    {
        return json_decode(
            file_get_contents(__DIR__ . '/../../examples/relationships-instances.json'),
            associative: true,
            flags: JSON_THROW_ON_ERROR,
        );
    }

    private function strip(array $inst): array
    {
        return array_filter($inst, static fn($k) => $k !== '_comment', ARRAY_FILTER_USE_KEY);
    }
}
