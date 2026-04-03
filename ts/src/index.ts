/**
 * OOJS public API — re-exports all public symbols.
 */

export {
  PRIMITIVE_TYPES,
  PrimitiveProperty,
  IdRefProperty,
  TypeRefProperty,
  ArrayProperty,
  TypeDef,
  Schema,
} from './model.js';

export type { PropertyDef } from './model.js';

export { SchemaError, Registry } from './registry.js';

export {
  ErrorCode,
  ValidationError,
  Validator,
  validate,
} from './validator.js';

export type { ErrorCodeValue } from './validator.js';
