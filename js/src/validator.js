/**
 * OOJS instance validator (§9 of the spec).
 * @module validator
 */

import { ArrayProperty, PrimitiveProperty, TypeRefProperty } from './model.js';

// ---------------------------------------------------------------------------
// Error model
// ---------------------------------------------------------------------------

/** String constants for all validation error codes. */
export const ErrorCode = Object.freeze({
  MISSING_DISCRIMINATOR:       'MISSING_DISCRIMINATOR',
  INVALID_DISCRIMINATOR_TYPE:  'INVALID_DISCRIMINATOR_TYPE',
  UNKNOWN_TYPE:                'UNKNOWN_TYPE',
  ABSTRACT_TYPE:               'ABSTRACT_TYPE',
  TYPE_MISMATCH:               'TYPE_MISMATCH',
  MISSING_REQUIRED:            'MISSING_REQUIRED',
  ADDITIONAL_PROPERTY:         'ADDITIONAL_PROPERTY',
  STRING_TOO_SHORT:            'STRING_TOO_SHORT',
  STRING_TOO_LONG:             'STRING_TOO_LONG',
  PATTERN_MISMATCH:            'PATTERN_MISMATCH',
  ENUM_MISMATCH:               'ENUM_MISMATCH',
  BELOW_MINIMUM:               'BELOW_MINIMUM',
  ABOVE_MAXIMUM:               'ABOVE_MAXIMUM',
  BELOW_EXCLUSIVE_MINIMUM:     'BELOW_EXCLUSIVE_MINIMUM',
  ABOVE_EXCLUSIVE_MAXIMUM:     'ABOVE_EXCLUSIVE_MAXIMUM',
  NOT_MULTIPLE_OF:             'NOT_MULTIPLE_OF',
  NOT_INTEGER:                 'NOT_INTEGER',
  ARRAY_TOO_SHORT:             'ARRAY_TOO_SHORT',
  ARRAY_TOO_LONG:              'ARRAY_TOO_LONG',
  ARRAY_DUPLICATE_ITEMS:       'ARRAY_DUPLICATE_ITEMS',
  UNRESOLVED_REFERENCE:        'UNRESOLVED_REFERENCE',
});

/**
 * A single instance-validation error.
 */
export class ValidationError {
  /**
   * @param {string} path    RFC 6901 JSON Pointer
   * @param {string} code    One of the ErrorCode values
   * @param {string} message Human-readable description
   */
  constructor(path, code, message) {
    this.path = path;
    this.code = code;
    this.message = message;
  }

  toString() {
    return `${this.path}: [${this.code}] ${this.message}`;
  }
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Stateful validator — one instance can be reused for many validations.
 */
export class Validator {
  /**
   * @param {import('./registry.js').Registry} registry
   * @param {boolean} [failFast]
   */
  constructor(registry, failFast = false) {
    this._registry = registry;
    this._failFast = failFast;
    this._graphIndex = null;
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Validate `instance` as `targetType`.
   * @param {unknown} instance
   * @param {import('./model.js').TypeDef} targetType
   * @param {import('./model.js').Schema} schema
   * @returns {ValidationError[]}
   */
  validate(instance, targetType, schema) {
    const errors = [];
    this._validateInstance(instance, targetType, schema, '/', errors);
    return errors;
  }

  /**
   * Parse `text` as JSON, look up `targetTypeName`, then validate.
   * @param {string} text
   * @param {string} targetTypeName
   * @param {import('./model.js').Schema} schema
   * @returns {ValidationError[]}
   */
  validateJson(text, targetTypeName, schema) {
    let instance;
    try { instance = JSON.parse(text); }
    catch (e) { throw new Error(`Invalid JSON: ${e.message}`); }
    const typedef = schema.types[targetTypeName];
    if (!typedef) throw new Error(`Type '${targetTypeName}' not found in schema '${schema.schemaId}'`);
    return this.validate(instance, typedef, schema);
  }

  /**
   * Validate a graph document (§8.12).
   * @param {Record<string, unknown>} graphDoc
   * @param {import('./model.js').Schema} schema
   * @returns {ValidationError[]}
   */
  validateGraphDocument(graphDoc, schema) {
    const errors = [];
    const discName = schema.discriminator;

    // Build $id -> raw-object index from roots and objects.
    const index = {};
    const roots = Array.isArray(graphDoc.roots) ? graphDoc.roots : [];
    for (const obj of roots) {
      if (isObj(obj) && typeof obj['$id'] === 'string') {
        index[obj['$id']] = obj;
      }
    }
    const objects = isObj(graphDoc.objects) ? graphDoc.objects : {};
    for (const [id, obj] of Object.entries(objects)) {
      if (isObj(obj)) index[id] = obj;
    }
    this._graphIndex = index;

    // Validate each graph object from roots and objects.
    const positions = [];
    roots.forEach((obj, i) => { if (isObj(obj)) positions.push([`roots/${i}`, obj]); });
    for (const [id, obj] of Object.entries(objects)) {
      if (isObj(obj)) positions.push([`objects/${escape(id)}`, obj]);
    }

    for (const [path, obj] of positions) {
      const instance = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === '$id') continue;
        if (k === '$type') {
          instance[discName] = v;
          continue;
        }
        instance[k] = v;
      }

      const discVal = instance[discName];
      if (typeof discVal !== 'string') {
        errors.push(new ValidationError(path, ErrorCode.MISSING_DISCRIMINATOR,
          'graph object missing $type field'));
        continue;
      }
      const typedef = this._registry.lookupByDiscriminatorValue(discVal);
      if (!typedef) {
        errors.push(new ValidationError(`${path}/$type`, ErrorCode.UNKNOWN_TYPE,
          `unknown type '${discVal}'`));
        continue;
      }
      this._validateInstance(instance, typedef, schema, path, errors);
    }

    this._graphIndex = null;
    return errors;
  }

  // ------------------------------------------------------------------
  // Phase 1–4  (§9.2)
  // ------------------------------------------------------------------

  _validateInstance(instance, target, schema, path, errors) {
    if (!isObj(instance)) {
      errors.push(new ValidationError(path, ErrorCode.TYPE_MISMATCH, 'expected a JSON object'));
      return !this._failFast;
    }

    // Phase 1: discriminator resolution
    const discName = schema.discriminator;
    if (!Object.prototype.hasOwnProperty.call(instance, discName)) {
      errors.push(new ValidationError(path, ErrorCode.MISSING_DISCRIMINATOR,
        `missing discriminator property '${discName}'`));
      return !this._failFast;
    }

    const discVal = instance[discName];
    if (typeof discVal !== 'string') {
      errors.push(new ValidationError(`${path}/${discName}`, ErrorCode.INVALID_DISCRIMINATOR_TYPE,
        `discriminator property '${discName}' must be a string`));
      return !this._failFast;
    }

    const concrete = this._registry.lookupByDiscriminatorValue(discVal);
    if (!concrete) {
      errors.push(new ValidationError(`${path}/${discName}`, ErrorCode.UNKNOWN_TYPE,
        `unknown type '${discVal}'`));
      return !this._failFast;
    }

    if (concrete.isAbstract) {
      errors.push(new ValidationError(`${path}/${discName}`, ErrorCode.ABSTRACT_TYPE,
        `type '${discVal}' is abstract and cannot be instantiated`));
      return !this._failFast;
    }

    if (!concrete.isSubtypeOf(target)) {
      errors.push(new ValidationError(`${path}/${discName}`, ErrorCode.TYPE_MISMATCH,
        `type '${discVal}' is not a subtype of '${target.name}'`));
      return !this._failFast;
    }

    // Phase 2: required properties
    for (const reqName of concrete.effectiveRequired()) {
      if (!Object.prototype.hasOwnProperty.call(instance, reqName)) {
        errors.push(new ValidationError(path, ErrorCode.MISSING_REQUIRED,
          `missing required property '${reqName}'`));
        if (this._failFast) return false;
      }
    }

    // Phase 3: property presence + validation
    const effectiveProps = concrete.effectiveProperties();
    for (const [key, value] of Object.entries(instance)) {
      if (key === discName) continue;
      if (!Object.prototype.hasOwnProperty.call(effectiveProps, key)) {
        if (schema.closedWorld) {
          errors.push(new ValidationError(`${path}/${escape(key)}`, ErrorCode.ADDITIONAL_PROPERTY,
            `unexpected additional property '${key}'`));
          if (this._failFast) return false;
        }
        continue;
      }
      const ok = this._validateProperty(value, effectiveProps[key], schema, `${path}/${escape(key)}`, errors);
      if (!ok && this._failFast) return false;
    }

    return true;
  }

  _validateProperty(value, prop, schema, path, errors) {
    if (prop instanceof ArrayProperty) return this._validateArray(value, prop, schema, path, errors);
    if (prop instanceof PrimitiveProperty) return this._validatePrimitive(value, prop, path, errors);
    if (prop instanceof TypeRefProperty) return this._validateTypeRef(value, prop, schema, path, errors);
    return true;
  }

  // -- Array ---------------------------------------------------------------

  _validateArray(value, prop, schema, path, errors) {
    if (!Array.isArray(value)) {
      errors.push(new ValidationError(path, ErrorCode.TYPE_MISMATCH, 'expected an array'));
      return !this._failFast;
    }

    if (value.length < prop.minItems) {
      errors.push(new ValidationError(path, ErrorCode.ARRAY_TOO_SHORT,
        `array has ${value.length} item(s), minimum is ${prop.minItems}`));
      if (this._failFast) return false;
    }

    if (prop.maxItems != null && value.length > prop.maxItems) {
      errors.push(new ValidationError(path, ErrorCode.ARRAY_TOO_LONG,
        `array has ${value.length} item(s), maximum is ${prop.maxItems}`));
      if (this._failFast) return false;
    }

    if (prop.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const key = serialiseForUniqueness(item);
        if (seen.has(key)) {
          errors.push(new ValidationError(path, ErrorCode.ARRAY_DUPLICATE_ITEMS, 'array items must be unique'));
          if (this._failFast) return false;
          break;
        }
        seen.add(key);
      }
    }

    for (let i = 0; i < value.length; i++) {
      const ok = this._validateProperty(value[i], prop.items, schema, `${path}/${i}`, errors);
      if (!ok && this._failFast) return false;
    }

    return true;
  }

  // -- Primitive -----------------------------------------------------------

  _validatePrimitive(value, prop, path, errors) {
    if (!jsonKindMatches(value, prop.kind)) {
      errors.push(new ValidationError(path, ErrorCode.TYPE_MISMATCH,
        `expected ${prop.kind}, got ${jsonTypeName(value)}`));
      return !this._failFast;
    }

    // Integer fractional check
    if (prop.kind === 'integer' && !Number.isInteger(value)) {
      errors.push(new ValidationError(path, ErrorCode.NOT_INTEGER,
        'value must be an integer (no fractional part)'));
      if (this._failFast) return false;
    }

    if (prop.kind === 'string') {
      // Count Unicode code points (matches Python len() / PHP mb_strlen)
      const length = [...value].length;

      if (prop.minLength != null && length < prop.minLength) {
        errors.push(new ValidationError(path, ErrorCode.STRING_TOO_SHORT,
          `string length ${length} < minLength ${prop.minLength}`));
        if (this._failFast) return false;
      }
      if (prop.maxLength != null && length > prop.maxLength) {
        errors.push(new ValidationError(path, ErrorCode.STRING_TOO_LONG,
          `string length ${length} > maxLength ${prop.maxLength}`));
        if (this._failFast) return false;
      }
      if (prop.pattern != null) {
        let matched;
        try {
          matched = new RegExp(prop.pattern, 'u').test(value);
        } catch (e) {
          errors.push(new ValidationError(path, ErrorCode.PATTERN_MISMATCH,
            `invalid pattern '${prop.pattern}': ${e.message}`));
          if (this._failFast) return false;
          matched = true; // don't report "no match" on top of "invalid pattern"
        }
        if (!matched) {
          errors.push(new ValidationError(path, ErrorCode.PATTERN_MISMATCH,
            `value does not match pattern '${prop.pattern}'`));
          if (this._failFast) return false;
        }
      }
      if (prop.enum != null && !prop.enum.includes(value)) {
        errors.push(new ValidationError(path, ErrorCode.ENUM_MISMATCH,
          `value '${value}' not in enum ${JSON.stringify(prop.enum)}`));
        if (this._failFast) return false;
      }
    } else if (prop.kind === 'integer' || prop.kind === 'number') {
      const num = value;

      if (prop.minimum != null && num < prop.minimum) {
        errors.push(new ValidationError(path, ErrorCode.BELOW_MINIMUM,
          `value ${value} < minimum ${prop.minimum}`));
        if (this._failFast) return false;
      }
      if (prop.maximum != null && num > prop.maximum) {
        errors.push(new ValidationError(path, ErrorCode.ABOVE_MAXIMUM,
          `value ${value} > maximum ${prop.maximum}`));
        if (this._failFast) return false;
      }
      if (prop.exclusiveMinimum != null && num <= prop.exclusiveMinimum) {
        errors.push(new ValidationError(path, ErrorCode.BELOW_EXCLUSIVE_MINIMUM,
          `value ${value} must be > ${prop.exclusiveMinimum}`));
        if (this._failFast) return false;
      }
      if (prop.exclusiveMaximum != null && num >= prop.exclusiveMaximum) {
        errors.push(new ValidationError(path, ErrorCode.ABOVE_EXCLUSIVE_MAXIMUM,
          `value ${value} must be < ${prop.exclusiveMaximum}`));
        if (this._failFast) return false;
      }
      if (prop.multipleOf != null) {
        // Floating-point safe: round to 10 decimal places (matches Python round(x%m, 10))
        const remainder = Math.abs(num) % prop.multipleOf;
        const rounded = Math.round(remainder * 1e10) / 1e10;
        if (rounded !== 0 && rounded !== prop.multipleOf) {
          errors.push(new ValidationError(path, ErrorCode.NOT_MULTIPLE_OF,
            `value ${value} is not a multiple of ${prop.multipleOf}`));
          if (this._failFast) return false;
        }
      }
      if (prop.enum != null && !prop.enum.includes(value)) {
        errors.push(new ValidationError(path, ErrorCode.ENUM_MISMATCH,
          `value ${value} not in enum ${JSON.stringify(prop.enum)}`));
        if (this._failFast) return false;
      }
    }

    return true;
  }

  // -- Type reference ------------------------------------------------------

  _validateTypeRef(value, prop, schema, path, errors) {
    // Graph-document mode: "$ref-id" type-check only (no recursive inline validation).
    if (
      this._graphIndex != null &&
      isObj(value) &&
      Object.keys(value).length === 1 &&
      Object.prototype.hasOwnProperty.call(value, '$ref-id')
    ) {
      const refId = value['$ref-id'];
      if (typeof refId !== 'string') {
        errors.push(new ValidationError(path, ErrorCode.TYPE_MISMATCH, '$ref-id must be a string'));
        return !this._failFast;
      }
      const target = this._graphIndex[refId];
      if (!target) {
        errors.push(new ValidationError(path, ErrorCode.UNRESOLVED_REFERENCE,
          `unresolved $ref-id '${refId}'`));
        return !this._failFast;
      }
      const targetTypeName = target['$type'];
      if (typeof targetTypeName !== 'string') {
        errors.push(new ValidationError(path, ErrorCode.MISSING_DISCRIMINATOR,
          'referenced object missing $type'));
        return !this._failFast;
      }
      const targetTypedef = this._registry.lookupByDiscriminatorValue(targetTypeName);
      const refTypedef = this._registry.resolveTypeIn(prop.typeName, schema.schemaId);
      if (!targetTypedef || !refTypedef) {
        errors.push(new ValidationError(path, ErrorCode.UNKNOWN_TYPE,
          `cannot resolve type '${prop.typeName}'`));
        return !this._failFast;
      }
      if (!targetTypedef.isSubtypeOf(refTypedef)) {
        errors.push(new ValidationError(path, ErrorCode.TYPE_MISMATCH,
          `type '${targetTypeName}' is not a subtype of '${prop.typeName}'`));
        return !this._failFast;
      }
      return true;
    }

    if (!isObj(value)) {
      errors.push(new ValidationError(path, ErrorCode.TYPE_MISMATCH,
        'expected a JSON object for type reference'));
      return !this._failFast;
    }

    let refTypedef = this._registry.resolveTypeIn(prop.typeName, schema.schemaId);

    if (!refTypedef && prop.typeName.includes('.')) {
      const dot = prop.typeName.indexOf('.');
      const alias = prop.typeName.slice(0, dot);
      const name = prop.typeName.slice(dot + 1);
      const importedId = schema.imports[alias];
      if (importedId) {
        const importedSchema = this._registry.getSchema(importedId);
        if (importedSchema) refTypedef = importedSchema.types[name];
      }
    }

    if (!refTypedef) {
      errors.push(new ValidationError(path, ErrorCode.UNKNOWN_TYPE,
        `cannot resolve type '${prop.typeName}'`));
      return !this._failFast;
    }

    const refSchema = this._registry.getSchema(refTypedef.schemaId) ?? schema;
    return this._validateInstance(value, refTypedef, refSchema, path, errors);
  }
}

// ---------------------------------------------------------------------------
// Convenience function
// ---------------------------------------------------------------------------

/**
 * @param {unknown} instance
 * @param {import('./model.js').TypeDef} targetType
 * @param {import('./model.js').Schema} schema
 * @param {import('./registry.js').Registry} registry
 * @param {boolean} [failFast]
 * @returns {ValidationError[]}
 */
export function validate(instance, targetType, schema, registry, failFast = false) {
  return new Validator(registry, failFast).validate(instance, targetType, schema);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function jsonKindMatches(value, kind) {
  switch (kind) {
    case 'null':    return value === null;
    case 'boolean': return typeof value === 'boolean';
    case 'string':  return typeof value === 'string';
    case 'integer': // fall-through: both accept numbers; fractional check done separately
    case 'number':  return typeof value === 'number' && !Number.isNaN(value);
    default:        return false;
  }
}

function jsonTypeName(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value;
}

/** Escape a JSON Pointer token per RFC 6901. */
function escape(token) {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Produce a canonical JSON string for uniqueness comparison (sort object keys). */
function serialiseForUniqueness(value) {
  return JSON.stringify(sortKeysRecursive(value));
}

function sortKeysRecursive(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeysRecursive);
  return Object.fromEntries(
    Object.keys(value).sort().map(k => [k, sortKeysRecursive(value[k])]),
  );
}
