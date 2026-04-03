/**
 * OOJS data model — in-memory representation of a loaded schema.
 * @module model
 */

export const PRIMITIVE_TYPES = new Set(['string', 'integer', 'number', 'boolean', 'null']);

// ---------------------------------------------------------------------------
// Property definitions
// ---------------------------------------------------------------------------

/**
 * A property whose value is one of the JSON primitive types.
 */
export class PrimitiveProperty {
  /**
   * @param {object} p
   * @param {string}   p.kind             One of PRIMITIVE_TYPES
   * @param {string}   [p.title]
   * @param {string}   [p.description]
   * @param {number|null} [p.minLength]
   * @param {number|null} [p.maxLength]
   * @param {string|null} [p.pattern]
   * @param {string|null} [p.format]
   * @param {number|null} [p.minimum]
   * @param {number|null} [p.maximum]
   * @param {number|null} [p.exclusiveMinimum]
   * @param {number|null} [p.exclusiveMaximum]
   * @param {number|null} [p.multipleOf]
   * @param {Array|null}  [p.enum]
   */
  constructor({
    kind,
    title = '',
    description = '',
    minLength = null,
    maxLength = null,
    pattern = null,
    format = null,
    minimum = null,
    maximum = null,
    exclusiveMinimum = null,
    exclusiveMaximum = null,
    multipleOf = null,
    enum: enumValues = null,
  }) {
    this.kind = kind;
    this.title = title;
    this.description = description;
    this.minLength = minLength;
    this.maxLength = maxLength;
    this.pattern = pattern;
    this.format = format;
    this.minimum = minimum;
    this.maximum = maximum;
    this.exclusiveMinimum = exclusiveMinimum;
    this.exclusiveMaximum = exclusiveMaximum;
    this.multipleOf = multipleOf;
    this.enum = enumValues;
  }
}

/**
 * A property whose value is an object conforming to another named type.
 *
 * `resolvedType` is populated by the Registry during the eager type-reference
 * resolution pass (§10.2 step 5 / Appendix A.3). It is null only between
 * initial parsing and resolution; after a successful schema load it is always set.
 */
export class TypeRefProperty {
  /**
   * @param {object} p
   * @param {string} p.typeName  Unqualified ("Foo") or qualified ("alias.Foo")
   * @param {string} [p.title]
   * @param {string} [p.description]
   */
  constructor({ typeName, title = '', description = '' }) {
    this.typeName = typeName;
    this.title = title;
    this.description = description;
    /** @type {TypeDef|null} Resolved at load time by Registry. Never null after successful schema load. */
    this.resolvedType = null;
  }
}

/**
 * A property that holds a string ID referencing another typed object (typed horizontal reference).
 *
 * In JSON instances the value is a plain string (the ID). The validator checks
 * the value is a string but does NOT follow or validate the referenced object.
 *
 * `resolvedType` is populated by the Registry during the eager type-reference
 * resolution pass (pass 3). It is null only between initial parsing and resolution.
 */
export class IdRefProperty {
  /** @param {string} typeName */
  constructor(typeName) {
    this.typeName = typeName;
    this.title = '';
    this.description = '';
    /** @type {number|null} */ this.minLength = null;
    /** @type {number|null} */ this.maxLength = null;
    /** @type {string|null} */ this.pattern = null;
    /** @type {TypeDef|null} */ this.resolvedType = null;  // populated at load time
  }
}

/**
 * A property whose value is a JSON array with homogeneous items.
 * Nested arrays are not allowed in v1.0.
 */
export class ArrayProperty {
  /**
   * @param {object} p
   * @param {PrimitiveProperty|TypeRefProperty} p.items
   * @param {number}  [p.minItems]
   * @param {number|null} [p.maxItems]
   * @param {boolean} [p.uniqueItems]
   * @param {string}  [p.title]
   * @param {string}  [p.description]
   */
  constructor({
    items,
    minItems = 0,
    maxItems = null,
    uniqueItems = false,
    title = '',
    description = '',
  }) {
    this.items = items;
    this.minItems = minItems;
    this.maxItems = maxItems;
    this.uniqueItems = uniqueItems;
    this.title = title;
    this.description = description;
  }
}

// ---------------------------------------------------------------------------
// Type definition
// ---------------------------------------------------------------------------

/**
 * An OOJS type definition.
 *
 * `ownProperties`, `ownRequired`, and `supertype` are mutable and populated
 * by the Registry during loading.
 */
export class TypeDef {
  /**
   * @param {object}       p
   * @param {string}       p.name
   * @param {string}       p.schemaId
   * @param {boolean}      [p.isAbstract]
   * @param {string|null}  [p.extendsRef]   Raw "extends" string from the schema
   * @param {string|null}  [p.discriminatorValue]
   * @param {string}       [p.title]
   * @param {string}       [p.description]
   */
  constructor({
    name,
    schemaId,
    isAbstract = false,
    extendsRef = null,
    discriminatorValue = null,
    title = '',
    description = '',
  }) {
    this.name = name;
    this.schemaId = schemaId;
    this.isAbstract = isAbstract;
    this.extendsRef = extendsRef;
    this.discriminatorValue = discriminatorValue;
    this.title = title;
    this.description = description;

    /** @type {Record<string, PrimitiveProperty|TypeRefProperty|ArrayProperty>} */
    this.ownProperties = {};
    /** @type {string[]} */
    this.ownRequired = [];
    /** @type {TypeDef|null} */
    this.supertype = null;
  }

  /** @returns {string} */
  getEffectiveDiscriminatorValue() {
    return this.discriminatorValue ?? this.name;
  }

  /** @returns {string[]} */
  effectiveRequired() {
    if (this.supertype === null) return [...this.ownRequired];
    return [...this.supertype.effectiveRequired(), ...this.ownRequired];
  }

  /** @returns {Record<string, PrimitiveProperty|TypeRefProperty|ArrayProperty>} */
  effectiveProperties() {
    if (this.supertype === null) return { ...this.ownProperties };
    return { ...this.supertype.effectiveProperties(), ...this.ownProperties };
  }

  /**
   * Returns true if this type equals `other` or descends from it.
   * @param {TypeDef} other
   * @returns {boolean}
   */
  isSubtypeOf(other) {
    let current = this;
    while (current !== null) {
      if (current === other) return true;
      current = current.supertype;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * An OOJS schema document (one per $id).
 */
export class Schema {
  /**
   * @param {object}  p
   * @param {string}  p.oojsVersion
   * @param {string}  p.schemaId
   * @param {string}  [p.title]
   * @param {string}  [p.description]
   * @param {string}  [p.discriminator]
   * @param {boolean} [p.closedWorld]
   */
  constructor({
    oojsVersion,
    schemaId,
    title = '',
    description = '',
    discriminator = '_type',
    closedWorld = true,
  }) {
    this.oojsVersion = oojsVersion;
    this.schemaId = schemaId;
    this.title = title;
    this.description = description;
    this.discriminator = discriminator;
    this.closedWorld = closedWorld;

    /** @type {Record<string, string>}  alias → schema $id */
    this.imports = {};
    /** @type {Record<string, TypeDef>} type name → TypeDef */
    this.types = {};
  }
}
