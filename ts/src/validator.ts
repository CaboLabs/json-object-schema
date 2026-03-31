/**
 * OOJS instance validator (§9 of the spec).
 */

import { ArrayProperty, PrimitiveProperty, TypeRefProperty, TypeDef, Schema } from './model.js';
import { Registry } from './registry.js';

// ---------------------------------------------------------------------------
// Error model
// ---------------------------------------------------------------------------

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
} as const);

export type ErrorCodeValue = typeof ErrorCode[keyof typeof ErrorCode];

export class ValidationError {
  path: string;
  code: string;
  message: string;

  constructor(path: string, code: string, message: string) {
    this.path = path;
    this.code = code;
    this.message = message;
  }

  toString(): string {
    return `${this.path}: [${this.code}] ${this.message}`;
  }
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export class Validator {
  private _registry: Registry;
  private _failFast: boolean;

  constructor(registry: Registry, failFast = false) {
    this._registry = registry;
    this._failFast = failFast;
  }

  validate(instance: unknown, targetType: TypeDef, schema: Schema): ValidationError[] {
    const errors: ValidationError[] = [];
    this._validateInstance(instance, targetType, schema, '/', errors);
    return errors;
  }

  validateJson(text: string, targetTypeName: string, schema: Schema): ValidationError[] {
    let instance: unknown;
    try { instance = JSON.parse(text); }
    catch (e: unknown) { throw new Error(`Invalid JSON: ${(e as Error).message}`); }
    const typedef = schema.types[targetTypeName];
    if (!typedef) throw new Error(`Type '${targetTypeName}' not found in schema '${schema.schemaId}'`);
    return this.validate(instance, typedef, schema);
  }

  private _validateInstance(
    instance: unknown,
    target: TypeDef,
    schema: Schema,
    path: string,
    errors: ValidationError[],
  ): boolean {
    if (!isObj(instance)) {
      errors.push(new ValidationError(path, ErrorCode.TYPE_MISMATCH, 'expected a JSON object'));
      return !this._failFast;
    }

    const discName = schema.discriminator;
    if (!Object.prototype.hasOwnProperty.call(instance, discName)) {
      errors.push(new ValidationError(path, ErrorCode.MISSING_DISCRIMINATOR,
        `missing discriminator property '${discName}'`));
      return !this._failFast;
    }

    const discVal = (instance as Record<string, unknown>)[discName];
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
    for (const [key, value] of Object.entries(instance as Record<string, unknown>)) {
      if (key === discName) continue;
      if (!Object.prototype.hasOwnProperty.call(effectiveProps, key)) {
        if (schema.closedWorld) {
          errors.push(new ValidationError(`${path}/${escapePointer(key)}`, ErrorCode.ADDITIONAL_PROPERTY,
            `unexpected additional property '${key}'`));
          if (this._failFast) return false;
        }
        continue;
      }
      const ok = this._validateProperty(value, effectiveProps[key], schema, `${path}/${escapePointer(key)}`, errors);
      if (!ok && this._failFast) return false;
    }

    return true;
  }

  private _validateProperty(
    value: unknown,
    prop: ArrayProperty | PrimitiveProperty | TypeRefProperty,
    schema: Schema,
    path: string,
    errors: ValidationError[],
  ): boolean {
    if (prop instanceof ArrayProperty) return this._validateArray(value, prop, schema, path, errors);
    if (prop instanceof PrimitiveProperty) return this._validatePrimitive(value, prop, path, errors);
    if (prop instanceof TypeRefProperty) return this._validateTypeRef(value, prop, schema, path, errors);
    return true;
  }

  private _validateArray(
    value: unknown,
    prop: ArrayProperty,
    schema: Schema,
    path: string,
    errors: ValidationError[],
  ): boolean {
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
      const seen = new Set<string>();
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

  private _validatePrimitive(value: unknown, prop: PrimitiveProperty, path: string, errors: ValidationError[]): boolean {
    if (!jsonKindMatches(value, prop.kind)) {
      errors.push(new ValidationError(path, ErrorCode.TYPE_MISMATCH,
        `expected ${prop.kind}, got ${jsonTypeName(value)}`));
      return !this._failFast;
    }

    if (prop.kind === 'integer' && !Number.isInteger(value as number)) {
      errors.push(new ValidationError(path, ErrorCode.NOT_INTEGER,
        'value must be an integer (no fractional part)'));
      if (this._failFast) return false;
    }

    if (prop.kind === 'string') {
      const str = value as string;
      const length = [...str].length;

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
        let matched: boolean;
        try {
          matched = new RegExp(prop.pattern, 'u').test(str);
        } catch (e: unknown) {
          errors.push(new ValidationError(path, ErrorCode.PATTERN_MISMATCH,
            `invalid pattern '${prop.pattern}': ${(e as Error).message}`));
          if (this._failFast) return false;
          matched = true;
        }
        if (!matched) {
          errors.push(new ValidationError(path, ErrorCode.PATTERN_MISMATCH,
            `value does not match pattern '${prop.pattern}'`));
          if (this._failFast) return false;
        }
      }
      if (prop.enum != null && !prop.enum.includes(str)) {
        errors.push(new ValidationError(path, ErrorCode.ENUM_MISMATCH,
          `value '${str}' not in enum ${JSON.stringify(prop.enum)}`));
        if (this._failFast) return false;
      }
    } else if (prop.kind === 'integer' || prop.kind === 'number') {
      const num = value as number;

      if (prop.minimum != null && num < prop.minimum) {
        errors.push(new ValidationError(path, ErrorCode.BELOW_MINIMUM,
          `value ${num} < minimum ${prop.minimum}`));
        if (this._failFast) return false;
      }
      if (prop.maximum != null && num > prop.maximum) {
        errors.push(new ValidationError(path, ErrorCode.ABOVE_MAXIMUM,
          `value ${num} > maximum ${prop.maximum}`));
        if (this._failFast) return false;
      }
      if (prop.exclusiveMinimum != null && num <= prop.exclusiveMinimum) {
        errors.push(new ValidationError(path, ErrorCode.BELOW_EXCLUSIVE_MINIMUM,
          `value ${num} must be > ${prop.exclusiveMinimum}`));
        if (this._failFast) return false;
      }
      if (prop.exclusiveMaximum != null && num >= prop.exclusiveMaximum) {
        errors.push(new ValidationError(path, ErrorCode.ABOVE_EXCLUSIVE_MAXIMUM,
          `value ${num} must be < ${prop.exclusiveMaximum}`));
        if (this._failFast) return false;
      }
      if (prop.multipleOf != null) {
        const remainder = Math.abs(num) % prop.multipleOf;
        const rounded = Math.round(remainder * 1e10) / 1e10;
        if (rounded !== 0 && rounded !== prop.multipleOf) {
          errors.push(new ValidationError(path, ErrorCode.NOT_MULTIPLE_OF,
            `value ${num} is not a multiple of ${prop.multipleOf}`));
          if (this._failFast) return false;
        }
      }
      if (prop.enum != null && !prop.enum.includes(num)) {
        errors.push(new ValidationError(path, ErrorCode.ENUM_MISMATCH,
          `value ${num} not in enum ${JSON.stringify(prop.enum)}`));
        if (this._failFast) return false;
      }
    }

    return true;
  }

  private _validateTypeRef(
    value: unknown,
    prop: TypeRefProperty,
    schema: Schema,
    path: string,
    errors: ValidationError[],
  ): boolean {
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
        if (importedSchema) refTypedef = importedSchema.types[name] ?? null;
      }
    }

    if (!refTypedef) {
      errors.push(new ValidationError(path, ErrorCode.UNKNOWN_TYPE,
        `cannot resolve type '${prop.typeName}'`));
      return !this._failFast;
    }

    const refSchema = this._registry.getSchemaForType(refTypedef) ?? schema;
    return this._validateInstance(value, refTypedef, refSchema, path, errors);
  }
}

// ---------------------------------------------------------------------------
// Convenience function
// ---------------------------------------------------------------------------

export function validate(
  instance: unknown,
  targetType: TypeDef,
  schema: Schema,
  registry: Registry,
  failFast = false,
): ValidationError[] {
  return new Validator(registry, failFast).validate(instance, targetType, schema);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function jsonKindMatches(value: unknown, kind: string): boolean {
  switch (kind) {
    case 'null':    return value === null;
    case 'boolean': return typeof value === 'boolean';
    case 'string':  return typeof value === 'string';
    case 'integer':
    case 'number':  return typeof value === 'number' && !Number.isNaN(value);
    default:        return false;
  }
}

function jsonTypeName(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value;
}

function escapePointer(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function serialiseForUniqueness(value: unknown): string {
  return JSON.stringify(sortKeysRecursive(value));
}

function sortKeysRecursive(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeysRecursive);
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>).sort().map(k => [k, sortKeysRecursive((value as Record<string, unknown>)[k])]),
  );
}
