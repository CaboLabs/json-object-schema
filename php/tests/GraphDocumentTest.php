<?php

declare(strict_types=1);

namespace Oojs\Tests;

use Oojs\ErrorCode;
use Oojs\Registry;
use Oojs\Validator;
use PHPUnit\Framework\TestCase;

/**
 * Tests for graph document validation (§8.12).
 *
 * A graph document serialises multiple OOJS objects into one JSON envelope:
 *   - "roots": entry-point objects (each with "$type" and "$id")
 *   - "objects": map of "$id" → additional objects referenced via { "$ref-id": "…" }
 *
 * Horizontal TypeRef properties hold { "$ref-id": "id" } instead of an embedded object.
 * The validator type-checks each reference without recursively validating the target
 * inline — targets are validated at the top level of the document.  This design
 * makes cycle handling (§8.13) implicit: no visited-set bookkeeping is required.
 */
class GraphDocumentTest extends TestCase
{
    private function employeeSchema(): array
    {
        return [
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/employees',
            'types' => [
                'Department' => [
                    'properties' => [
                        'departmentId' => ['type' => 'string'],
                        'name'         => ['type' => 'string'],
                    ],
                    'required' => ['departmentId', 'name'],
                ],
                'Employee' => [
                    'properties' => [
                        'employeeId' => ['type' => 'string'],
                        'name'       => ['type' => 'string'],
                        'department' => ['type' => 'Department'],  // HAS-ONE → Department
                        'manager'    => ['type' => 'Employee'],    // optional HAS-ONE → Employee (self-ref)
                    ],
                    'required' => ['employeeId', 'name', 'department'],
                ],
            ],
        ];
    }

    // ------------------------------------------------------------------
    // Valid graph documents
    // ------------------------------------------------------------------

    public function test_two_employees_sharing_one_department(): void
    {
        // Alice and Bob both reference the same dept-eng object — stored once in "objects".
        $r      = new Registry();
        $schema = $r->loadDict($this->employeeSchema());

        $graphDoc = [
            '$oojs'   => '1.0',
            'roots'   => [
                [
                    '$type'      => 'Employee',
                    '$id'        => 'emp-alice',
                    'employeeId' => 'E-001',
                    'name'       => 'Alice',
                    'department' => ['$ref-id' => 'dept-eng'],
                ],
                [
                    '$type'      => 'Employee',
                    '$id'        => 'emp-bob',
                    'employeeId' => 'E-002',
                    'name'       => 'Bob',
                    'department' => ['$ref-id' => 'dept-eng'],
                ],
            ],
            'objects' => [
                'dept-eng' => [
                    '$type'        => 'Department',
                    '$id'          => 'dept-eng',
                    'departmentId' => 'D-01',
                    'name'         => 'Engineering',
                ],
            ],
        ];

        $v    = new Validator($r);
        $errs = $v->validateGraphDocument($graphDoc, $schema);
        $this->assertSame([], $errs);
    }

    public function test_graph_with_optional_manager_reference(): void
    {
        // Carol's manager is Alice, Alice has no manager.
        $r      = new Registry();
        $schema = $r->loadDict($this->employeeSchema());

        $graphDoc = [
            '$oojs'   => '1.0',
            'roots'   => [
                [
                    '$type'      => 'Employee',
                    '$id'        => 'emp-alice',
                    'employeeId' => 'E-001',
                    'name'       => 'Alice',
                    'department' => ['$ref-id' => 'dept-eng'],
                    // no 'manager' — optional field absent
                ],
                [
                    '$type'      => 'Employee',
                    '$id'        => 'emp-carol',
                    'employeeId' => 'E-003',
                    'name'       => 'Carol',
                    'department' => ['$ref-id' => 'dept-eng'],
                    'manager'    => ['$ref-id' => 'emp-alice'],
                ],
            ],
            'objects' => [
                'dept-eng' => [
                    '$type'        => 'Department',
                    '$id'          => 'dept-eng',
                    'departmentId' => 'D-01',
                    'name'         => 'Engineering',
                ],
            ],
        ];

        $v    = new Validator($r);
        $errs = $v->validateGraphDocument($graphDoc, $schema);
        $this->assertSame([], $errs);
    }

    public function test_graph_with_no_objects_map(): void
    {
        // Roots only, no "objects" key — each root has no $ref-id references.
        $r      = new Registry();
        $schema = $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/simple',
            'types' => [
                'Tag' => [
                    'properties' => ['tagId' => ['type' => 'string'], 'label' => ['type' => 'string']],
                    'required'   => ['tagId', 'label'],
                ],
            ],
        ]);

        $graphDoc = [
            '$oojs' => '1.0',
            'roots' => [
                ['$type' => 'Tag', '$id' => 'tag-1', 'tagId' => 'T-1', 'label' => 'alpha'],
                ['$type' => 'Tag', '$id' => 'tag-2', 'tagId' => 'T-2', 'label' => 'beta'],
            ],
        ];

        $v    = new Validator($r);
        $errs = $v->validateGraphDocument($graphDoc, $schema);
        $this->assertSame([], $errs);
    }

    // ------------------------------------------------------------------
    // §8.13.2 — Cycles in graph documents
    // ------------------------------------------------------------------

    public function test_mutual_manager_cycle_does_not_hang(): void
    {
        // Alice's manager is Bob; Bob's manager is Alice — a two-node cycle.
        // Validation must terminate and report no errors (both are structurally valid).
        $r      = new Registry();
        $schema = $r->loadDict($this->employeeSchema());

        $graphDoc = [
            '$oojs'   => '1.0',
            'roots'   => [
                [
                    '$type'      => 'Employee',
                    '$id'        => 'emp-alice',
                    'employeeId' => 'E-001',
                    'name'       => 'Alice',
                    'department' => ['$ref-id' => 'dept-eng'],
                    'manager'    => ['$ref-id' => 'emp-bob'],
                ],
                [
                    '$type'      => 'Employee',
                    '$id'        => 'emp-bob',
                    'employeeId' => 'E-002',
                    'name'       => 'Bob',
                    'department' => ['$ref-id' => 'dept-eng'],
                    'manager'    => ['$ref-id' => 'emp-alice'],  // points back to Alice
                ],
            ],
            'objects' => [
                'dept-eng' => [
                    '$type'        => 'Department',
                    '$id'          => 'dept-eng',
                    'departmentId' => 'D-01',
                    'name'         => 'Engineering',
                ],
            ],
        ];

        $v    = new Validator($r);
        $errs = $v->validateGraphDocument($graphDoc, $schema);
        $this->assertSame([], $errs);
    }

    public function test_three_node_cycle_does_not_hang(): void
    {
        // A.manager → B, B.manager → C, C.manager → A.
        $r      = new Registry();
        $schema = $r->loadDict($this->employeeSchema());

        $graphDoc = [
            '$oojs'   => '1.0',
            'roots'   => [
                [
                    '$type'      => 'Employee',
                    '$id'        => 'emp-a',
                    'employeeId' => 'E-A',
                    'name'       => 'Alpha',
                    'department' => ['$ref-id' => 'dept-eng'],
                    'manager'    => ['$ref-id' => 'emp-b'],
                ],
                [
                    '$type'      => 'Employee',
                    '$id'        => 'emp-b',
                    'employeeId' => 'E-B',
                    'name'       => 'Beta',
                    'department' => ['$ref-id' => 'dept-eng'],
                    'manager'    => ['$ref-id' => 'emp-c'],
                ],
                [
                    '$type'      => 'Employee',
                    '$id'        => 'emp-c',
                    'employeeId' => 'E-C',
                    'name'       => 'Gamma',
                    'department' => ['$ref-id' => 'dept-eng'],
                    'manager'    => ['$ref-id' => 'emp-a'],  // closes the cycle
                ],
            ],
            'objects' => [
                'dept-eng' => [
                    '$type'        => 'Department',
                    '$id'          => 'dept-eng',
                    'departmentId' => 'D-01',
                    'name'         => 'Engineering',
                ],
            ],
        ];

        $v    = new Validator($r);
        $errs = $v->validateGraphDocument($graphDoc, $schema);
        $this->assertSame([], $errs);
    }

    // ------------------------------------------------------------------
    // Invalid graph documents
    // ------------------------------------------------------------------

    public function test_missing_required_field_in_root_object(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->employeeSchema());

        $graphDoc = [
            '$oojs'   => '1.0',
            'roots'   => [
                [
                    '$type'      => 'Employee',
                    '$id'        => 'emp-alice',
                    // 'employeeId' missing — required
                    'name'       => 'Alice',
                    'department' => ['$ref-id' => 'dept-eng'],
                ],
            ],
            'objects' => [
                'dept-eng' => [
                    '$type'        => 'Department',
                    '$id'          => 'dept-eng',
                    'departmentId' => 'D-01',
                    'name'         => 'Engineering',
                ],
            ],
        ];

        $v    = new Validator($r);
        $errs = $v->validateGraphDocument($graphDoc, $schema);
        $this->assertNotEmpty($errs);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::MISSING_REQUIRED, $codes);
    }

    public function test_missing_required_field_in_objects_map(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->employeeSchema());

        $graphDoc = [
            '$oojs'   => '1.0',
            'roots'   => [
                [
                    '$type'      => 'Employee',
                    '$id'        => 'emp-alice',
                    'employeeId' => 'E-001',
                    'name'       => 'Alice',
                    'department' => ['$ref-id' => 'dept-eng'],
                ],
            ],
            'objects' => [
                'dept-eng' => [
                    '$type' => 'Department',
                    '$id'   => 'dept-eng',
                    // 'departmentId' and 'name' both missing
                ],
            ],
        ];

        $v    = new Validator($r);
        $errs = $v->validateGraphDocument($graphDoc, $schema);
        $this->assertNotEmpty($errs);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::MISSING_REQUIRED, $codes);
    }

    public function test_unresolved_ref_id_produces_error(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->employeeSchema());

        $graphDoc = [
            '$oojs' => '1.0',
            'roots' => [
                [
                    '$type'      => 'Employee',
                    '$id'        => 'emp-alice',
                    'employeeId' => 'E-001',
                    'name'       => 'Alice',
                    'department' => ['$ref-id' => 'does-not-exist'],  // no such $id
                ],
            ],
        ];

        $v    = new Validator($r);
        $errs = $v->validateGraphDocument($graphDoc, $schema);
        $this->assertNotEmpty($errs);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::UNRESOLVED_REFERENCE, $codes);
    }

    public function test_ref_id_type_mismatch_produces_error(): void
    {
        // Employee.department expects a Department, but dept-eng has $type Employee.
        $r      = new Registry();
        $schema = $r->loadDict($this->employeeSchema());

        $graphDoc = [
            '$oojs'   => '1.0',
            'roots'   => [
                [
                    '$type'      => 'Employee',
                    '$id'        => 'emp-alice',
                    'employeeId' => 'E-001',
                    'name'       => 'Alice',
                    'department' => ['$ref-id' => 'not-a-dept'],
                ],
            ],
            'objects' => [
                'not-a-dept' => [
                    '$type'      => 'Employee',  // wrong type for a department slot
                    '$id'        => 'not-a-dept',
                    'employeeId' => 'E-999',
                    'name'       => 'Impostor',
                    'department' => ['$ref-id' => 'not-a-dept'],  // self-ref to keep it valid on its own
                ],
            ],
        ];

        $v    = new Validator($r);
        $errs = $v->validateGraphDocument($graphDoc, $schema);
        $this->assertNotEmpty($errs);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::TYPE_MISMATCH, $codes);
    }

    public function test_root_missing_type_produces_error(): void
    {
        $r      = new Registry();
        $schema = $r->loadDict($this->employeeSchema());

        $graphDoc = [
            '$oojs' => '1.0',
            'roots' => [
                [
                    // no '$type' field
                    '$id'        => 'emp-alice',
                    'employeeId' => 'E-001',
                    'name'       => 'Alice',
                ],
            ],
        ];

        $v    = new Validator($r);
        $errs = $v->validateGraphDocument($graphDoc, $schema);
        $this->assertNotEmpty($errs);
        $codes = array_column($errs, 'code');
        $this->assertContains(ErrorCode::MISSING_DISCRIMINATOR, $codes);
    }

    // ------------------------------------------------------------------
    // File-based integration: graph-document example
    // ------------------------------------------------------------------

    public function test_graph_document_example_file(): void
    {
        $examples = __DIR__ . '/../../examples';
        $r        = new Registry();
        $schema   = $r->loadFile("$examples/graph-document.oojs.json");
        $graphDoc = json_decode(
            file_get_contents("$examples/graph-document.json"),
            associative: true,
            flags: JSON_THROW_ON_ERROR,
        );

        // Strip top-level _comment (not a graph document field)
        unset($graphDoc['_comment']);

        $v    = new Validator($r);
        $errs = $v->validateGraphDocument($graphDoc, $schema);
        $this->assertSame([], $errs, 'graph-document.json should be valid: ' . implode(', ', array_map('strval', $errs)));
    }
}
