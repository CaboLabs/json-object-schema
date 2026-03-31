<?php

declare(strict_types=1);

namespace Oojs\Tests;

use Oojs\Model\Schema;
use Oojs\Registry;
use Oojs\ValidationError;

/**
 * Shared constants and helpers used across all test classes.
 */
trait TestHelpers
{
    protected static function minimalSchema(): array
    {
        return [
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/test',
            'types' => [
                'Animal' => [
                    'abstract'   => true,
                    'properties' => [
                        'name' => ['type' => 'string'],
                        'age'  => ['type' => 'integer', 'minimum' => 0],
                    ],
                    'required' => ['name'],
                ],
                'Dog' => [
                    'extends'    => 'Animal',
                    'properties' => ['breed' => ['type' => 'string']],
                    'required'   => ['breed'],
                ],
                'Cat' => [
                    'extends'    => 'Animal',
                    'properties' => ['indoor' => ['type' => 'boolean']],
                ],
            ],
        ];
    }

    protected static function makeRegistry(array ...$schemas): Registry
    {
        $r = new Registry();
        foreach ($schemas as $s) {
            $r->loadDict($s);
        }
        return $r;
    }

    /**
     * @return array{Registry, Schema}
     */
    protected static function animalRegistry(): array
    {
        $r      = self::makeRegistry(self::minimalSchema());
        $schema = $r->getSchema('https://example.org/schemas/test');
        return [$r, $schema];
    }

    /**
     * @param ValidationError[] $errs
     */
    protected function hasCode(array $errs, string $code): bool
    {
        foreach ($errs as $e) {
            if ($e->code === $code) {
                return true;
            }
        }
        return false;
    }

    /**
     * @param ValidationError[] $errs
     */
    protected function hasCodeAndMessage(array $errs, string $code, string $fragment): bool
    {
        foreach ($errs as $e) {
            if ($e->code === $code && str_contains($e->message, $fragment)) {
                return true;
            }
        }
        return false;
    }
}
