/**
 * OOJS schema loader and registry.
 * @module registry
 */

import {
  PRIMITIVE_TYPES,
  ArrayProperty,
  PrimitiveProperty,
  Schema,
  TypeDef,
  TypeRefProperty,
} from './model.js';

// ---------------------------------------------------------------------------
// Naming rules (§11)
// ---------------------------------------------------------------------------

const TYPE_NAME_RE  = /^[A-Z][A-Za-z0-9_]*$/;
const PROP_NAME_RE  = /^[a-z_][A-Za-z0-9_]*$/;
const RESERVED_TYPE_NAMES = new Set([...PRIMITIVE_TYPES, 'array']);

/** Returns true if value is a plain object (not null, not an array). */
function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// SchemaError
// ---------------------------------------------------------------------------

/**
 * Thrown when a schema document is structurally invalid.
 */
export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchemaError';
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Holds loaded schemas and indexes types by discriminator value.
 */
export class Registry {
  constructor() {
    /** @type {Record<string, Schema>} $id → Schema */
    this._schemas = {};
    /** @type {Record<string, TypeDef>} discriminator value → TypeDef */
    this._byDv = {};
  }

  // ------------------------------------------------------------------
  // Loading
  // ------------------------------------------------------------------

  /**
   * Fetch a schema from a URL and load it.
   * Returns a Promise that resolves to the Schema.
   * @param {string} url
   * @returns {Promise<Schema>}
   */
  async loadFile(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new SchemaError(`${url}: HTTP ${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    return this.loadJson(text, url);
  }

  /**
   * Parse a JSON string and load the schema.
   * @param {string} text
   * @param {string} [source]
   * @returns {Schema}
   */
  loadJson(text, source = '<string>') {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new SchemaError(`${source}: invalid JSON: ${e.message}`);
    }
    return this._load(data, source);
  }

  /**
   * Load a schema from a plain JavaScript object.
   * @param {object} data
   * @returns {Schema}
   */
  loadDict(data) {
    return this._load(data, '<dict>');
  }

  /** @param {unknown} data @param {string} source @returns {Schema} */
  _load(data, source) {
    if (!isObj(data)) {
      throw new SchemaError(`${source}: schema must be a JSON object`);
    }

    // -- $oojs version ---------------------------------------------------
    if (!Object.prototype.hasOwnProperty.call(data, '$oojs')) {
      throw new SchemaError(`${source}: missing required field '$oojs'`);
    }
    const oojs = data['$oojs'];
    if (oojs !== '1.0') {
      throw new SchemaError(`${source}: unsupported $oojs version '${oojs}'`);
    }

    // -- $id -------------------------------------------------------------
    if (!Object.prototype.hasOwnProperty.call(data, '$id')) {
      throw new SchemaError(`${source}: missing required field '$id'`);
    }
    const schemaId = data['$id'];
    if (typeof schemaId !== 'string' || schemaId === '') {
      throw new SchemaError(`${source}: '$id' must be a non-empty string`);
    }

    // Idempotent reload
    if (Object.prototype.hasOwnProperty.call(this._schemas, schemaId)) {
      return this._schemas[schemaId];
    }

    // -- discriminator ---------------------------------------------------
    const discriminator = Object.prototype.hasOwnProperty.call(data, 'discriminator')
      ? data.discriminator
      : '_type';
    if (typeof discriminator !== 'string' || discriminator === '') {
      throw new SchemaError(`${source}: 'discriminator' must be a non-empty string`);
    }

    // -- imports ---------------------------------------------------------
    const rawImports = {};
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

    // -- types -----------------------------------------------------------
    if (!Object.prototype.hasOwnProperty.call(data, 'types')) {
      throw new SchemaError(`${source}: missing required field 'types'`);
    }
    const rawTypes = data.types;
    if (!isObj(rawTypes) || Object.keys(rawTypes).length === 0) {
      throw new SchemaError(`${source}: 'types' must be a non-empty object`);
    }

    const schema = new Schema({
      oojsVersion: oojs,
      schemaId,
      title: data.title ?? '',
      description: data.description ?? '',
      discriminator,
      closedWorld: !(data.additionalProperties ?? false),
    });
    schema.imports = rawImports;

    // Register early so circular imports don't re-enter
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

    // Check for property redeclaration (inherited ∩ own must be ∅)
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

    // Index types by discriminator value + uniqueness check
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

  _parseType(name, data, schema, source) {
    if (!isObj(data)) {
      throw new SchemaError(`${source}: type '${name}' definition must be a JSON object`);
    }

    const extendsRef = data.extends ?? null;
    if (extendsRef !== null && typeof extendsRef !== 'string') {
      throw new SchemaError(`${source}: type '${name}' 'extends' must be a string`);
    }

    const isAbstract = data.abstract ?? false;
    if (typeof isAbstract !== 'boolean') {
      throw new SchemaError(`${source}: type '${name}' 'abstract' must be a boolean`);
    }

    const dv = data.discriminatorValue ?? null;
    if (dv !== null && typeof dv !== 'string') {
      throw new SchemaError(`${source}: type '${name}' 'discriminatorValue' must be a string`);
    }

    // properties
    const ownProps = {};
    const rawProps = data.properties ?? {};
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

    // required
    const ownRequired = [];
    const rawRequired = data.required ?? [];
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
      title: data.title ?? '',
      description: data.description ?? '',
    });
    typedef.ownProperties = ownProps;
    typedef.ownRequired = ownRequired;
    return typedef;
  }

  _parseProperty(propName, data, typeName, source) {
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
    // Type reference
    return new TypeRefProperty({ typeName: kind, title: data.title ?? '', description: data.description ?? '' });
  }

  _parsePrimitiveProperty(propName, data, typeName, source) {
    const kind = data.type;

    const intGeZero = (key) => {
      const v = data[key];
      if (v == null) return null;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
        throw new SchemaError(
          `${source}: '${key}' on property '${propName}' in '${typeName}' must be a non-negative integer`,
        );
      }
      return v;
    };

    const num = (key) => {
      const v = data[key];
      if (v == null) return null;
      if (typeof v !== 'number' || typeof v === 'boolean') {
        throw new SchemaError(
          `${source}: '${key}' on property '${propName}' in '${typeName}' must be a number`,
        );
      }
      return v;
    };

    const params = { kind, title: data.title ?? '', description: data.description ?? '' };

    if (kind === 'string') {
      params.minLength = intGeZero('minLength');
      params.maxLength = intGeZero('maxLength');
      if (params.minLength != null && params.maxLength != null && params.minLength > params.maxLength) {
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

    return new PrimitiveProperty(params);
  }

  _parseArrayProperty(propName, data, typeName, source) {
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

    const intGeZero = (key) => {
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

    const uniqueItems = data.uniqueItems ?? false;
    if (typeof uniqueItems !== 'boolean') {
      throw new SchemaError(`${source}: 'uniqueItems' on '${propName}' must be a boolean`);
    }

    return new ArrayProperty({
      items,
      minItems,
      maxItems,
      uniqueItems,
      title: data.title ?? '',
      description: data.description ?? '',
    });
  }

  // ------------------------------------------------------------------
  // Hierarchy resolution
  // ------------------------------------------------------------------

  _resolveHierarchy(schema, source) {
    for (const [typeName, typedef] of Object.entries(schema.types)) {
      if (typedef.extendsRef !== null) {
        typedef.supertype = this._resolveTypeRef(typedef.extendsRef, schema, source, `type '${typeName}'`);
      }
    }

    // Cycle detection
    for (const [typeName, typedef] of Object.entries(schema.types)) {
      const visited = new Set();
      let current = typedef;
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

  _resolveTypeRef(ref, schema, source, context = '') {
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

  /** @param {string} schemaId @returns {Schema|undefined} */
  getSchema(schemaId) { return this._schemas[schemaId]; }

  /** @param {string} dv @returns {TypeDef|undefined} */
  lookupByDiscriminatorValue(dv) { return this._byDv[dv]; }

  /** @param {string} name @param {Schema} schema @returns {TypeDef|null} */
  resolveType(name, schema) {
    try { return this._resolveTypeRef(name, schema, '<lookup>'); }
    catch { return null; }
  }

  /** @param {string} name @param {string} schemaId @returns {TypeDef|null} */
  resolveTypeIn(name, schemaId) {
    const schema = this._schemas[schemaId];
    if (!schema) return null;
    try { return this._resolveTypeRef(name, schema, '<lookup>'); }
    catch { return null; }
  }
}
