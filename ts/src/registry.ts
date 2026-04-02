/**
 * OOJS schema loader and registry.
 */

import {
  PRIMITIVE_TYPES,
  ArrayProperty,
  PrimitiveProperty,
  PrimitivePropertyParams,
  Schema,
  TypeDef,
  TypeRefProperty,
  PropertyDef,
} from './model.js';

// ---------------------------------------------------------------------------
// Naming rules (§11)
// ---------------------------------------------------------------------------

const TYPE_NAME_RE  = /^[A-Z][A-Za-z0-9_]*$/;
const PROP_NAME_RE  = /^[a-z_][A-Za-z0-9_]*$/;
const RESERVED_TYPE_NAMES = new Set([...PRIMITIVE_TYPES, 'array']);

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// SchemaError
// ---------------------------------------------------------------------------

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaError';
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class Registry {
  private _schemas: Record<string, Schema> = {};
  private _byDv: Record<string, TypeDef> = {};

  // ------------------------------------------------------------------
  // Loading
  // ------------------------------------------------------------------

  async loadFile(url: string): Promise<Schema> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new SchemaError(`${url}: HTTP ${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    return this.loadJson(text, url);
  }

  loadJson(text: string, source = '<string>'): Schema {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e: unknown) {
      throw new SchemaError(`${source}: invalid JSON: ${(e as Error).message}`);
    }
    return this._load(data, source);
  }

  loadDict(data: unknown): Schema {
    return this._load(data, '<dict>');
  }

  private _load(data: unknown, source: string): Schema {
    if (!isObj(data)) {
      throw new SchemaError(`${source}: schema must be a JSON object`);
    }

    if (!Object.prototype.hasOwnProperty.call(data, '$oojs')) {
      throw new SchemaError(`${source}: missing required field '$oojs'`);
    }
    const oojs = data['$oojs'];
    if (oojs !== '1.0') {
      throw new SchemaError(`${source}: unsupported $oojs version '${oojs}'`);
    }

    if (!Object.prototype.hasOwnProperty.call(data, '$id')) {
      throw new SchemaError(`${source}: missing required field '$id'`);
    }
    const schemaId = data['$id'];
    if (typeof schemaId !== 'string' || schemaId === '') {
      throw new SchemaError(`${source}: '$id' must be a non-empty string`);
    }

    if (Object.prototype.hasOwnProperty.call(this._schemas, schemaId)) {
      return this._schemas[schemaId];
    }

    const discriminatorRaw = Object.prototype.hasOwnProperty.call(data, 'discriminator')
      ? data.discriminator
      : '_type';
    if (typeof discriminatorRaw !== 'string' || discriminatorRaw === '') {
      throw new SchemaError(`${source}: 'discriminator' must be a non-empty string`);
    }
    const discriminator = discriminatorRaw;

    const rawImports: Record<string, string> = {};
    if (Object.prototype.hasOwnProperty.call(data, 'imports')) {
      const imp = data.imports;
      if (!isObj(imp)) {
        throw new SchemaError(`${source}: 'imports' must be an object`);
      }
      for (const [alias, uri] of Object.entries(imp)) {
        if (!PROP_NAME_RE.test(alias)) {
          throw new SchemaError(`${source}: import alias '${alias}' violates naming rules`);
        }
        if (typeof uri !== 'string') {
          throw new SchemaError(`${source}: import value for alias '${alias}' must be a string`);
        }
        rawImports[alias] = uri;
      }
    }

    if (!Object.prototype.hasOwnProperty.call(data, 'types')) {
      throw new SchemaError(`${source}: missing required field 'types'`);
    }
    const rawTypes = data.types;
    if (!isObj(rawTypes) || Object.keys(rawTypes).length === 0) {
      throw new SchemaError(`${source}: 'types' must be a non-empty object`);
    }

    const schema = new Schema({
      oojsVersion: oojs as string,
      schemaId,
      title: (data.title as string) ?? '',
      description: (data.description as string) ?? '',
      discriminator,
      closedWorld: !((data.additionalProperties as boolean) ?? false),
    });
    schema.imports = rawImports;

    this._schemas[schemaId] = schema;

    // Pass 1: parse type definitions
    for (const [typeName, typeData] of Object.entries(rawTypes)) {
      if (RESERVED_TYPE_NAMES.has(typeName)) {
        throw new SchemaError(`${source}: '${typeName}' is a reserved name`);
      }
      if (!TYPE_NAME_RE.test(typeName)) {
        throw new SchemaError(`${source}: type name '${typeName}' violates naming rules`);
      }
      schema.types[typeName] = this._parseType(typeName, typeData, schema, source);
    }

    // Check discriminator doesn't collide with type properties
    for (const [typeName, typedef] of Object.entries(schema.types)) {
      if (Object.prototype.hasOwnProperty.call(typedef.ownProperties, discriminator)) {
        throw new SchemaError(
          `${source}: type '${typeName}' declares property '${discriminator}' ` +
          `which collides with the schema discriminator`,
        );
      }
    }

    // Pass 2: resolve extends hierarchy
    this._resolveHierarchy(schema, source);

    // Pass 3: eagerly resolve TypeRef property type names to TypeDef objects.
    // Broken references are caught at load time, not deferred to validation (§A.3).
    this._resolvePropertyTypeRefs(schema, source);

    // Check required entries reference own properties only
    for (const [typeName, typedef] of Object.entries(schema.types)) {
      for (const req of typedef.ownRequired) {
        if (!Object.prototype.hasOwnProperty.call(typedef.ownProperties, req)) {
          throw new SchemaError(
            `${source}: type '${typeName}' lists '${req}' in 'required' ` +
            `but it is not declared in own 'properties'`,
          );
        }
      }
    }

    // Check for property redeclaration
    for (const [typeName, typedef] of Object.entries(schema.types)) {
      if (typedef.supertype !== null) {
        const inherited = new Set(Object.keys(typedef.supertype.effectiveProperties()));
        const overlap = Object.keys(typedef.ownProperties).filter(k => inherited.has(k));
        if (overlap.length > 0) {
          throw new SchemaError(
            `${source}: type '${typeName}' redeclares inherited properties: ` +
            JSON.stringify(overlap.sort()),
          );
        }
      }
    }

    // Index by discriminator value
    for (const typedef of Object.values(schema.types)) {
      const dv = typedef.getEffectiveDiscriminatorValue();
      if (Object.prototype.hasOwnProperty.call(this._byDv, dv)) {
        const existing = this._byDv[dv];
        if (existing !== typedef) {
          throw new SchemaError(
            `${source}: discriminator value '${dv}' is already used by ` +
            `type '${existing.name}' in schema '${existing.schemaId}'`,
          );
        }
      }
      this._byDv[dv] = typedef;
    }

    return schema;
  }

  // ------------------------------------------------------------------
  // Type parsing
  // ------------------------------------------------------------------

  private _parseType(name: string, data: unknown, schema: Schema, source: string): TypeDef {
    if (!isObj(data)) {
      throw new SchemaError(`${source}: type '${name}' definition must be a JSON object`);
    }

    const extendsRef = (data.extends as string) ?? null;
    if (extendsRef !== null && typeof extendsRef !== 'string') {
      throw new SchemaError(`${source}: type '${name}' 'extends' must be a string`);
    }

    const isAbstract = (data.abstract as boolean) ?? false;
    if (typeof isAbstract !== 'boolean') {
      throw new SchemaError(`${source}: type '${name}' 'abstract' must be a boolean`);
    }

    const dv = (data.discriminatorValue as string) ?? null;
    if (dv !== null && typeof dv !== 'string') {
      throw new SchemaError(`${source}: type '${name}' 'discriminatorValue' must be a string`);
    }

    const ownProps: Record<string, PropertyDef> = {};
    const rawProps = (data.properties as Record<string, unknown>) ?? {};
    if (!isObj(rawProps)) {
      throw new SchemaError(`${source}: type '${name}' 'properties' must be an object`);
    }
    for (const [propName, propData] of Object.entries(rawProps)) {
      if (!PROP_NAME_RE.test(propName)) {
        throw new SchemaError(
          `${source}: property '${propName}' in type '${name}' violates naming rules`,
        );
      }
      ownProps[propName] = this._parseProperty(propName, propData, name, source);
    }

    const ownRequired: string[] = [];
    const rawRequired = (data.required as unknown[]) ?? [];
    if (!Array.isArray(rawRequired)) {
      throw new SchemaError(`${source}: type '${name}' 'required' must be an array`);
    }
    for (const req of rawRequired) {
      if (typeof req !== 'string') {
        throw new SchemaError(`${source}: type '${name}' 'required' entries must be strings`);
      }
      if (ownRequired.includes(req)) {
        throw new SchemaError(`${source}: type '${name}' 'required' lists '${req}' more than once`);
      }
      ownRequired.push(req);
    }

    const typedef = new TypeDef({
      name,
      schemaId: schema.schemaId,
      isAbstract,
      extendsRef,
      discriminatorValue: dv,
      title: (data.title as string) ?? '',
      description: (data.description as string) ?? '',
    });
    typedef.ownProperties = ownProps;
    typedef.ownRequired = ownRequired;
    return typedef;
  }

  private _parseProperty(propName: string, data: unknown, typeName: string, source: string): PropertyDef {
    if (!isObj(data)) {
      throw new SchemaError(
        `${source}: property '${propName}' in type '${typeName}' must be a JSON object`,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(data, 'type')) {
      throw new SchemaError(
        `${source}: property '${propName}' in type '${typeName}' missing 'type'`,
      );
    }
    const kind = data.type;
    if (typeof kind !== 'string') {
      throw new SchemaError(
        `${source}: property '${propName}' in type '${typeName}' 'type' must be a string`,
      );
    }

    if (kind === 'array') return this._parseArrayProperty(propName, data, typeName, source);
    if (PRIMITIVE_TYPES.has(kind)) return this._parsePrimitiveProperty(propName, data, typeName, source);
    return new TypeRefProperty({ typeName: kind, title: (data.title as string) ?? '', description: (data.description as string) ?? '' });
  }

  private _parsePrimitiveProperty(propName: string, data: Record<string, unknown>, typeName: string, source: string): PrimitiveProperty {
    const kind = data.type as string;

    const intGeZero = (key: string): number | null => {
      const v = data[key];
      if (v == null) return null;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
        throw new SchemaError(
          `${source}: '${key}' on property '${propName}' in '${typeName}' must be a non-negative integer`,
        );
      }
      return v;
    };

    const num = (key: string): number | null => {
      const v = data[key];
      if (v == null) return null;
      if (typeof v !== 'number') {
        throw new SchemaError(
          `${source}: '${key}' on property '${propName}' in '${typeName}' must be a number`,
        );
      }
      return v;
    };

    const params: Record<string, unknown> = { kind, title: data.title ?? '', description: data.description ?? '' };

    if (kind === 'string') {
      params.minLength = intGeZero('minLength');
      params.maxLength = intGeZero('maxLength');
      if (params.minLength != null && params.maxLength != null && (params.minLength as number) > (params.maxLength as number)) {
        throw new SchemaError(`${source}: 'minLength' > 'maxLength' on '${propName}' in '${typeName}'`);
      }
      if (data.pattern != null) {
        if (typeof data.pattern !== 'string') {
          throw new SchemaError(`${source}: 'pattern' on '${propName}' must be a string`);
        }
        params.pattern = data.pattern;
      }
      if (data.format != null) params.format = data.format;
      if (data.enum != null) {
        if (!Array.isArray(data.enum) || data.enum.length === 0) {
          throw new SchemaError(`${source}: 'enum' on '${propName}' must be a non-empty array`);
        }
        params.enum = data.enum;
      }
    } else if (kind === 'integer' || kind === 'number') {
      params.minimum = num('minimum');
      params.maximum = num('maximum');
      params.exclusiveMinimum = num('exclusiveMinimum');
      params.exclusiveMaximum = num('exclusiveMaximum');
      if (params.minimum != null && params.exclusiveMinimum != null) {
        throw new SchemaError(
          `${source}: 'minimum' and 'exclusiveMinimum' are mutually exclusive on '${propName}' in '${typeName}'`,
        );
      }
      if (params.maximum != null && params.exclusiveMaximum != null) {
        throw new SchemaError(
          `${source}: 'maximum' and 'exclusiveMaximum' are mutually exclusive on '${propName}' in '${typeName}'`,
        );
      }
      if (data.multipleOf != null) {
        if (typeof data.multipleOf !== 'number' || data.multipleOf <= 0) {
          throw new SchemaError(`${source}: 'multipleOf' on '${propName}' must be > 0`);
        }
        params.multipleOf = data.multipleOf;
      }
      if (data.enum != null) {
        if (!Array.isArray(data.enum) || data.enum.length === 0) {
          throw new SchemaError(`${source}: 'enum' on '${propName}' must be a non-empty array`);
        }
        params.enum = data.enum;
      }
    }

    return new PrimitiveProperty(params as unknown as PrimitivePropertyParams);
  }

  private _parseArrayProperty(propName: string, data: Record<string, unknown>, typeName: string, source: string): ArrayProperty {
    if (!Object.prototype.hasOwnProperty.call(data, 'items')) {
      throw new SchemaError(
        `${source}: array property '${propName}' in '${typeName}' missing 'items'`,
      );
    }
    const items = this._parseProperty(`${propName}.items`, data.items, typeName, source);
    if (items instanceof ArrayProperty) {
      throw new SchemaError(
        `${source}: nested arrays are not supported in v1.0 (property '${propName}' in '${typeName}')`,
      );
    }

    const intGeZero = (key: string): number | null => {
      const v = data[key];
      if (v == null) return null;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
        throw new SchemaError(
          `${source}: '${key}' on '${propName}' in '${typeName}' must be a non-negative integer`,
        );
      }
      return v;
    };

    const minItems = intGeZero('minItems') ?? 0;
    const maxItems = intGeZero('maxItems');
    if (maxItems != null && minItems > maxItems) {
      throw new SchemaError(`${source}: 'minItems' > 'maxItems' on '${propName}' in '${typeName}'`);
    }

    const uniqueItems = (data.uniqueItems as boolean) ?? false;
    if (typeof uniqueItems !== 'boolean') {
      throw new SchemaError(`${source}: 'uniqueItems' on '${propName}' must be a boolean`);
    }

    return new ArrayProperty({
      items: items as PrimitiveProperty | TypeRefProperty,
      minItems,
      maxItems,
      uniqueItems,
      title: (data.title as string) ?? '',
      description: (data.description as string) ?? '',
    });
  }

  // ------------------------------------------------------------------
  // Property type-reference resolution (pass 3)
  // ------------------------------------------------------------------

  private _resolvePropertyTypeRefs(schema: Schema, source: string): void {
    for (const [typeName, typedef] of Object.entries(schema.types)) {
      for (const [propName, prop] of Object.entries(typedef.ownProperties)) {
        this._resolvePropertyTypeRef(prop, schema, source, `type '${typeName}', property '${propName}'`);
      }
    }
  }

  private _resolvePropertyTypeRef(prop: PropertyDef, schema: Schema, source: string, context: string): void {
    if (prop instanceof TypeRefProperty) {
      prop.resolvedType = this._resolveTypeRef(prop.typeName, schema, source, context);
    } else if (prop instanceof ArrayProperty) {
      this._resolvePropertyTypeRef(prop.items, schema, source, `${context}.items`);
    }
    // PrimitiveProperty has no type references to resolve
  }

  // ------------------------------------------------------------------
  // Hierarchy resolution
  // ------------------------------------------------------------------

  private _resolveHierarchy(schema: Schema, source: string): void {
    for (const [typeName, typedef] of Object.entries(schema.types)) {
      if (typedef.extendsRef !== null) {
        typedef.supertype = this._resolveTypeRef(typedef.extendsRef, schema, source, `type '${typeName}'`);
      }
    }

    for (const [typeName, typedef] of Object.entries(schema.types)) {
      const visited = new Set<string>();
      let current: TypeDef | null = typedef;
      while (current !== null) {
        const key = `${current.schemaId}#${current.name}`;
        if (visited.has(key)) {
          throw new SchemaError(
            `${source}: inheritance cycle detected involving type '${typeName}'`,
          );
        }
        visited.add(key);
        current = current.supertype;
      }
    }
  }

  private _resolveTypeRef(ref: string, schema: Schema, source: string, context = ''): TypeDef {
    if (ref.includes('.')) {
      const dot = ref.indexOf('.');
      const alias = ref.slice(0, dot);
      const name = ref.slice(dot + 1);
      const importedId = schema.imports[alias];
      if (importedId == null) {
        throw new SchemaError(`${source}: ${context}: unknown import alias '${alias}'`);
      }
      const importedSchema = this._schemas[importedId];
      if (importedSchema == null) {
        throw new SchemaError(
          `${source}: ${context}: imported schema '${importedId}' (alias '${alias}') is not loaded`,
        );
      }
      const typedef = importedSchema.types[name];
      if (typedef == null) {
        throw new SchemaError(`${source}: ${context}: type '${name}' not found in schema '${importedId}'`);
      }
      return typedef;
    }

    const typedef = schema.types[ref];
    if (typedef == null) {
      throw new SchemaError(`${source}: ${context}: type '${ref}' not found in schema '${schema.schemaId}'`);
    }
    return typedef;
  }

  // ------------------------------------------------------------------
  // Public lookup API
  // ------------------------------------------------------------------

  getSchema(schemaId: string): Schema | undefined {
    return this._schemas[schemaId];
  }

  lookupByDiscriminatorValue(dv: string): TypeDef | undefined {
    return this._byDv[dv];
  }

  resolveTypeIn(name: string, schemaId: string): TypeDef | null {
    const schema = this._schemas[schemaId];
    if (!schema) return null;
    try { return this._resolveTypeRef(name, schema, '<lookup>'); }
    catch { return null; }
  }

  getSchemaForType(typedef: TypeDef): Schema | undefined {
    return this._schemas[typedef.schemaId];
  }
}
