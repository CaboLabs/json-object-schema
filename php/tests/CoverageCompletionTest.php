<?php

declare(strict_types=1);

namespace Oojs\Tests;

use Oojs\ErrorCode;
use Oojs\Registry;
use Oojs\SchemaError;
use Oojs\ValidationError;
use Oojs\Validator;
use Oojs\Model\Schema;
use Oojs\Model\TypeDef;
use Oojs\Model\TypeRefProperty;
use PHPUnit\Framework\TestCase;

use function Oojs\validate;

class CoverageCompletionTest extends TestCase
{
    use TestHelpers;

    public function test_error_code_private_constructor_is_coverable(): void
    {
        $ref  = new \ReflectionClass(ErrorCode::class);
        $ctor = $ref->getConstructor();
        $this->assertNotNull($ctor);
        $ctor->setAccessible(true);

        $instance = $ref->newInstanceWithoutConstructor();
        $ctor->invoke($instance);

        $this->assertInstanceOf(ErrorCode::class, $instance);
    }

    public function test_validation_error_to_string(): void
    {
        $err = new ValidationError('/x', ErrorCode::MISSING_REQUIRED, 'missing');
        $this->assertSame('/x: [MISSING_REQUIRED] missing', (string)$err);
    }

    public function test_registry_load_json_invalid(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/invalid JSON/');
        (new Registry())->loadJson('{');
    }

    public function test_registry_load_file_missing(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/Cannot read file/');
        $handler = set_error_handler(static fn (): bool => true, E_WARNING);
        try {
            (new Registry())->loadFile('/tmp/does-not-exist-' . uniqid());
        } finally {
            if ($handler !== null) {
                restore_error_handler();
            }
        }
    }

    public function test_registry_load_file_and_resolve_type(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'oojs');
        $this->assertNotFalse($path);
        file_put_contents($path, json_encode(self::minimalSchema(), JSON_THROW_ON_ERROR));

        try {
            $r      = new Registry();
            $schema = $r->loadFile($path);

            $this->assertSame('https://example.org/schemas/test', $schema->schemaId);
            $this->assertNotNull($r->resolveType('Dog', $schema));
            $this->assertNull($r->resolveType('Missing', $schema));
            $this->assertNull($r->resolveType('unknown.Dog', $schema));
            $this->assertNotNull($r->resolveTypeIn('Dog', $schema->schemaId));
            $this->assertNull($r->resolveTypeIn('Missing', $schema->schemaId));
            $this->assertNull($r->resolveTypeIn('Dog', 'missing-schema'));
        } finally {
            unlink($path);
        }
    }

    public function test_registry_parse_array_property_rejects_invalid_unique_items(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/uniqueItems/');
        self::makeRegistry([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Foo' => [
                    'properties' => [
                        'arr' => [
                            'type'        => 'array',
                            'items'       => ['type' => 'string'],
                            'uniqueItems' => 'yes',
                        ],
                    ],
                ],
            ],
        ]);
    }

    public function test_validator_validate_json_invalid_json(): void
    {
        [$r, $schema] = self::animalRegistry();
        $validator    = new Validator($r);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/Invalid JSON/');
        $validator->validateJson('{', 'Dog', $schema);
    }

    public function test_validator_validate_json_unknown_type(): void
    {
        [$r, $schema] = self::animalRegistry();
        $validator    = new Validator($r);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/not found/');
        $validator->validateJson('{"_type":"Dog"}', 'Missing', $schema);
    }

    public function test_validator_type_ref_mismatch(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/ref-mismatch',
            'types' => [
                'Parent' => [
                    'properties' => [
                        'child' => ['type' => 'Child'],
                    ],
                    'required' => ['child'],
                ],
                'Child' => [
                    'properties' => [
                        'name' => ['type' => 'string'],
                    ],
                    'required' => ['name'],
                ],
            ],
        ]);
        $schema = $r->getSchema('https://example.org/schemas/ref-mismatch');

        $errs = validate(['_type' => 'Parent', 'child' => 'nope'], $schema->types['Parent'], $schema, $r);
        $this->assertTrue($this->hasCode($errs, ErrorCode::TYPE_MISMATCH));
    }

    public function test_validator_type_ref_unknown_type(): void
    {
        // Unresolvable TypeRef property references are now caught at load time
        // via eager resolution (§A.3), not deferred to validation time.
        $this->expectException(\Oojs\SchemaError::class);
        $this->expectExceptionMessageMatches('/not found/');
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/ref-unknown',
            'types' => [
                'Parent' => [
                    'properties' => [
                        'child' => ['type' => 'MissingType'],
                    ],
                    'required' => ['child'],
                ],
            ],
        ]);
    }

    public function test_validator_type_ref_via_imports(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/other',
            'types' => [
                'Pet' => [
                    'properties' => [
                        'name' => ['type' => 'string'],
                    ],
                    'required' => ['name'],
                ],
            ],
        ]);
        $r->loadDict([
            '$oojs'    => '1.0',
            '$id'      => 'https://example.org/schemas/owner',
            'imports'  => ['other' => 'https://example.org/schemas/other'],
            'types'    => [
                'Owner' => [
                    'properties' => [
                        'pet' => ['type' => 'other.Pet'],
                    ],
                    'required' => ['pet'],
                ],
            ],
        ]);
        $schema = $r->getSchema('https://example.org/schemas/owner');

        $errs = validate(
            ['_type' => 'Owner', 'pet' => ['_type' => 'Pet', 'name' => 'Fido']],
            $schema->types['Owner'],
            $schema,
            $r,
        );
        $this->assertSame([], $errs);
    }

    public function test_validator_reports_json_type_name(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/type-name',
            'types' => [
                'Person' => [
                    'properties' => [
                        'age' => ['type' => 'integer'],
                    ],
                    'required' => ['age'],
                ],
            ],
        ]);
        $schema = $r->getSchema('https://example.org/schemas/type-name');

        $errs = validate(['_type' => 'Person', 'age' => ['oops']], $schema->types['Person'], $schema, $r);
        $this->assertTrue($this->hasCodeAndMessage($errs, ErrorCode::TYPE_MISMATCH, 'got array'));
    }

    public function test_unique_items_canonicalizes_object_keys(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs'                  => '1.0',
            '$id'                    => 'https://example.org/schemas/uniq-obj',
            'additionalProperties'   => true,
            'types'                  => [
                'Obj' => [],
                'Arr' => [
                    'properties' => [
                        'v' => [
                            'type'        => 'array',
                            'items'       => ['type' => 'Obj'],
                            'uniqueItems' => true,
                        ],
                    ],
                    'required' => ['v'],
                ],
            ],
        ]);
        $schema = $r->getSchema('https://example.org/schemas/uniq-obj');

        $errs = validate(
            [
                '_type' => 'Arr',
                'v'     => [
                    ['_type' => 'Obj', 'a' => 1, 'b' => 2],
                    ['_type' => 'Obj', 'b' => 2, 'a' => 1],
                ],
            ],
            $schema->types['Arr'],
            $schema,
            $r,
        );

        $this->assertTrue($this->hasCode($errs, ErrorCode::ARRAY_DUPLICATE_ITEMS));
    }

    public function test_registry_load_file_invalid_json(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'oojs');
        $this->assertNotFalse($path);
        file_put_contents($path, '{');

        try {
            $this->expectException(SchemaError::class);
            $this->expectExceptionMessageMatches('/invalid JSON/');
            (new Registry())->loadFile($path);
        } finally {
            unlink($path);
        }
    }

    public function test_registry_load_json_success_path(): void
    {
        $schema = (new Registry())->loadJson(json_encode(self::minimalSchema(), JSON_THROW_ON_ERROR));
        $this->assertSame('https://example.org/schemas/test', $schema->schemaId);
    }

    public function test_registry_schema_must_be_object(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/schema must be a JSON object/');
        (new Registry())->loadJson('null');
    }

    public function test_registry_id_must_be_non_empty_string(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/non-empty string/');
        (new Registry())->loadDict(['$oojs' => '1.0', '$id' => '', 'types' => ['A' => []]]);
    }

    public function test_registry_discriminator_must_be_non_empty_string(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/discriminator/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'discriminator' => '',
            'types' => ['A' => []],
        ]);
    }

    public function test_registry_imports_must_be_object(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/imports/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'imports' => 'nope',
            'types' => ['A' => []],
        ]);
    }

    public function test_registry_import_alias_must_match_rules(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/import alias/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'imports' => ['BadAlias' => 'https://example.org/schemas/other'],
            'types' => ['A' => []],
        ]);
    }

    public function test_registry_import_value_must_be_string(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/import value/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'imports' => ['other' => 123],
            'types' => ['A' => []],
        ]);
    }

    public function test_registry_type_definition_must_be_object(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/definition must be a JSON object/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => ['Foo' => 'nope'],
        ]);
    }

    public function test_registry_type_extends_must_be_string(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/extends/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => ['Foo' => ['extends' => 123]],
        ]);
    }

    public function test_registry_type_abstract_must_be_boolean(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/abstract/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => ['Foo' => ['abstract' => 'yes']],
        ]);
    }

    public function test_registry_type_discriminator_value_must_be_string(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/discriminatorValue/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => ['Foo' => ['discriminatorValue' => 1]],
        ]);
    }

    public function test_registry_type_properties_must_be_object(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/properties/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => ['Foo' => ['properties' => 'bad']],
        ]);
    }

    public function test_registry_type_required_must_be_array(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/required/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => ['Foo' => ['required' => 'bad']],
        ]);
    }

    public function test_registry_type_required_entries_must_be_strings(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches("/'required' entries must be strings/");
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => ['Foo' => ['required' => [1]]],
        ]);
    }

    public function test_registry_type_required_duplicates_rejected(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/more than once/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Foo' => [
                    'properties' => ['a' => ['type' => 'string']],
                    'required' => ['a', 'a'],
                ],
            ],
        ]);
    }

    public function test_registry_property_must_be_object(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/must be a JSON object/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => ['Foo' => ['properties' => ['p' => 'bad']]],
        ]);
    }

    public function test_registry_property_missing_type(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches("/missing 'type'/");
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => ['Foo' => ['properties' => ['p' => []]]],
        ]);
    }

    public function test_registry_property_type_must_be_string(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches("/'type' must be a string/");
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => ['Foo' => ['properties' => ['p' => ['type' => 1]]]],
        ]);
    }

    public function test_registry_primitive_constraints_invalid_min_length(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/non-negative integer/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => ['Foo' => ['properties' => ['name' => ['type' => 'string', 'minLength' => -1]]]],
        ]);
    }

    public function test_registry_primitive_constraints_invalid_number(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/must be a number/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => ['Foo' => ['properties' => ['n' => ['type' => 'integer', 'minimum' => true]]]],
        ]);
    }

    public function test_registry_primitive_constraints_min_length_gt_max_length(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches("/'minLength' > 'maxLength'/");
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Foo' => [
                    'properties' => ['name' => ['type' => 'string', 'minLength' => 5, 'maxLength' => 3]],
                ],
            ],
        ]);
    }

    public function test_registry_primitive_constraints_pattern_must_be_string(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/pattern/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => ['Foo' => ['properties' => ['name' => ['type' => 'string', 'pattern' => 123]]]],
        ]);
    }

    public function test_registry_primitive_constraints_enum_must_be_non_empty_array(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/enum/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => ['Foo' => ['properties' => ['name' => ['type' => 'string', 'enum' => []]]]],
        ]);
    }

    public function test_registry_numeric_constraints_exclusive_maximum_conflict(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/exclusiveMaximum/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Foo' => [
                    'properties' => [
                        'n' => ['type' => 'number', 'maximum' => 1, 'exclusiveMaximum' => 1],
                    ],
                ],
            ],
        ]);
    }

    public function test_registry_numeric_constraints_multiple_of_invalid(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/multipleOf/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => ['Foo' => ['properties' => ['n' => ['type' => 'number', 'multipleOf' => 0]]]],
        ]);
    }

    public function test_registry_numeric_constraints_enum_must_be_non_empty_array(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/enum/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => ['Foo' => ['properties' => ['n' => ['type' => 'number', 'enum' => []]]]],
        ]);
    }

    public function test_registry_array_missing_items(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches("/missing 'items'/");
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => ['Foo' => ['properties' => ['arr' => ['type' => 'array']]]],
        ]);
    }

    public function test_registry_array_min_items_must_be_non_negative_int(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/non-negative integer/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Foo' => [
                    'properties' => [
                        'arr' => ['type' => 'array', 'items' => ['type' => 'string'], 'minItems' => -1],
                    ],
                ],
            ],
        ]);
    }

    public function test_registry_array_min_items_gt_max_items(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches("/'minItems' > 'maxItems'/");
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Foo' => [
                    'properties' => [
                        'arr' => [
                            'type' => 'array',
                            'items' => ['type' => 'string'],
                            'minItems' => 5,
                            'maxItems' => 3,
                        ],
                    ],
                ],
            ],
        ]);
    }

    public function test_registry_imported_schema_not_loaded(): void
    {
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/not loaded/');
        (new Registry())->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'imports' => ['other' => 'https://example.org/schemas/other'],
            'types' => [
                'Foo' => ['extends' => 'other.Bar'],
            ],
        ]);
    }

    public function test_registry_imported_type_missing(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/other',
            'types' => ['Pet' => []],
        ]);
        $this->expectException(SchemaError::class);
        $this->expectExceptionMessageMatches('/not found in schema/');
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'imports' => ['other' => 'https://example.org/schemas/other'],
            'types' => ['Foo' => ['extends' => 'other.Missing']],
        ]);
    }

    public function test_validator_validate_json_success(): void
    {
        [$r, $schema] = self::animalRegistry();
        $validator = new Validator($r);
        $errs = $validator->validateJson(
            '{"_type":"Dog","name":"Rex","breed":"Lab"}',
            'Dog',
            $schema,
        );
        $this->assertSame([], $errs);
    }

    public function test_validator_fail_fast_non_object_instance(): void
    {
        [$r, $schema] = self::animalRegistry();
        $errs = validate('nope', $schema->types['Animal'], $schema, $r, failFast: true);
        $this->assertCount(1, $errs);
        $this->assertSame(ErrorCode::TYPE_MISMATCH, $errs[0]->code);
    }

    public function test_validator_fail_fast_additional_property(): void
    {
        [$r, $schema] = self::animalRegistry();
        $errs = validate(
            ['_type' => 'Dog', 'name' => 'Rex', 'breed' => 'Lab', 'color' => 'black'],
            $schema->types['Dog'],
            $schema,
            $r,
            failFast: true,
        );
        $this->assertCount(1, $errs);
        $this->assertSame(ErrorCode::ADDITIONAL_PROPERTY, $errs[0]->code);
    }

    public function test_validator_fail_fast_array_min_items(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Arr' => [
                    'properties' => [
                        'v' => ['type' => 'array', 'items' => ['type' => 'string'], 'minItems' => 2],
                    ],
                ],
            ],
        ]);
        $schema = $r->getSchema('x');
        $errs = validate(['_type' => 'Arr', 'v' => ['a']], $schema->types['Arr'], $schema, $r, failFast: true);
        $this->assertCount(1, $errs);
        $this->assertSame(ErrorCode::ARRAY_TOO_SHORT, $errs[0]->code);
    }

    public function test_validator_fail_fast_array_max_items(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Arr' => [
                    'properties' => [
                        'v' => ['type' => 'array', 'items' => ['type' => 'string'], 'maxItems' => 1],
                    ],
                ],
            ],
        ]);
        $schema = $r->getSchema('x');
        $errs = validate(
            ['_type' => 'Arr', 'v' => ['a', 'b']],
            $schema->types['Arr'],
            $schema,
            $r,
            failFast: true,
        );
        $this->assertCount(1, $errs);
        $this->assertSame(ErrorCode::ARRAY_TOO_LONG, $errs[0]->code);
    }

    public function test_validator_fail_fast_unique_items(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Arr' => [
                    'properties' => [
                        'v' => ['type' => 'array', 'items' => ['type' => 'string'], 'uniqueItems' => true],
                    ],
                ],
            ],
        ]);
        $schema = $r->getSchema('x');
        $errs = validate(
            ['_type' => 'Arr', 'v' => ['a', 'a']],
            $schema->types['Arr'],
            $schema,
            $r,
            failFast: true,
        );
        $this->assertCount(1, $errs);
        $this->assertSame(ErrorCode::ARRAY_DUPLICATE_ITEMS, $errs[0]->code);
    }

    public function test_validator_fail_fast_array_item_validation(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Arr' => [
                    'properties' => [
                        'v' => ['type' => 'array', 'items' => ['type' => 'string']],
                    ],
                ],
            ],
        ]);
        $schema = $r->getSchema('x');
        $errs = validate(
            ['_type' => 'Arr', 'v' => [123]],
            $schema->types['Arr'],
            $schema,
            $r,
            failFast: true,
        );
        $this->assertCount(1, $errs);
        $this->assertSame(ErrorCode::TYPE_MISMATCH, $errs[0]->code);
    }

    public function test_validator_fail_fast_integer_fraction(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Num' => [
                    'properties' => ['n' => ['type' => 'integer']],
                ],
            ],
        ]);
        $schema = $r->getSchema('x');
        $errs = validate(['_type' => 'Num', 'n' => 3.5], $schema->types['Num'], $schema, $r, failFast: true);
        $this->assertCount(1, $errs);
        $this->assertSame(ErrorCode::NOT_INTEGER, $errs[0]->code);
    }

    public function test_validator_fail_fast_string_min_length(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Str' => [
                    'properties' => ['s' => ['type' => 'string', 'minLength' => 2]],
                ],
            ],
        ]);
        $schema = $r->getSchema('x');
        $errs = validate(['_type' => 'Str', 's' => 'a'], $schema->types['Str'], $schema, $r, failFast: true);
        $this->assertCount(1, $errs);
        $this->assertSame(ErrorCode::STRING_TOO_SHORT, $errs[0]->code);
    }

    public function test_validator_fail_fast_string_max_length(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Str' => [
                    'properties' => ['s' => ['type' => 'string', 'maxLength' => 2]],
                ],
            ],
        ]);
        $schema = $r->getSchema('x');
        $errs = validate(['_type' => 'Str', 's' => 'toolong'], $schema->types['Str'], $schema, $r, failFast: true);
        $this->assertCount(1, $errs);
        $this->assertSame(ErrorCode::STRING_TOO_LONG, $errs[0]->code);
    }

    public function test_validator_fail_fast_string_invalid_pattern(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Str' => [
                    'properties' => ['s' => ['type' => 'string', 'pattern' => '(']],
                ],
            ],
        ]);
        $schema = $r->getSchema('x');
        $errs = validate(['_type' => 'Str', 's' => 'a'], $schema->types['Str'], $schema, $r, failFast: true);
        $this->assertCount(1, $errs);
        $this->assertSame(ErrorCode::PATTERN_MISMATCH, $errs[0]->code);
    }

    public function test_validator_fail_fast_string_pattern_mismatch(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Str' => [
                    'properties' => ['s' => ['type' => 'string', 'pattern' => '^a+$']],
                ],
            ],
        ]);
        $schema = $r->getSchema('x');
        $errs = validate(['_type' => 'Str', 's' => 'b'], $schema->types['Str'], $schema, $r, failFast: true);
        $this->assertCount(1, $errs);
        $this->assertSame(ErrorCode::PATTERN_MISMATCH, $errs[0]->code);
    }

    public function test_validator_fail_fast_string_enum_mismatch(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Str' => [
                    'properties' => ['s' => ['type' => 'string', 'enum' => ['a']]],
                ],
            ],
        ]);
        $schema = $r->getSchema('x');
        $errs = validate(['_type' => 'Str', 's' => 'b'], $schema->types['Str'], $schema, $r, failFast: true);
        $this->assertCount(1, $errs);
        $this->assertSame(ErrorCode::ENUM_MISMATCH, $errs[0]->code);
    }

    public function test_validator_fail_fast_number_minimum(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Num' => [
                    'properties' => ['n' => ['type' => 'number', 'minimum' => 0]],
                ],
            ],
        ]);
        $schema = $r->getSchema('x');
        $errs = validate(['_type' => 'Num', 'n' => -1], $schema->types['Num'], $schema, $r, failFast: true);
        $this->assertCount(1, $errs);
        $this->assertSame(ErrorCode::BELOW_MINIMUM, $errs[0]->code);
    }

    public function test_validator_fail_fast_number_maximum(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Num' => [
                    'properties' => ['n' => ['type' => 'number', 'maximum' => 1]],
                ],
            ],
        ]);
        $schema = $r->getSchema('x');
        $errs = validate(['_type' => 'Num', 'n' => 2], $schema->types['Num'], $schema, $r, failFast: true);
        $this->assertCount(1, $errs);
        $this->assertSame(ErrorCode::ABOVE_MAXIMUM, $errs[0]->code);
    }

    public function test_validator_fail_fast_number_exclusive_minimum(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Num' => [
                    'properties' => ['n' => ['type' => 'number', 'exclusiveMinimum' => 0]],
                ],
            ],
        ]);
        $schema = $r->getSchema('x');
        $errs = validate(['_type' => 'Num', 'n' => 0], $schema->types['Num'], $schema, $r, failFast: true);
        $this->assertCount(1, $errs);
        $this->assertSame(ErrorCode::BELOW_EXCLUSIVE_MINIMUM, $errs[0]->code);
    }

    public function test_validator_fail_fast_number_exclusive_maximum(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Num' => [
                    'properties' => ['n' => ['type' => 'number', 'exclusiveMaximum' => 1]],
                ],
            ],
        ]);
        $schema = $r->getSchema('x');
        $errs = validate(['_type' => 'Num', 'n' => 1], $schema->types['Num'], $schema, $r, failFast: true);
        $this->assertCount(1, $errs);
        $this->assertSame(ErrorCode::ABOVE_EXCLUSIVE_MAXIMUM, $errs[0]->code);
    }

    public function test_validator_fail_fast_number_multiple_of(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Num' => [
                    'properties' => ['n' => ['type' => 'number', 'multipleOf' => 2]],
                ],
            ],
        ]);
        $schema = $r->getSchema('x');
        $errs = validate(['_type' => 'Num', 'n' => 3], $schema->types['Num'], $schema, $r, failFast: true);
        $this->assertCount(1, $errs);
        $this->assertSame(ErrorCode::NOT_MULTIPLE_OF, $errs[0]->code);
    }

    public function test_validator_fail_fast_number_enum_mismatch(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Num' => [
                    'properties' => ['n' => ['type' => 'number', 'enum' => [1, 2]]],
                ],
            ],
        ]);
        $schema = $r->getSchema('x');
        $errs = validate(['_type' => 'Num', 'n' => 3], $schema->types['Num'], $schema, $r, failFast: true);
        $this->assertCount(1, $errs);
        $this->assertSame(ErrorCode::ENUM_MISMATCH, $errs[0]->code);
    }

    public function test_validator_unknown_property_kind(): void
    {
        [$r, $schema] = self::animalRegistry();
        $schema->types['Dog']->ownProperties['mystery'] = new \stdClass();
        $errs = validate(
            ['_type' => 'Dog', 'name' => 'Rex', 'breed' => 'Lab', 'mystery' => 'x'],
            $schema->types['Dog'],
            $schema,
            $r,
        );
        $this->assertSame([], $errs);
    }

    public function test_validator_type_ref_cross_schema_resolution(): void
    {
        // Cross-schema TypeRef properties are resolved eagerly at load time (§A.3).
        // This test verifies that a valid instance passes when the imported type is
        // properly loaded and resolved through the registry.
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'https://example.org/schemas/other',
            'types' => [
                'Pet' => [
                    'properties' => ['name' => ['type' => 'string']],
                    'required'   => ['name'],
                ],
            ],
        ]);
        $r->loadDict([
            '$oojs'   => '1.0',
            '$id'     => 'https://example.org/schemas/owner',
            'imports' => ['other' => 'https://example.org/schemas/other'],
            'types'   => [
                'Owner' => [
                    'properties' => ['pet' => ['type' => 'other.Pet']],
                    'required'   => ['pet'],
                ],
            ],
        ]);

        $schema = $r->getSchema('https://example.org/schemas/owner');
        $errs = validate(
            ['_type' => 'Owner', 'pet' => ['_type' => 'Pet', 'name' => 'Fido']],
            $schema->types['Owner'],
            $schema,
            $r,
        );
        $this->assertSame([], $errs);
    }

    public function test_validator_json_kind_matches_null_and_boolean(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Foo' => [
                    'properties' => [
                        'n' => ['type' => 'null'],
                        'b' => ['type' => 'boolean'],
                    ],
                    'required' => ['n', 'b'],
                ],
            ],
        ]);
        $schema = $r->getSchema('x');
        $errs = validate(['_type' => 'Foo', 'n' => null, 'b' => true], $schema->types['Foo'], $schema, $r);
        $this->assertSame([], $errs);
    }

    public function test_validator_json_type_name_branches(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Str' => ['properties' => ['v' => ['type' => 'string']]],
                'Int' => ['properties' => ['v' => ['type' => 'integer']]],
            ],
        ]);
        $schema = $r->getSchema('x');

        $errs = validate(['_type' => 'Str', 'v' => null], $schema->types['Str'], $schema, $r);
        $this->assertTrue($this->hasCodeAndMessage($errs, ErrorCode::TYPE_MISMATCH, 'got null'));

        $errs = validate(['_type' => 'Str', 'v' => true], $schema->types['Str'], $schema, $r);
        $this->assertTrue($this->hasCodeAndMessage($errs, ErrorCode::TYPE_MISMATCH, 'got boolean'));

        $errs = validate(['_type' => 'Str', 'v' => 1.5], $schema->types['Str'], $schema, $r);
        $this->assertTrue($this->hasCodeAndMessage($errs, ErrorCode::TYPE_MISMATCH, 'got number'));

        $errs = validate(['_type' => 'Int', 'v' => 'abc'], $schema->types['Int'], $schema, $r);
        $this->assertTrue($this->hasCodeAndMessage($errs, ErrorCode::TYPE_MISMATCH, 'got string'));

        $errs = validate(['_type' => 'Str', 'v' => new \stdClass()], $schema->types['Str'], $schema, $r);
        $this->assertTrue($this->hasCodeAndMessage($errs, ErrorCode::TYPE_MISMATCH, 'got stdClass'));
    }

    public function test_validator_unique_items_list_sort(): void
    {
        $r = new Registry();
        $r->loadDict([
            '$oojs' => '1.0',
            '$id'   => 'x',
            'types' => [
                'Arr' => [
                    'properties' => [
                        'v' => [
                            'type' => 'array',
                            'items' => ['type' => 'string'],
                            'uniqueItems' => true,
                        ],
                    ],
                ],
            ],
        ]);
        $schema = $r->getSchema('x');
        $errs = validate(
            ['_type' => 'Arr', 'v' => [[1, 2], [1, 2]]],
            $schema->types['Arr'],
            $schema,
            $r,
        );
        $this->assertTrue($this->hasCode($errs, ErrorCode::ARRAY_DUPLICATE_ITEMS));
    }
}
