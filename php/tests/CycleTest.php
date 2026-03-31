<?php

declare(strict_types=1);

namespace Oojs\Tests;

use Oojs\Registry;
use PHPUnit\Framework\TestCase;

use function Oojs\validate;

/**
 * Tests for cycles in the object model (§8.13).
 *
 * OOJS explicitly allows cycles at both the schema level (type-reference chains
 * that loop back) and the instance level (finitely-nested standalone instances and
 * graph documents with $ref-id references that form cycles).
 *
 * Schema-level cycles are safe because TypeRef values are stored as plain strings —
 * no recursive expansion occurs during schema loading.
 *
 * Instance-level cycles in standalone instances cannot occur in pure JSON (which is
 * always a tree), so the validator terminates automatically.
 *
 * Cycles in graph documents are handled by type-checking $ref-id references without
 * recursive inline validation (§8.12, §8.13.2).
 */
class CycleTest extends TestCase
{
    // ------------------------------------------------------------------
    // §8.13.1 — Schema-level cycles
    // ------------------------------------------------------------------

    public function test_self_referential_type_schema_loads_without_error(): void
    {
        // Employee.manager is a TypeRef to Employee (self-referential).
        $r = new Registry();
        $schema = $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/self-ref',
            'types' => [
                'Employee' => [
                    'properties' => [
                        'employeeId' => ['type' => 'string'],
                        'name'       => ['type' => 'string'],
                        'manager'    => ['type' => 'Employee'],  // self-referential
                    ],
                    'required' => ['employeeId', 'name'],
                ],
            ],
        ]);
        $this->assertArrayHasKey('Employee', $schema->types);
    }

    public function test_two_type_cycle_schema_loads_without_error(): void
    {
        // Employee.department → Department, Department.head → Employee.
        $r = new Registry();
        $schema = $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/two-cycle',
            'types' => [
                'Employee' => [
                    'properties' => [
                        'employeeId' => ['type' => 'string'],
                        'name'       => ['type' => 'string'],
                        'department' => ['type' => 'Department'],
                    ],
                    'required' => ['employeeId', 'name'],
                ],
                'Department' => [
                    'properties' => [
                        'departmentId' => ['type' => 'string'],
                        'name'         => ['type' => 'string'],
                        'head'         => ['type' => 'Employee'],
                    ],
                    'required' => ['departmentId', 'name'],
                ],
            ],
        ]);
        $this->assertArrayHasKey('Employee',   $schema->types);
        $this->assertArrayHasKey('Department', $schema->types);
    }

    public function test_three_type_cycle_schema_loads_without_error(): void
    {
        // A.b → B, B.c → C, C.a → A.
        $r = new Registry();
        $schema = $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/three-cycle',
            'types' => [
                'A' => [
                    'properties' => ['id' => ['type' => 'string'], 'b' => ['type' => 'B']],
                    'required'   => ['id'],
                ],
                'B' => [
                    'properties' => ['id' => ['type' => 'string'], 'c' => ['type' => 'C']],
                    'required'   => ['id'],
                ],
                'C' => [
                    'properties' => ['id' => ['type' => 'string'], 'a' => ['type' => 'A']],
                    'required'   => ['id'],
                ],
            ],
        ]);
        $this->assertArrayHasKey('A', $schema->types);
        $this->assertArrayHasKey('B', $schema->types);
        $this->assertArrayHasKey('C', $schema->types);
    }

    // ------------------------------------------------------------------
    // §8.13.3 — Standalone instances: JSON is a tree, so cycles are impossible
    // ------------------------------------------------------------------

    public function test_self_referential_type_instance_no_manager_valid(): void
    {
        $r = new Registry();
        $schema = $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/self-ref2',
            'types' => [
                'Employee' => [
                    'properties' => [
                        'employeeId' => ['type' => 'string'],
                        'name'       => ['type' => 'string'],
                        'manager'    => ['type' => 'Employee'],  // optional — no manager
                    ],
                    'required' => ['employeeId', 'name'],
                ],
            ],
        ]);
        $emp = [
            '_type'      => 'Employee',
            'employeeId' => 'E-001',
            'name'       => 'Alice',
            // no 'manager' — optional field absent
        ];
        $this->assertSame([], validate($emp, $schema->types['Employee'], $schema, $r));
    }

    public function test_self_referential_type_instance_depth_three_valid(): void
    {
        // Alice manages Bob who manages Carol. Depth = 3, no infinite loop.
        $r = new Registry();
        $schema = $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/self-ref3',
            'types' => [
                'Employee' => [
                    'properties' => [
                        'employeeId' => ['type' => 'string'],
                        'name'       => ['type' => 'string'],
                        'manager'    => ['type' => 'Employee'],
                    ],
                    'required' => ['employeeId', 'name'],
                ],
            ],
        ]);
        $alice = [
            '_type'      => 'Employee',
            'employeeId' => 'E-001',
            'name'       => 'Alice',
            'manager'    => [
                '_type'      => 'Employee',
                'employeeId' => 'E-002',
                'name'       => 'Bob',
                'manager'    => [
                    '_type'      => 'Employee',
                    'employeeId' => 'E-003',
                    'name'       => 'Carol',
                    // Carol has no manager — recursion terminates here
                ],
            ],
        ];
        $this->assertSame([], validate($alice, $schema->types['Employee'], $schema, $r));
    }

    public function test_three_type_cycle_instance_valid(): void
    {
        // A embeds B embeds C; C has no further nesting.
        // The class schema has a cycle (C.a → A) but the instance is a finite tree.
        $r = new Registry();
        $schema = $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/three-cycle-inst',
            'types' => [
                'A' => [
                    'properties' => ['id' => ['type' => 'string'], 'b' => ['type' => 'B']],
                    'required'   => ['id'],
                ],
                'B' => [
                    'properties' => ['id' => ['type' => 'string'], 'c' => ['type' => 'C']],
                    'required'   => ['id'],
                ],
                'C' => [
                    'properties' => ['id' => ['type' => 'string'], 'a' => ['type' => 'A']],
                    'required'   => ['id'],
                ],
            ],
        ]);
        $instance = [
            '_type' => 'A',
            'id'    => 'a-1',
            'b'     => [
                '_type' => 'B',
                'id'    => 'b-1',
                'c'     => [
                    '_type' => 'C',
                    'id'    => 'c-1',
                    // 'a' absent — optional, recursion terminates
                ],
            ],
        ];
        $this->assertSame([], validate($instance, $schema->types['A'], $schema, $r));
    }
}
