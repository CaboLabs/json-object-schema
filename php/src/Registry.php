<?php

declare(strict_types=1);

namespace Oojs;

use Oojs\Model\ArrayProperty;
use Oojs\Model\PrimitiveProperty;
use Oojs\Model\PropertyDef;
use Oojs\Model\Schema;
use Oojs\Model\TypeDef;
use Oojs\Model\TypeRefProperty;

/**
 * Holds loaded schemas and indexes types by discriminator value.
 *
 * All schema loading goes through this registry so that cross-schema type
 * references can be resolved.
 */
class Registry
{
    private const TYPE_NAME_RE  = '/^[A-Z][A-Za-z0-9_]*$/';
    private const PROP_NAME_RE  = '/^[a-z_][A-Za-z0-9_]*$/';

    private const PRIMITIVE_TYPES = ['string', 'integer', 'number', 'boolean', 'null'];
    private const RESERVED_TYPE_NAMES = ['string', 'integer', 'number', 'boolean', 'null', 'array'];

    /** @var array<string, Schema> $id → Schema */
    private array $schemas = [];

    /** @var array<string, TypeDef> discriminator value → TypeDef */
    private array $byDv = [];

    // ------------------------------------------------------------------
    // Loading
    // ------------------------------------------------------------------

    /**
     * Load a schema from a JSON file.
     */
    public function loadFile(string $path): Schema
    {
        $text = file_get_contents($path);
        if ($text === false) {
            throw new SchemaError("Cannot read file: $path");
        }
        try {
            $data = json_decode($text, associative: true, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new SchemaError("$path: invalid JSON: {$e->getMessage()}");
        }
        return $this->load($data, $path);
    }

    /**
     * Load a schema from a JSON string.
     */
    public function loadJson(string $text): Schema
    {
        try {
            $data = json_decode($text, associative: true, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new SchemaError("<string>: invalid JSON: {$e->getMessage()}");
        }
        return $this->load($data, '<string>');
    }

    /**
     * Load a schema from a PHP array (already decoded).
     *
     * @param array<string, mixed> $data
     */
    public function loadDict(array $data): Schema
    {
        return $this->load($data, '<dict>');
    }

    /**
     * @param mixed $data
     */
    private function load(mixed $data, string $source): Schema
    {
        if (!is_array($data)) {
            throw new SchemaError("$source: schema must be a JSON object");
        }

        // -- $oojs version -----------------------------------------------
        if (!array_key_exists('$oojs', $data)) {
            throw new SchemaError("$source: missing required field '\$oojs'");
        }
        $oojs = $data['$oojs'];
        if ($oojs !== '1.0') {
            throw new SchemaError("$source: unsupported \$oojs version '$oojs'");
        }

        // -- $id ---------------------------------------------------------
        if (!array_key_exists('$id', $data)) {
            throw new SchemaError("$source: missing required field '\$id'");
        }
        $schemaId = $data['$id'];
        if (!is_string($schemaId) || $schemaId === '') {
            throw new SchemaError("$source: '\$id' must be a non-empty string");
        }

        // Idempotent reload
        if (isset($this->schemas[$schemaId])) {
            return $this->schemas[$schemaId];
        }

        // -- discriminator -----------------------------------------------
        $discriminator = $data['discriminator'] ?? '_type';
        if (!is_string($discriminator) || $discriminator === '') {
            throw new SchemaError("$source: 'discriminator' must be a non-empty string");
        }

        // -- imports -----------------------------------------------------
        $rawImports = [];
        if (array_key_exists('imports', $data)) {
            $imp = $data['imports'];
            if (!is_array($imp)) {
                throw new SchemaError("$source: 'imports' must be an object");
            }
            foreach ($imp as $alias => $uri) {
                $alias = (string)$alias;
                if (!preg_match(self::PROP_NAME_RE, $alias)) {
                    throw new SchemaError("$source: import alias '$alias' violates naming rules");
                }
                if (!is_string($uri)) {
                    throw new SchemaError("$source: import value for alias '$alias' must be a string");
                }
                $rawImports[$alias] = $uri;
            }
        }

        // -- types -------------------------------------------------------
        if (!array_key_exists('types', $data)) {
            throw new SchemaError("$source: missing required field 'types'");
        }
        $rawTypes = $data['types'];
        if (!is_array($rawTypes) || empty($rawTypes)) {
            throw new SchemaError("$source: 'types' must be a non-empty object");
        }

        $schema = new Schema(
            oojsVersion: $oojs,
            schemaId: $schemaId,
            title: $data['title'] ?? '',
            description: $data['description'] ?? '',
            discriminator: $discriminator,
            closedWorld: !($data['additionalProperties'] ?? false),
        );
        $schema->imports = $rawImports;

        // Register early so circular imports don't re-enter
        $this->schemas[$schemaId] = $schema;

        // Parse type definitions (pass 1: names + own properties)
        foreach ($rawTypes as $typeName => $typeData) {
            $typeName = (string)$typeName;
            if (in_array($typeName, self::RESERVED_TYPE_NAMES, strict: true)) {
                throw new SchemaError("$source: '$typeName' is a reserved name");
            }
            if (!preg_match(self::TYPE_NAME_RE, $typeName)) {
                throw new SchemaError("$source: type name '$typeName' violates naming rules");
            }
            $schema->types[$typeName] = $this->parseType($typeName, $typeData, $schema, $source);
        }

        // Check discriminator property name doesn't collide with type properties
        foreach ($schema->types as $typeName => $typedef) {
            if (array_key_exists($discriminator, $typedef->ownProperties)) {
                throw new SchemaError(
                    "$source: type '$typeName' declares property '$discriminator'"
                    . " which collides with the schema discriminator"
                );
            }
        }

        // Resolve extends (pass 2: build the hierarchy)
        $this->resolveHierarchy($schema, $source);

        // Resolve TypeRef property type names to TypeDef objects (pass 3: eager resolution)
        // This ensures broken references are caught at load time, not at validation time (§A.3).
        $this->resolvePropertyTypeRefs($schema, $source);

        // Check required entries reference own properties only
        foreach ($schema->types as $typeName => $typedef) {
            foreach ($typedef->ownRequired as $req) {
                if (!array_key_exists($req, $typedef->ownProperties)) {
                    throw new SchemaError(
                        "$source: type '$typeName' lists '$req' in 'required'"
                        . " but it is not declared in own 'properties'"
                    );
                }
            }
        }

        // Check for property name redeclaration (inherited ∩ own must be empty)
        foreach ($schema->types as $typeName => $typedef) {
            if ($typedef->supertype !== null) {
                $inherited = array_keys($typedef->supertype->effectiveProperties());
                $own = array_keys($typedef->ownProperties);
                $overlap = array_intersect($own, $inherited);
                if (!empty($overlap)) {
                    sort($overlap);
                    throw new SchemaError(
                        "$source: type '$typeName' redeclares inherited properties: "
                        . json_encode(array_values($overlap))
                    );
                }
            }
        }

        // Index types by discriminator value + uniqueness check
        foreach ($schema->types as $typeName => $typedef) {
            $dv = $typedef->getEffectiveDiscriminatorValue();
            if (isset($this->byDv[$dv])) {
                $existing = $this->byDv[$dv];
                if ($existing !== $typedef) {
                    throw new SchemaError(
                        "$source: discriminator value '$dv' is already used by"
                        . " type '{$existing->name}' in schema '{$existing->schemaId}'"
                    );
                }
            }
            $this->byDv[$dv] = $typedef;
        }

        return $schema;
    }

    // ------------------------------------------------------------------
    // Type parsing
    // ------------------------------------------------------------------

    /**
     * @param mixed $data
     */
    private function parseType(string $name, mixed $data, Schema $schema, string $source): TypeDef
    {
        if (!is_array($data)) {
            throw new SchemaError("$source: type '$name' definition must be a JSON object");
        }

        $extends = $data['extends'] ?? null;
        if ($extends !== null && !is_string($extends)) {
            throw new SchemaError("$source: type '$name' 'extends' must be a string");
        }

        $abstract = $data['abstract'] ?? false;
        if (!is_bool($abstract)) {
            throw new SchemaError("$source: type '$name' 'abstract' must be a boolean");
        }

        $dv = $data['discriminatorValue'] ?? null;
        if ($dv !== null && !is_string($dv)) {
            throw new SchemaError("$source: type '$name' 'discriminatorValue' must be a string");
        }

        // properties
        $ownProps = [];
        $rawProps = $data['properties'] ?? [];
        if (!is_array($rawProps)) {
            throw new SchemaError("$source: type '$name' 'properties' must be an object");
        }
        foreach ($rawProps as $propName => $propData) {
            $propName = (string)$propName;
            if (!preg_match(self::PROP_NAME_RE, $propName)) {
                throw new SchemaError(
                    "$source: property '$propName' in type '$name' violates naming rules"
                );
            }
            $ownProps[$propName] = $this->parseProperty($propName, $propData, $name, $source);
        }

        // required
        $ownRequired = [];
        $rawRequired = $data['required'] ?? [];
        if (!is_array($rawRequired)) {
            throw new SchemaError("$source: type '$name' 'required' must be an array");
        }
        foreach ($rawRequired as $req) {
            if (!is_string($req)) {
                throw new SchemaError("$source: type '$name' 'required' entries must be strings");
            }
            if (in_array($req, $ownRequired, strict: true)) {
                throw new SchemaError("$source: type '$name' 'required' lists '$req' more than once");
            }
            $ownRequired[] = $req;
        }

        $typedef = new TypeDef(
            name: $name,
            schemaId: $schema->schemaId,
            abstract: $abstract,
            extends: $extends,
            discriminatorValue: $dv,
            title: $data['title'] ?? '',
            description: $data['description'] ?? '',
        );
        $typedef->ownProperties = $ownProps;
        $typedef->ownRequired = $ownRequired;

        return $typedef;
    }

    /**
     * @param mixed $data
     */
    private function parseProperty(string $propName, mixed $data, string $typeName, string $source): PropertyDef
    {
        if (!is_array($data)) {
            throw new SchemaError(
                "$source: property '$propName' in type '$typeName' must be a JSON object"
            );
        }

        if (!array_key_exists('type', $data)) {
            throw new SchemaError(
                "$source: property '$propName' in type '$typeName' missing 'type'"
            );
        }
        $kind = $data['type'];
        if (!is_string($kind)) {
            throw new SchemaError(
                "$source: property '$propName' in type '$typeName' 'type' must be a string"
            );
        }

        if ($kind === 'array') {
            return $this->parseArrayProperty($propName, $data, $typeName, $source);
        }
        if (in_array($kind, self::PRIMITIVE_TYPES, strict: true)) {
            return $this->parsePrimitiveProperty($propName, $data, $typeName, $source);
        }
        // Type reference
        return new TypeRefProperty(
            typeName: $kind,
            title: $data['title'] ?? '',
            description: $data['description'] ?? '',
        );
    }

    /**
     * @param array<string, mixed> $data
     */
    private function parsePrimitiveProperty(
        string $propName,
        array $data,
        string $typeName,
        string $source,
    ): PrimitiveProperty {
        $kind = $data['type'];

        // Helper: read a non-negative integer constraint
        $intGeZero = function (string $key) use ($data, $propName, $typeName, $source): ?int {
            $v = $data[$key] ?? null;
            if ($v === null) {
                return null;
            }
            if (!is_int($v) || $v < 0) {
                throw new SchemaError(
                    "$source: '$key' on property '$propName' in '$typeName'"
                    . " must be a non-negative integer"
                );
            }
            return $v;
        };

        // Helper: read a numeric constraint
        $number = function (string $key) use ($data, $propName, $typeName, $source): ?float {
            $v = $data[$key] ?? null;
            if ($v === null) {
                return null;
            }
            if (is_bool($v) || (!is_int($v) && !is_float($v))) {
                throw new SchemaError(
                    "$source: '$key' on property '$propName' in '$typeName' must be a number"
                );
            }
            return (float)$v;
        };

        $minLength = null;
        $maxLength = null;
        $pattern = null;
        $format = null;
        $minimum = null;
        $maximum = null;
        $exclusiveMinimum = null;
        $exclusiveMaximum = null;
        $multipleOf = null;
        $enum = null;

        if ($kind === 'string') {
            $minLength = $intGeZero('minLength');
            $maxLength = $intGeZero('maxLength');
            if ($minLength !== null && $maxLength !== null && $minLength > $maxLength) {
                throw new SchemaError(
                    "$source: 'minLength' > 'maxLength' on '$propName' in '$typeName'"
                );
            }
            $rawPattern = $data['pattern'] ?? null;
            if ($rawPattern !== null) {
                if (!is_string($rawPattern)) {
                    throw new SchemaError("$source: 'pattern' on '$propName' must be a string");
                }
                $pattern = $rawPattern;
            }
            $format = isset($data['format']) && is_string($data['format']) ? $data['format'] : null;
            $rawEnum = $data['enum'] ?? null;
            if ($rawEnum !== null) {
                if (!is_array($rawEnum) || empty($rawEnum)) {
                    throw new SchemaError("$source: 'enum' on '$propName' must be a non-empty array");
                }
                $enum = array_values($rawEnum);
            }
        } elseif ($kind === 'integer' || $kind === 'number') {
            $minimum = $number('minimum');
            $maximum = $number('maximum');
            $exclusiveMinimum = $number('exclusiveMinimum');
            $exclusiveMaximum = $number('exclusiveMaximum');
            if ($minimum !== null && $exclusiveMinimum !== null) {
                throw new SchemaError(
                    "$source: 'minimum' and 'exclusiveMinimum' are mutually exclusive"
                    . " on '$propName' in '$typeName'"
                );
            }
            if ($maximum !== null && $exclusiveMaximum !== null) {
                throw new SchemaError(
                    "$source: 'maximum' and 'exclusiveMaximum' are mutually exclusive"
                    . " on '$propName' in '$typeName'"
                );
            }
            $mo = $data['multipleOf'] ?? null;
            if ($mo !== null) {
                if (is_bool($mo) || (!is_int($mo) && !is_float($mo)) || $mo <= 0) {
                    throw new SchemaError("$source: 'multipleOf' on '$propName' must be > 0");
                }
                $multipleOf = (float)$mo;
            }
            $rawEnum = $data['enum'] ?? null;
            if ($rawEnum !== null) {
                if (!is_array($rawEnum) || empty($rawEnum)) {
                    throw new SchemaError("$source: 'enum' on '$propName' must be a non-empty array");
                }
                $enum = array_values($rawEnum);
            }
        }

        return new PrimitiveProperty(
            kind: $kind,
            title: $data['title'] ?? '',
            description: $data['description'] ?? '',
            minLength: $minLength,
            maxLength: $maxLength,
            pattern: $pattern,
            format: $format,
            minimum: $minimum,
            maximum: $maximum,
            exclusiveMinimum: $exclusiveMinimum,
            exclusiveMaximum: $exclusiveMaximum,
            multipleOf: $multipleOf,
            enum: $enum,
        );
    }

    /**
     * @param array<string, mixed> $data
     */
    private function parseArrayProperty(
        string $propName,
        array $data,
        string $typeName,
        string $source,
    ): ArrayProperty {
        if (!array_key_exists('items', $data)) {
            throw new SchemaError(
                "$source: array property '$propName' in '$typeName' missing 'items'"
            );
        }
        $items = $this->parseProperty($propName . '.items', $data['items'], $typeName, $source);
        if ($items instanceof ArrayProperty) {
            throw new SchemaError(
                "$source: nested arrays are not supported in v1.0"
                . " (property '$propName' in '$typeName')"
            );
        }

        $intGeZero = function (string $key) use ($data, $propName, $typeName, $source): ?int {
            $v = $data[$key] ?? null;
            if ($v === null) {
                return null;
            }
            if (!is_int($v) || $v < 0) {
                throw new SchemaError(
                    "$source: '$key' on '$propName' in '$typeName' must be a non-negative integer"
                );
            }
            return $v;
        };

        $minItems = $intGeZero('minItems') ?? 0;
        $maxItems = $intGeZero('maxItems');
        if ($maxItems !== null && $minItems > $maxItems) {
            throw new SchemaError("$source: 'minItems' > 'maxItems' on '$propName' in '$typeName'");
        }

        $unique = $data['uniqueItems'] ?? false;
        if (!is_bool($unique)) {
            throw new SchemaError("$source: 'uniqueItems' on '$propName' must be a boolean");
        }

        return new ArrayProperty(
            items: $items,
            minItems: $minItems,
            maxItems: $maxItems,
            uniqueItems: $unique,
            title: $data['title'] ?? '',
            description: $data['description'] ?? '',
        );
    }

    // ------------------------------------------------------------------
    // Hierarchy resolution
    // ------------------------------------------------------------------

    private function resolveHierarchy(Schema $schema, string $source): void
    {
        foreach ($schema->types as $typeName => $typedef) {
            if ($typedef->extends !== null) {
                $parent = $this->resolveTypeRef(
                    $typedef->extends, $schema, $source, "type '$typeName'"
                );
                $typedef->supertype = $parent;
            }
        }

        // Cycle detection: every type must reach root without revisiting
        foreach ($schema->types as $typeName => $typedef) {
            $visited = [];
            $current = $typedef;
            while ($current !== null) {
                $key = $current->schemaId . '#' . $current->name;
                if (in_array($key, $visited, strict: true)) {
                    throw new SchemaError(
                        "$source: inheritance cycle detected involving type '$typeName'"
                    );
                }
                $visited[] = $key;
                $current = $current->supertype;
            }
        }
    }

    /**
     * Eagerly resolve all TypeRefProperty type-name strings to TypeDef objects (§A.3).
     * Iterates every own property of every type in the schema; for arrays, recurses
     * into the items property. Reports a load error for any unresolvable reference.
     */
    private function resolvePropertyTypeRefs(Schema $schema, string $source): void
    {
        foreach ($schema->types as $typeName => $typedef) {
            foreach ($typedef->ownProperties as $propName => $prop) {
                $this->resolvePropertyTypeRef($prop, $schema, $source, "type '$typeName', property '$propName'");
            }
        }
    }

    private function resolvePropertyTypeRef(
        PropertyDef $prop,
        Schema $schema,
        string $source,
        string $context,
    ): void {
        if ($prop instanceof TypeRefProperty) {
            $prop->resolvedType = $this->resolveTypeRef($prop->typeName, $schema, $source, $context);
        } elseif ($prop instanceof ArrayProperty) {
            $this->resolvePropertyTypeRef($prop->items, $schema, $source, $context . '.items');
        }
        // PrimitiveProperty has no type references to resolve
    }

    private function resolveTypeRef(
        string $ref,
        Schema $schema,
        string $source,
        string $context = '',
    ): TypeDef {
        if (str_contains($ref, '.')) {
            [$alias, $name] = explode('.', $ref, 2);
            $importedId = $schema->imports[$alias] ?? null;
            if ($importedId === null) {
                throw new SchemaError("$source: $context: unknown import alias '$alias'");
            }
            $importedSchema = $this->schemas[$importedId] ?? null;
            if ($importedSchema === null) {
                throw new SchemaError(
                    "$source: $context: imported schema '$importedId'"
                    . " (alias '$alias') is not loaded"
                );
            }
            $typedef = $importedSchema->types[$name] ?? null;
            if ($typedef === null) {
                throw new SchemaError(
                    "$source: $context: type '$name' not found in schema '$importedId'"
                );
            }
            return $typedef;
        }

        $typedef = $schema->types[$ref] ?? null;
        if ($typedef === null) {
            throw new SchemaError(
                "$source: $context: type '$ref' not found in schema '{$schema->schemaId}'"
            );
        }
        return $typedef;
    }

    // ------------------------------------------------------------------
    // Public lookup API
    // ------------------------------------------------------------------

    public function getSchema(string $schemaId): ?Schema
    {
        return $this->schemas[$schemaId] ?? null;
    }

    public function lookupByDiscriminatorValue(string $dv): ?TypeDef
    {
        return $this->byDv[$dv] ?? null;
    }

    /**
     * Resolve a type name (possibly qualified) in the context of the given schema.
     * Returns null if the type cannot be found.
     */
    public function resolveType(string $name, Schema $schema): ?TypeDef
    {
        try {
            return $this->resolveTypeRef($name, $schema, '<lookup>');
        } catch (SchemaError) {
            return null;
        }
    }

    /**
     * Resolve a type name in the context of a schema identified by $schemaId.
     * Returns null if the schema or type cannot be found.
     */
    public function resolveTypeIn(string $name, string $schemaId): ?TypeDef
    {
        $schema = $this->schemas[$schemaId] ?? null;
        if ($schema === null) {
            return null;
        }
        try {
            return $this->resolveTypeRef($name, $schema, '<lookup>');
        } catch (SchemaError) {
            return null;
        }
    }
}
