/**
 * OOJS data model — in-memory representation of a loaded schema.
 */

export const PRIMITIVE_TYPES = new Set(['string', 'integer', 'number', 'boolean', 'null']);

// ---------------------------------------------------------------------------
// Property definitions
// ---------------------------------------------------------------------------

export interface PrimitivePropertyParams {
  kind: string;
  title?: string;
  description?: string;
  minLength?: number | null;
  maxLength?: number | null;
  pattern?: string | null;
  format?: string | null;
  minimum?: number | null;
  maximum?: number | null;
  exclusiveMinimum?: number | null;
  exclusiveMaximum?: number | null;
  multipleOf?: number | null;
  enum?: unknown[] | null;
}

export class PrimitiveProperty {
  kind: string;
  title: string;
  description: string;
  minLength: number | null;
  maxLength: number | null;
  pattern: string | null;
  format: string | null;
  minimum: number | null;
  maximum: number | null;
  exclusiveMinimum: number | null;
  exclusiveMaximum: number | null;
  multipleOf: number | null;
  enum: unknown[] | null;

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
  }: PrimitivePropertyParams) {
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
  typeName: string;
  title: string;
  description: string;
  /** Resolved at load time by Registry. Never null after successful schema load. */
  resolvedType: TypeDef | null = null;

  constructor({
    typeName,
    title = '',
    description = '',
  }: { typeName: string; title?: string; description?: string }) {
    this.typeName = typeName;
    this.title = title;
    this.description = description;
  }
}

/**
 * A property that holds a string ID referencing another typed object (typed horizontal reference).
 *
 * In JSON instances the value is a plain string (the ID). The validator checks
 * the value is a string but does NOT follow or validate the referenced object.
 */
export class IdRefProperty {
  typeName: string;
  title: string;
  description: string;
  minLength: number | null;
  maxLength: number | null;
  pattern: string | null;
  /** Resolved at load time by Registry. Never null after successful schema load. */
  resolvedType: TypeDef | null = null;

  constructor(typeName: string) {
    this.typeName = typeName;
    this.title = '';
    this.description = '';
    this.minLength = null;
    this.maxLength = null;
    this.pattern = null;
  }
}

export type PropertyDef = PrimitiveProperty | IdRefProperty | TypeRefProperty | ArrayProperty;

export class ArrayProperty {
  items: PrimitiveProperty | IdRefProperty | TypeRefProperty;
  minItems: number;
  maxItems: number | null;
  uniqueItems: boolean;
  title: string;
  description: string;

  constructor({
    items,
    minItems = 0,
    maxItems = null,
    uniqueItems = false,
    title = '',
    description = '',
  }: {
    items: PrimitiveProperty | IdRefProperty | TypeRefProperty;
    minItems?: number;
    maxItems?: number | null;
    uniqueItems?: boolean;
    title?: string;
    description?: string;
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

export class TypeDef {
  name: string;
  schemaId: string;
  isAbstract: boolean;
  extendsRef: string | null;
  discriminatorValue: string | null;
  title: string;
  description: string;
  ownProperties: Record<string, PropertyDef>;
  ownRequired: string[];
  supertype: TypeDef | null;

  constructor({
    name,
    schemaId,
    isAbstract = false,
    extendsRef = null,
    discriminatorValue = null,
    title = '',
    description = '',
  }: {
    name: string;
    schemaId: string;
    isAbstract?: boolean;
    extendsRef?: string | null;
    discriminatorValue?: string | null;
    title?: string;
    description?: string;
  }) {
    this.name = name;
    this.schemaId = schemaId;
    this.isAbstract = isAbstract;
    this.extendsRef = extendsRef;
    this.discriminatorValue = discriminatorValue;
    this.title = title;
    this.description = description;
    this.ownProperties = {};
    this.ownRequired = [];
    this.supertype = null;
  }

  getEffectiveDiscriminatorValue(): string {
    return this.discriminatorValue ?? this.name;
  }

  effectiveRequired(): string[] {
    if (this.supertype === null) return [...this.ownRequired];
    return [...this.supertype.effectiveRequired(), ...this.ownRequired];
  }

  effectiveProperties(): Record<string, PropertyDef> {
    if (this.supertype === null) return { ...this.ownProperties };
    return { ...this.supertype.effectiveProperties(), ...this.ownProperties };
  }

  isSubtypeOf(other: TypeDef): boolean {
    let current: TypeDef | null = this;
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

export class Schema {
  oojsVersion: string;
  schemaId: string;
  title: string;
  description: string;
  discriminator: string;
  closedWorld: boolean;
  imports: Record<string, string>;
  types: Record<string, TypeDef>;

  constructor({
    oojsVersion,
    schemaId,
    title = '',
    description = '',
    discriminator = '_type',
    closedWorld = true,
  }: {
    oojsVersion: string;
    schemaId: string;
    title?: string;
    description?: string;
    discriminator?: string;
    closedWorld?: boolean;
  }) {
    this.oojsVersion = oojsVersion;
    this.schemaId = schemaId;
    this.title = title;
    this.description = description;
    this.discriminator = discriminator;
    this.closedWorld = closedWorld;
    this.imports = {};
    this.types = {};
  }
}
