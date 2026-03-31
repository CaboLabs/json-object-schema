<?php

declare(strict_types=1);

namespace Oojs\Tests;

use Oojs\Registry;
use PHPUnit\Framework\TestCase;

use function Oojs\validate;

/**
 * Integration tests using the clinical example schema and instances.
 * Reuses the JSON fixtures from ../../examples/.
 */
class ClinicalExampleTest extends TestCase
{
    use TestHelpers;

    private Registry $r;
    private \Oojs\Model\Schema $schema;
    private array $validInstances;
    private array $invalidInstances;

    protected function setUp(): void
    {
        $examples = __DIR__ . '/../../examples';
        $this->r  = new Registry();
        $this->schema = $this->r->loadFile("$examples/clinical.oojs.json");

        $data = json_decode(
            file_get_contents("$examples/clinical-instances.json"),
            associative: true,
            flags: JSON_THROW_ON_ERROR,
        );
        $this->validInstances   = $data['valid'];
        $this->invalidInstances = $data['invalid'];
    }

    public function test_valid_instances_pass(): void
    {
        foreach ($this->validInstances as $inst) {
            $clean = array_filter($inst, static fn($k) => $k !== '_comment', ARRAY_FILTER_USE_KEY);
            $dv    = $clean['_type'] ?? null;
            if ($dv === null || !isset($this->schema->types[$dv])) {
                continue;
            }
            $typedef = $this->schema->types[$dv];
            $errs    = validate($clean, $typedef, $this->schema, $this->r);
            $this->assertSame(
                [],
                $errs,
                "Expected valid but got errors for $dv: " . implode(', ', array_map('strval', $errs)),
            );
        }
    }

    public function test_invalid_instances_fail(): void
    {
        foreach ($this->invalidInstances as $inst) {
            $dv = $inst['_type'] ?? null;
            if ($dv === null) {
                $target = $this->schema->types['Observation'];
            } else {
                $target = $this->schema->types[$dv]
                    ?? array_values($this->schema->types)[0];
            }
            $errs    = validate($inst, $target, $this->schema, $this->r);
            $comment = $inst['_comment'] ?? '';
            $this->assertNotEmpty($errs, "Expected errors for invalid instance ($comment)");
        }
    }
}
