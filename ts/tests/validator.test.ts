/**
 * OOJS validator conformance tests (§12.2) — TypeScript / Vitest edition.
 * Mirrors the Python, PHP and JS test suites.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach } from 'vitest';
import { Registry, SchemaError, ErrorCode, validate, Validator } from '../src/index.js';
import type { Schema } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(__dirname, '../../examples');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MINIMAL_SCHEMA = {
  '$oojs': '1.0',
  '$id': 'https://example.org/schemas/test',
  types: {
    Animal: {
      abstract: true,
      properties: {
        name: { type: 'string' },
        age:  { type: 'integer', minimum: 0 },
      },
      required: ['name'],
    },
    Dog: {
      extends: 'Animal',
      properties: { breed: { type: 'string' } },
      required: ['breed'],
    },
    Cat: {
      extends: 'Animal',
      properties: { indoor: { type: 'boolean' } },
    },
  },
};

function makeRegistry(...schemas: object[]) {
  const r = new Registry();
  for (const s of schemas) r.loadDict(s);
  return r;
}

function animalRegistry(): { r: Registry; schema: Schema } {
  const r = makeRegistry(MINIMAL_SCHEMA);
  const schema = r.getSchema('https://example.org/schemas/test')!;
  return { r, schema };
}

function hasCode(errors: { code: string }[], code: string) {
  return errors.some(e => e.code === code);
}

function hasCodeAndMessage(errors: { code: string; message: string }[], code: string, sub: string) {
  return errors.some(e => e.code === code && e.message.includes(sub));
}

// ---------------------------------------------------------------------------
// Schema loading
// ---------------------------------------------------------------------------

describe('SchemaLoading', () => {
  it('minimal valid schema', () => {
    const { schema } = animalRegistry();
    expect(schema).toBeTruthy();
    expect('Animal' in schema.types).toBe(true);
    expect('Dog' in schema.types).toBe(true);
  });

  it('missing $oojs', () => {
    expect(() => makeRegistry({ '$id': 'x', types: { A: {} } }))
      .toThrow(SchemaError);
    expect(() => makeRegistry({ '$id': 'x', types: { A: {} } }))
      .toThrowError(/\$oojs/);
  });

  it('wrong version', () => {
    expect(() => makeRegistry({ '$oojs': '2.0', '$id': 'x', types: { A: {} } }))
      .toThrowError(/unsupported/i);
  });

  it('missing $id', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', types: { A: {} } }))
      .toThrowError(/\$id/);
  });

  it('missing types', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x' }))
      .toThrowError(/types/);
  });

  it('empty types', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: {} }))
      .toThrowError(/types/);
  });

  it('invalid type name (lowercase)', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { dog: {} } }))
      .toThrowError(/naming rules/i);
  });

  it('reserved type name', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { string: {} } }))
      .toThrowError(/reserved/i);
  });

  it('discriminator collides with property', () => {
    expect(() => makeRegistry({
      '$oojs': '1.0', '$id': 'x',
      discriminator: 'kind',
      types: { Foo: { properties: { kind: { type: 'string' } } } },
    })).toThrowError(/collides/i);
  });

  it('inheritance resolved', () => {
    const { schema } = animalRegistry();
    expect(schema.types['Dog'].supertype).toBe(schema.types['Animal']);
  });

  it('cycle detection', () => {
    expect(() => makeRegistry({
      '$oojs': '1.0', '$id': 'x',
      types: { A: { extends: 'B' }, B: { extends: 'A' } },
    })).toThrowError(/cycle/i);
  });

  it('property redeclaration forbidden', () => {
    expect(() => makeRegistry({
      '$oojs': '1.0', '$id': 'x',
      types: {
        Base: { properties: { name: { type: 'string' } } },
        Child: { extends: 'Base', properties: { name: { type: 'string' } } },
      },
    })).toThrowError(/redeclares/i);
  });

  it('required references own property only', () => {
    expect(() => makeRegistry({
      '$oojs': '1.0', '$id': 'x',
      types: {
        Base: { properties: { name: { type: 'string' } }, required: ['name'] },
        Child: { extends: 'Base', required: ['name'] },
      },
    })).toThrowError(/not declared in own/i);
  });

  it('duplicate discriminator value', () => {
    expect(() => makeRegistry({
      '$oojs': '1.0', '$id': 'x',
      types: {
        A: { discriminatorValue: 'shared' },
        B: { discriminatorValue: 'shared' },
      },
    })).toThrowError(/discriminator value/i);
  });

  it('idempotent reload', () => {
    const r = new Registry();
    const s1 = r.loadDict(MINIMAL_SCHEMA);
    const s2 = r.loadDict(MINIMAL_SCHEMA);
    expect(s1).toBe(s2);
  });

  it('invalid property name', () => {
    expect(() => makeRegistry({
      '$oojs': '1.0', '$id': 'x',
      types: { Foo: { properties: { BadName: { type: 'string' } } } },
    })).toThrowError(/naming rules/i);
  });

  it('mutually exclusive minimum', () => {
    expect(() => makeRegistry({
      '$oojs': '1.0', '$id': 'x',
      types: { Foo: { properties: { n: { type: 'integer', minimum: 0, exclusiveMinimum: 0 } } } },
    })).toThrowError(/mutually exclusive/i);
  });

  it('nested array forbidden', () => {
    expect(() => makeRegistry({
      '$oojs': '1.0', '$id': 'x',
      types: {
        Foo: {
          properties: {
            matrix: { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
          },
        },
      },
    })).toThrowError(/nested array/i);
  });
});

// ---------------------------------------------------------------------------
// Discriminator
// ---------------------------------------------------------------------------

describe('Discriminator', () => {
  let r: Registry, schema: Schema;
  beforeEach(() => ({ r, schema } = animalRegistry()));

  const val = (inst: object, typeName = 'Animal') => {
    const { r, schema } = animalRegistry();
    return validate(inst, schema.types[typeName], schema, r);
  };

  it('missing discriminator', () => {
    expect(hasCode(val({ name: 'Rex', breed: 'Lab' }), ErrorCode.MISSING_DISCRIMINATOR)).toBe(true);
  });

  it('invalid discriminator type', () => {
    expect(hasCode(val({ _type: 42, name: 'Rex' }), ErrorCode.INVALID_DISCRIMINATOR_TYPE)).toBe(true);
  });

  it('unknown type', () => {
    expect(hasCode(val({ _type: 'Fish', name: 'Nemo' }), ErrorCode.UNKNOWN_TYPE)).toBe(true);
  });

  it('abstract type', () => {
    expect(hasCode(val({ _type: 'Animal', name: 'X' }), ErrorCode.ABSTRACT_TYPE)).toBe(true);
  });

  it('type not subtype of target', () => {
    expect(hasCode(val({ _type: 'Dog', name: 'Rex', breed: 'Lab' }, 'Cat'), ErrorCode.TYPE_MISMATCH)).toBe(true);
  });

  it('valid concrete subtype', () => {
    expect(val({ _type: 'Dog', name: 'Rex', breed: 'Lab' })).toEqual([]);
  });

  it('custom discriminatorValue', () => {
    const r2 = new Registry();
    r2.loadDict({
      '$oojs': '1.0', '$id': 'https://example.org/schemas/dv-test',
      types: {
        Vehicle: { abstract: true, properties: { speed: { type: 'number' } } },
        Car: { extends: 'Vehicle', discriminatorValue: 'automobile' },
      },
    });
    const s2 = r2.getSchema('https://example.org/schemas/dv-test')!;
    expect(validate({ _type: 'automobile', speed: 100 }, s2.types['Vehicle'], s2, r2)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Required
// ---------------------------------------------------------------------------

describe('Required', () => {
  it('missing own required', () => {
    const { r, schema } = animalRegistry();
    const errs = validate({ _type: 'Dog', name: 'Rex' }, schema.types['Animal'], schema, r);
    expect(hasCodeAndMessage(errs, ErrorCode.MISSING_REQUIRED, 'breed')).toBe(true);
  });

  it('missing inherited required', () => {
    const { r, schema } = animalRegistry();
    const errs = validate({ _type: 'Dog', breed: 'Lab' }, schema.types['Animal'], schema, r);
    expect(hasCodeAndMessage(errs, ErrorCode.MISSING_REQUIRED, 'name')).toBe(true);
  });

  it('all required present', () => {
    const { r, schema } = animalRegistry();
    expect(validate({ _type: 'Dog', name: 'Rex', breed: 'Lab' }, schema.types['Animal'], schema, r)).toEqual([]);
  });

  it('optional property absent is ok', () => {
    const { r, schema } = animalRegistry();
    expect(validate({ _type: 'Cat', name: 'Whiskers' }, schema.types['Animal'], schema, r)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Additional properties
// ---------------------------------------------------------------------------

describe('AdditionalProperties', () => {
  it('extra property rejected in closed world', () => {
    const { r, schema } = animalRegistry();
    const errs = validate({ _type: 'Dog', name: 'Rex', breed: 'Lab', color: 'black' }, schema.types['Dog'], schema, r);
    expect(hasCode(errs, ErrorCode.ADDITIONAL_PROPERTY)).toBe(true);
  });

  it('open world allows extra', () => {
    const r = new Registry();
    r.loadDict({
      '$oojs': '1.0', '$id': 'https://example.org/schemas/open',
      additionalProperties: true,
      types: { Foo: { properties: { x: { type: 'string' } } } },
    });
    const schema = r.getSchema('https://example.org/schemas/open')!;
    expect(validate({ _type: 'Foo', x: 'hello', extra: 99 }, schema.types['Foo'], schema, r)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// String constraints
// ---------------------------------------------------------------------------

function strErrs(value: unknown, constraints: Record<string, unknown> = {}) {
  const r = new Registry();
  r.loadDict({
    '$oojs': '1.0', '$id': 'https://example.org/schemas/str-test',
    types: { Str: { properties: { v: { type: 'string', ...constraints } } } },
  });
  const schema = r.getSchema('https://example.org/schemas/str-test')!;
  return validate({ _type: 'Str', v: value }, schema.types['Str'], schema, r);
}

describe('StringConstraints', () => {
  it('minLength ok', () => expect(strErrs('hi', { minLength: 2 })).toEqual([]));
  it('minLength fail', () => expect(hasCode(strErrs('x', { minLength: 2 }), ErrorCode.STRING_TOO_SHORT)).toBe(true));
  it('maxLength ok', () => expect(strErrs('hi', { maxLength: 5 })).toEqual([]));
  it('maxLength fail', () => expect(hasCode(strErrs('toolong', { maxLength: 5 }), ErrorCode.STRING_TOO_LONG)).toBe(true));
  it('pattern match', () => expect(strErrs('abc123', { pattern: '^[a-z]+[0-9]+$' })).toEqual([]));
  it('pattern no match', () => expect(hasCode(strErrs('123abc', { pattern: '^[a-z]+[0-9]+$' }), ErrorCode.PATTERN_MISMATCH)).toBe(true));
  it('enum match', () => expect(strErrs('yes', { enum: ['yes', 'no'] })).toEqual([]));
  it('enum mismatch', () => expect(hasCode(strErrs('maybe', { enum: ['yes', 'no'] }), ErrorCode.ENUM_MISMATCH)).toBe(true));
  it('type mismatch', () => expect(hasCode(strErrs(42), ErrorCode.TYPE_MISMATCH)).toBe(true));
});

// ---------------------------------------------------------------------------
// Numeric constraints
// ---------------------------------------------------------------------------

function numErrs(value: unknown, kind = 'number', constraints: Record<string, unknown> = {}) {
  const r = new Registry();
  r.loadDict({
    '$oojs': '1.0', '$id': 'https://example.org/schemas/num-test',
    types: { Num: { properties: { v: { type: kind, ...constraints } } } },
  });
  const schema = r.getSchema('https://example.org/schemas/num-test')!;
  return validate({ _type: 'Num', v: value }, schema.types['Num'], schema, r);
}

describe('NumericConstraints', () => {
  it('minimum ok', () => expect(numErrs(5, 'number', { minimum: 0 })).toEqual([]));
  it('minimum fail', () => expect(hasCode(numErrs(-1, 'number', { minimum: 0 }), ErrorCode.BELOW_MINIMUM)).toBe(true));
  it('maximum ok', () => expect(numErrs(10, 'number', { maximum: 10 })).toEqual([]));
  it('maximum fail', () => expect(hasCode(numErrs(11, 'number', { maximum: 10 }), ErrorCode.ABOVE_MAXIMUM)).toBe(true));
  it('exclusiveMinimum ok', () => expect(numErrs(1, 'number', { exclusiveMinimum: 0 })).toEqual([]));
  it('exclusiveMinimum fail', () => expect(hasCode(numErrs(0, 'number', { exclusiveMinimum: 0 }), ErrorCode.BELOW_EXCLUSIVE_MINIMUM)).toBe(true));
  it('exclusiveMaximum ok', () => expect(numErrs(9, 'number', { exclusiveMaximum: 10 })).toEqual([]));
  it('exclusiveMaximum fail', () => expect(hasCode(numErrs(10, 'number', { exclusiveMaximum: 10 }), ErrorCode.ABOVE_EXCLUSIVE_MAXIMUM)).toBe(true));
  it('multipleOf ok', () => expect(numErrs(6, 'number', { multipleOf: 3 })).toEqual([]));
  it('multipleOf fail', () => expect(hasCode(numErrs(7, 'number', { multipleOf: 3 }), ErrorCode.NOT_MULTIPLE_OF)).toBe(true));
  it('integer ok', () => expect(numErrs(3, 'integer')).toEqual([]));
  it('integer float with fraction', () => expect(hasCode(numErrs(3.5, 'integer'), ErrorCode.NOT_INTEGER)).toBe(true));
  it('integer float no fraction', () => expect(numErrs(3.0, 'integer')).toEqual([]));
  it('enum number ok', () => expect(numErrs(2, 'number', { enum: [1, 2, 3] })).toEqual([]));
  it('enum number fail', () => expect(hasCode(numErrs(5, 'number', { enum: [1, 2, 3] }), ErrorCode.ENUM_MISMATCH)).toBe(true));
});

// ---------------------------------------------------------------------------
// Array constraints
// ---------------------------------------------------------------------------

function arrErrs(value: unknown, constraints: Record<string, unknown> = {}) {
  const r = new Registry();
  r.loadDict({
    '$oojs': '1.0', '$id': 'https://example.org/schemas/arr-test',
    types: { Arr: { properties: { v: { type: 'array', items: { type: 'string' }, ...constraints } } } },
  });
  const schema = r.getSchema('https://example.org/schemas/arr-test')!;
  return validate({ _type: 'Arr', v: value }, schema.types['Arr'], schema, r);
}

describe('ArrayConstraints', () => {
  it('not array', () => expect(hasCode(arrErrs('nope'), ErrorCode.TYPE_MISMATCH)).toBe(true));
  it('minItems ok', () => expect(arrErrs(['a', 'b'], { minItems: 2 })).toEqual([]));
  it('minItems fail', () => expect(hasCode(arrErrs(['a'], { minItems: 2 }), ErrorCode.ARRAY_TOO_SHORT)).toBe(true));
  it('maxItems ok', () => expect(arrErrs(['a'], { maxItems: 2 })).toEqual([]));
  it('maxItems fail', () => expect(hasCode(arrErrs(['a', 'b', 'c'], { maxItems: 2 }), ErrorCode.ARRAY_TOO_LONG)).toBe(true));
  it('uniqueItems ok', () => expect(arrErrs(['a', 'b'], { uniqueItems: true })).toEqual([]));
  it('uniqueItems fail', () => expect(hasCode(arrErrs(['a', 'a'], { uniqueItems: true }), ErrorCode.ARRAY_DUPLICATE_ITEMS)).toBe(true));

  it('item constraint propagated', () => {
    const r = new Registry();
    r.loadDict({
      '$oojs': '1.0', '$id': 'https://example.org/schemas/arr-item',
      types: { Arr: { properties: { v: { type: 'array', items: { type: 'string', maxLength: 5 } } } } },
    });
    const schema = r.getSchema('https://example.org/schemas/arr-item')!;
    const errs = validate({ _type: 'Arr', v: ['toolong'] }, schema.types['Arr'], schema, r);
    expect(hasCode(errs, ErrorCode.STRING_TOO_LONG)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Polymorphic array
// ---------------------------------------------------------------------------

function polySetup() {
  const r = new Registry();
  r.loadDict({
    '$oojs': '1.0', '$id': 'https://example.org/schemas/poly',
    types: {
      Shape: { abstract: true, properties: { color: { type: 'string' } } },
      Circle: { extends: 'Shape', properties: { radius: { type: 'number' } }, required: ['radius'] },
      Rect: {
        extends: 'Shape',
        properties: { width: { type: 'number' }, height: { type: 'number' } },
        required: ['width', 'height'],
      },
      Canvas: { properties: { shapes: { type: 'array', items: { type: 'Shape' } } } },
    },
  });
  const schema = r.getSchema('https://example.org/schemas/poly')!;
  return { r, schema };
}

describe('PolymorphicArray', () => {
  it('valid mixed-type array', () => {
    const { r, schema } = polySetup();
    const inst = {
      _type: 'Canvas',
      shapes: [{ _type: 'Circle', radius: 5 }, { _type: 'Rect', width: 10, height: 4 }],
    };
    expect(validate(inst, schema.types['Canvas'], schema, r)).toEqual([]);
  });

  it('abstract item rejected', () => {
    const { r, schema } = polySetup();
    const inst = { _type: 'Canvas', shapes: [{ _type: 'Shape', color: 'red' }] };
    expect(hasCode(validate(inst, schema.types['Canvas'], schema, r), ErrorCode.ABSTRACT_TYPE)).toBe(true);
  });

  it('missing required in array item', () => {
    const { r, schema } = polySetup();
    const inst = { _type: 'Canvas', shapes: [{ _type: 'Circle' }] };
    expect(hasCode(validate(inst, schema.types['Canvas'], schema, r), ErrorCode.MISSING_REQUIRED)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fail-fast
// ---------------------------------------------------------------------------

describe('FailFast', () => {
  it('returns single error', () => {
    const { r, schema } = animalRegistry();
    expect(validate({ _type: 'Dog' }, schema.types['Animal'], schema, r, true)).toHaveLength(1);
  });

  it('full mode returns all errors', () => {
    const { r, schema } = animalRegistry();
    expect(validate({ _type: 'Dog' }, schema.types['Animal'], schema, r, false).length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Clinical example (integration test — reads files from disk)
// ---------------------------------------------------------------------------

describe('ClinicalExample', () => {
  let r: Registry, schema: Schema;
  let validInstances: Record<string, unknown>[];
  let invalidInstances: Record<string, unknown>[];

  beforeEach(() => {
    r = new Registry();
    schema = r.loadJson(readFileSync(join(EXAMPLES, 'clinical.oojs.json'), 'utf-8'));
    const data = JSON.parse(readFileSync(join(EXAMPLES, 'clinical-instances.json'), 'utf-8'));
    validInstances = data.valid;
    invalidInstances = data.invalid;
  });

  it('valid instances pass', () => {
    for (const inst of validInstances) {
      const dv = inst['_type'] as string | undefined;
      const typedef = dv ? schema.types[dv] : undefined;
      if (!typedef) continue;
      const clean = Object.fromEntries(Object.entries(inst).filter(([k]) => k !== '_comment'));
      const errs = validate(clean, typedef, schema, r);
      expect(errs, `errors for ${dv}: ${errs.map(e => String(e)).join(', ')}`).toEqual([]);
    }
  });

  it('invalid instances fail', () => {
    for (const inst of invalidInstances) {
      const dv = inst['_type'] as string | undefined;
      const target = dv
        ? (schema.types[dv] ?? Object.values(schema.types)[0])
        : schema.types['Observation'];
      const errs = validate(inst, target, schema, r);
      expect(errs.length, `expected errors for _type=${dv ?? 'none'}`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Subtype check
// ---------------------------------------------------------------------------

describe('SubtypeCheck', () => {
  it('direct subtype', () => {
    const { schema } = animalRegistry();
    expect(schema.types['Dog'].isSubtypeOf(schema.types['Animal'])).toBe(true);
  });

  it('same type', () => {
    const { schema } = animalRegistry();
    expect(schema.types['Dog'].isSubtypeOf(schema.types['Dog'])).toBe(true);
  });

  it('not subtype', () => {
    const { schema } = animalRegistry();
    expect(schema.types['Cat'].isSubtypeOf(schema.types['Dog'])).toBe(false);
  });

  it('transitive', () => {
    const r = new Registry();
    r.loadDict({
      '$oojs': '1.0', '$id': 'https://example.org/schemas/deep',
      types: { A: { abstract: true }, B: { extends: 'A' }, C: { extends: 'B' }, D: { extends: 'C' } },
    });
    const schema = r.getSchema('https://example.org/schemas/deep')!;
    expect(schema.types['D'].isSubtypeOf(schema.types['A'])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Effective property set
// ---------------------------------------------------------------------------

describe('EffectivePropertySet', () => {
  it('inherits parent properties', () => {
    const { schema } = animalRegistry();
    const eff = schema.types['Dog'].effectiveProperties();
    expect('name' in eff).toBe(true);
    expect('age' in eff).toBe(true);
    expect('breed' in eff).toBe(true);
  });

  it('effectiveRequired union', () => {
    const { schema } = animalRegistry();
    const req = schema.types['Dog'].effectiveRequired();
    expect(req).toContain('name');
    expect(req).toContain('breed');
  });
});

// ---------------------------------------------------------------------------
// ValidationError model
// ---------------------------------------------------------------------------

describe('ValidationError', () => {
  it('toString format', () => {
    const { r, schema } = animalRegistry();
    const errs = validate({ _type: 'Dog', breed: 'Lab' }, schema.types['Animal'], schema, r);
    const err = errs.find(e => e.code === ErrorCode.MISSING_REQUIRED)!;
    expect(err).toBeTruthy();
    expect(err.toString()).toMatch(/\[MISSING_REQUIRED\]/);
    expect(err.toString()).toContain('name');
    expect(err.toString()).toMatch(/^\//);
  });
});

// ---------------------------------------------------------------------------
// Registry — loadJson / edge cases
// ---------------------------------------------------------------------------

describe('Registry edge cases', () => {
  it('loadJson invalid JSON', () => {
    expect(() => new Registry().loadJson('{')).toThrow(SchemaError);
    expect(() => new Registry().loadJson('{')).toThrowError(/invalid JSON/i);
  });

  it('loadJson success', () => {
    const schema = new Registry().loadJson(JSON.stringify(MINIMAL_SCHEMA));
    expect(schema.schemaId).toBe('https://example.org/schemas/test');
  });

  it('schema must be a JSON object', () => {
    expect(() => new Registry().loadJson('null')).toThrowError(/schema must be a JSON object/i);
  });

  it('$id must be non-empty string', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': '', types: { A: {} } })).toThrowError(/non-empty string/i);
  });

  it('discriminator must be non-empty string', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', discriminator: '', types: { A: {} } })).toThrowError(/discriminator/i);
  });

  it('imports must be an object', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', imports: 'nope', types: { A: {} } })).toThrowError(/imports/i);
  });

  it('import alias must match naming rules', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', imports: { BadAlias: 'https://x' }, types: { A: {} } })).toThrowError(/import alias/i);
  });

  it('import value must be string', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', imports: { other: 123 }, types: { A: {} } })).toThrowError(/import value/i);
  });

  it('type definition must be object', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: 'nope' } })).toThrowError(/definition must be a JSON object/i);
  });

  it('extends must be string', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { extends: 123 } } })).toThrowError(/extends/i);
  });

  it('abstract must be boolean', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { abstract: 'yes' } } })).toThrowError(/abstract/i);
  });

  it('discriminatorValue must be string', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { discriminatorValue: 1 } } })).toThrowError(/discriminatorValue/i);
  });

  it('properties must be object', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: 'bad' } } })).toThrowError(/properties/i);
  });

  it('required must be array', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { required: 'bad' } } })).toThrowError(/required/i);
  });

  it("required entries must be strings", () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { required: [1] } } })).toThrowError(/'required' entries must be strings/i);
  });

  it('required duplicates rejected', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { a: { type: 'string' } }, required: ['a', 'a'] } } })).toThrowError(/more than once/i);
  });

  it('property must be object', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { p: 'bad' } } } })).toThrowError(/must be a JSON object/i);
  });

  it("property missing type", () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { p: {} } } } })).toThrowError(/missing 'type'/i);
  });

  it("property type must be string", () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { p: { type: 1 } } } } })).toThrowError(/'type' must be a string/i);
  });

  it('invalid minLength (negative)', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { s: { type: 'string', minLength: -1 } } } } })).toThrowError(/non-negative integer/i);
  });

  it('boolean used for minimum', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { n: { type: 'integer', minimum: true } } } } })).toThrowError(/must be a number/i);
  });

  it('minLength greater than maxLength', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { s: { type: 'string', minLength: 5, maxLength: 3 } } } } })).toThrowError(/'minLength' > 'maxLength'/i);
  });

  it('pattern must be string', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { s: { type: 'string', pattern: 123 } } } } })).toThrowError(/pattern/i);
  });

  it('string enum must be non-empty array', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { s: { type: 'string', enum: [] } } } } })).toThrowError(/enum/i);
  });

  it('exclusiveMaximum conflicts with maximum', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { n: { type: 'number', maximum: 1, exclusiveMaximum: 1 } } } } })).toThrowError(/mutually exclusive/i);
  });

  it('multipleOf must be greater than zero', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { n: { type: 'number', multipleOf: 0 } } } } })).toThrowError(/multipleOf/i);
  });

  it('numeric enum must be non-empty array', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { n: { type: 'number', enum: [] } } } } })).toThrowError(/enum/i);
  });

  it('array missing items', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { arr: { type: 'array' } } } } })).toThrowError(/missing 'items'/i);
  });

  it('array minItems must be non-negative integer', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { arr: { type: 'array', items: { type: 'string' }, minItems: -1 } } } } })).toThrowError(/non-negative integer/i);
  });

  it('array minItems greater than maxItems', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { arr: { type: 'array', items: { type: 'string' }, minItems: 5, maxItems: 3 } } } } })).toThrowError(/'minItems' > 'maxItems'/i);
  });

  it('uniqueItems must be boolean', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { arr: { type: 'array', items: { type: 'string' }, uniqueItems: 'yes' } } } } })).toThrowError(/uniqueItems/i);
  });

  it('imported schema not loaded', () => {
    expect(() => makeRegistry({ '$oojs': '1.0', '$id': 'x', imports: { other: 'https://example.org/schemas/other' }, types: { Foo: { extends: 'other.Bar' } } })).toThrowError(/not loaded/i);
  });

  it('imported type missing', () => {
    const r = new Registry();
    r.loadDict({ '$oojs': '1.0', '$id': 'https://example.org/schemas/other', types: { Pet: {} } });
    expect(() => r.loadDict({ '$oojs': '1.0', '$id': 'x', imports: { other: 'https://example.org/schemas/other' }, types: { Foo: { extends: 'other.Missing' } } })).toThrowError(/not found in schema/i);
  });
});

// ---------------------------------------------------------------------------
// Validator — validateJson
// ---------------------------------------------------------------------------

describe('Validator.validateJson', () => {
  it('invalid JSON throws', () => {
    const { r, schema } = animalRegistry();
    expect(() => new Validator(r).validateJson('{', 'Dog', schema)).toThrowError(/Invalid JSON/i);
  });

  it('unknown type name throws', () => {
    const { r, schema } = animalRegistry();
    expect(() => new Validator(r).validateJson('{"_type":"Dog"}', 'Missing', schema)).toThrowError(/not found/i);
  });

  it('success', () => {
    const { r, schema } = animalRegistry();
    expect(new Validator(r).validateJson('{"_type":"Dog","name":"Rex","breed":"Lab"}', 'Dog', schema)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Validator — type reference edge cases
// ---------------------------------------------------------------------------

describe('TypeRef', () => {
  it('non-object value gives TYPE_MISMATCH', () => {
    const r = new Registry();
    r.loadDict({ '$oojs': '1.0', '$id': 'https://example.org/schemas/ref-mismatch', types: { Parent: { properties: { child: { type: 'Child' } }, required: ['child'] }, Child: { properties: { name: { type: 'string' } }, required: ['name'] } } });
    const schema = r.getSchema('https://example.org/schemas/ref-mismatch')!;
    expect(hasCode(validate({ _type: 'Parent', child: 'nope' }, schema.types['Parent'], schema, r), ErrorCode.TYPE_MISMATCH)).toBe(true);
  });

  it('unresolvable type gives UNKNOWN_TYPE', () => {
    const r = new Registry();
    r.loadDict({ '$oojs': '1.0', '$id': 'https://example.org/schemas/ref-unknown', types: { Parent: { properties: { child: { type: 'MissingType' } }, required: ['child'] } } });
    const schema = r.getSchema('https://example.org/schemas/ref-unknown')!;
    expect(hasCode(validate({ _type: 'Parent', child: { x: 1 } }, schema.types['Parent'], schema, r), ErrorCode.UNKNOWN_TYPE)).toBe(true);
  });

  it('resolves via imports', () => {
    const r = new Registry();
    r.loadDict({ '$oojs': '1.0', '$id': 'https://example.org/schemas/other', types: { Pet: { properties: { name: { type: 'string' } }, required: ['name'] } } });
    r.loadDict({ '$oojs': '1.0', '$id': 'https://example.org/schemas/owner', imports: { other: 'https://example.org/schemas/other' }, types: { Owner: { properties: { pet: { type: 'other.Pet' } }, required: ['pet'] } } });
    const schema = r.getSchema('https://example.org/schemas/owner')!;
    expect(validate({ _type: 'Owner', pet: { _type: 'Pet', name: 'Fido' } }, schema.types['Owner'], schema, r)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Validator — jsonTypeName in error messages
// ---------------------------------------------------------------------------

describe('jsonTypeName branches', () => {
  it('null in TYPE_MISMATCH message', () => {
    const r = new Registry();
    r.loadDict({ '$oojs': '1.0', '$id': 'x', types: { Str: { properties: { v: { type: 'string' } } } } });
    const s = r.getSchema('x')!;
    expect(hasCodeAndMessage(validate({ _type: 'Str', v: null }, s.types['Str'], s, r), ErrorCode.TYPE_MISMATCH, 'null')).toBe(true);
  });

  it('boolean in TYPE_MISMATCH message', () => {
    const r = new Registry();
    r.loadDict({ '$oojs': '1.0', '$id': 'x', types: { Str: { properties: { v: { type: 'string' } } } } });
    const s = r.getSchema('x')!;
    expect(hasCodeAndMessage(validate({ _type: 'Str', v: true }, s.types['Str'], s, r), ErrorCode.TYPE_MISMATCH, 'boolean')).toBe(true);
  });

  it('array in TYPE_MISMATCH message', () => {
    const r = new Registry();
    r.loadDict({ '$oojs': '1.0', '$id': 'x', types: { Num: { properties: { v: { type: 'integer' } } } } });
    const s = r.getSchema('x')!;
    expect(hasCodeAndMessage(validate({ _type: 'Num', v: [1] }, s.types['Num'], s, r), ErrorCode.TYPE_MISMATCH, 'array')).toBe(true);
  });

  it('null and boolean property types pass validation', () => {
    const r = new Registry();
    r.loadDict({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { n: { type: 'null' }, b: { type: 'boolean' } }, required: ['n', 'b'] } } });
    const s = r.getSchema('x')!;
    expect(validate({ _type: 'Foo', n: null, b: true }, s.types['Foo'], s, r)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fail-fast — extended coverage
// ---------------------------------------------------------------------------

describe('FailFast extended', () => {
  it('non-object instance returns single TYPE_MISMATCH', () => {
    const { r, schema } = animalRegistry();
    const errs = validate('nope', schema.types['Animal'], schema, r, true);
    expect(errs).toHaveLength(1);
    expect(errs[0].code).toBe(ErrorCode.TYPE_MISMATCH);
  });

  it('additional property stops at first', () => {
    const { r, schema } = animalRegistry();
    const errs = validate({ _type: 'Dog', name: 'Rex', breed: 'Lab', color: 'black' }, schema.types['Dog'], schema, r, true);
    expect(errs).toHaveLength(1);
    expect(errs[0].code).toBe(ErrorCode.ADDITIONAL_PROPERTY);
  });

  const ffArr = (v: unknown, constraints: object = {}) => {
    const r = new Registry();
    r.loadDict({ '$oojs': '1.0', '$id': 'x', types: { Arr: { properties: { v: { type: 'array', items: { type: 'string' }, ...constraints } } } } });
    const s = r.getSchema('x')!;
    return validate({ _type: 'Arr', v }, s.types['Arr'], s, r, true);
  };

  it('array too short', () => { const e = ffArr(['a'], { minItems: 2 }); expect(e).toHaveLength(1); expect(e[0].code).toBe(ErrorCode.ARRAY_TOO_SHORT); });
  it('array too long', () => { const e = ffArr(['a','b'], { maxItems: 1 }); expect(e).toHaveLength(1); expect(e[0].code).toBe(ErrorCode.ARRAY_TOO_LONG); });
  it('array duplicate items', () => { const e = ffArr(['a','a'], { uniqueItems: true }); expect(e).toHaveLength(1); expect(e[0].code).toBe(ErrorCode.ARRAY_DUPLICATE_ITEMS); });
  it('array item validation', () => { const e = ffArr([123]); expect(e).toHaveLength(1); expect(e[0].code).toBe(ErrorCode.TYPE_MISMATCH); });

  const ffNum = (v: unknown, kind: string, constraints: object = {}) => {
    const r = new Registry();
    r.loadDict({ '$oojs': '1.0', '$id': 'x', types: { Num: { properties: { n: { type: kind, ...constraints } } } } });
    const s = r.getSchema('x')!;
    return validate({ _type: 'Num', n: v }, s.types['Num'], s, r, true);
  };

  it('integer fraction', () => { const e = ffNum(3.5, 'integer'); expect(e).toHaveLength(1); expect(e[0].code).toBe(ErrorCode.NOT_INTEGER); });
  it('number below minimum', () => { const e = ffNum(-1, 'number', { minimum: 0 }); expect(e).toHaveLength(1); expect(e[0].code).toBe(ErrorCode.BELOW_MINIMUM); });
  it('number above maximum', () => { const e = ffNum(2, 'number', { maximum: 1 }); expect(e).toHaveLength(1); expect(e[0].code).toBe(ErrorCode.ABOVE_MAXIMUM); });
  it('number below exclusive minimum', () => { const e = ffNum(0, 'number', { exclusiveMinimum: 0 }); expect(e).toHaveLength(1); expect(e[0].code).toBe(ErrorCode.BELOW_EXCLUSIVE_MINIMUM); });
  it('number above exclusive maximum', () => { const e = ffNum(1, 'number', { exclusiveMaximum: 1 }); expect(e).toHaveLength(1); expect(e[0].code).toBe(ErrorCode.ABOVE_EXCLUSIVE_MAXIMUM); });
  it('number not multiple of', () => { const e = ffNum(3, 'number', { multipleOf: 2 }); expect(e).toHaveLength(1); expect(e[0].code).toBe(ErrorCode.NOT_MULTIPLE_OF); });
  it('number enum mismatch', () => { const e = ffNum(3, 'number', { enum: [1, 2] }); expect(e).toHaveLength(1); expect(e[0].code).toBe(ErrorCode.ENUM_MISMATCH); });

  const ffStr = (v: unknown, constraints: object = {}) => {
    const r = new Registry();
    r.loadDict({ '$oojs': '1.0', '$id': 'x', types: { Str: { properties: { s: { type: 'string', ...constraints } } } } });
    const s = r.getSchema('x')!;
    return validate({ _type: 'Str', s: v }, s.types['Str'], s, r, true);
  };

  it('string too short', () => { const e = ffStr('a', { minLength: 2 }); expect(e).toHaveLength(1); expect(e[0].code).toBe(ErrorCode.STRING_TOO_SHORT); });
  it('string too long', () => { const e = ffStr('toolong', { maxLength: 2 }); expect(e).toHaveLength(1); expect(e[0].code).toBe(ErrorCode.STRING_TOO_LONG); });
  it('string invalid pattern', () => { const e = ffStr('a', { pattern: '(' }); expect(e).toHaveLength(1); expect(e[0].code).toBe(ErrorCode.PATTERN_MISMATCH); });
  it('string pattern mismatch', () => { const e = ffStr('b', { pattern: '^a+$' }); expect(e).toHaveLength(1); expect(e[0].code).toBe(ErrorCode.PATTERN_MISMATCH); });
  it('string enum mismatch', () => { const e = ffStr('b', { enum: ['a'] }); expect(e).toHaveLength(1); expect(e[0].code).toBe(ErrorCode.ENUM_MISMATCH); });
});

// ---------------------------------------------------------------------------
// Unique-items — canonicalization
// ---------------------------------------------------------------------------

describe('UniqueItems canonicalization', () => {
  it('object key order is irrelevant', () => {
    const r = new Registry();
    r.loadDict({ '$oojs': '1.0', '$id': 'x', additionalProperties: true, types: { Obj: {}, Arr: { properties: { v: { type: 'array', items: { type: 'Obj' }, uniqueItems: true } } } } });
    const s = r.getSchema('x')!;
    const errs = validate({ _type: 'Arr', v: [{ _type: 'Obj', a: 1, b: 2 }, { _type: 'Obj', b: 2, a: 1 }] }, s.types['Arr'], s, r);
    expect(hasCode(errs, ErrorCode.ARRAY_DUPLICATE_ITEMS)).toBe(true);
  });

  it('nested arrays treated as duplicates', () => {
    const r = new Registry();
    r.loadDict({ '$oojs': '1.0', '$id': 'y', additionalProperties: true, types: { Obj: {}, Arr: { properties: { v: { type: 'array', items: { type: 'Obj' }, uniqueItems: true } } } } });
    const s = r.getSchema('y')!;
    const errs = validate({ _type: 'Arr', v: [{ _type: 'Obj', x: [1, 2] }, { _type: 'Obj', x: [1, 2] }] }, s.types['Arr'], s, r);
    expect(hasCode(errs, ErrorCode.ARRAY_DUPLICATE_ITEMS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sample schemas
// ---------------------------------------------------------------------------

describe('SampleSchemas', () => {
  it('car + motor + wheels (nested type-refs and fixed-count array)', () => {
    const r = new Registry();
    r.loadDict({
      '$oojs': '1.0', '$id': 'https://example.org/schemas/car',
      types: {
        Motor: { properties: { horsepower: { type: 'number', minimum: 1 }, cylinders: { type: 'integer', minimum: 1 } }, required: ['horsepower', 'cylinders'] },
        Wheel: { properties: { size: { type: 'number', minimum: 10 }, material: { type: 'string', enum: ['rubber'] } }, required: ['size', 'material'] },
        Car: {
          properties: {
            make: { type: 'string' }, model: { type: 'string' },
            motor: { type: 'Motor' },
            wheels: { type: 'array', items: { type: 'Wheel' }, minItems: 4, maxItems: 4 },
          },
          required: ['make', 'model', 'motor', 'wheels'],
        },
      },
    });
    const schema = r.getSchema('https://example.org/schemas/car')!;
    const inst = {
      _type: 'Car', make: 'Acme', model: 'Roadster',
      motor: { _type: 'Motor', horsepower: 220, cylinders: 4 },
      wheels: [
        { _type: 'Wheel', size: 18, material: 'rubber' },
        { _type: 'Wheel', size: 18, material: 'rubber' },
        { _type: 'Wheel', size: 18, material: 'rubber' },
        { _type: 'Wheel', size: 18, material: 'rubber' },
      ],
    };
    expect(validate(inst, schema.types['Car'], schema, r)).toEqual([]);
  });

  it('fleet with has-many ID arrays (relationships via IDs)', () => {
    const r = new Registry();
    r.loadDict({
      '$oojs': '1.0', '$id': 'https://example.org/schemas/car-rel',
      types: {
        Person: { properties: { personId: { type: 'string' }, name: { type: 'string' }, carIds: { type: 'array', items: { type: 'string' } } }, required: ['personId', 'name'] },
        Car: { properties: { carId: { type: 'string' }, make: { type: 'string' }, model: { type: 'string' }, ownerId: { type: 'string' }, garageId: { type: 'string' } }, required: ['carId', 'make', 'model', 'ownerId'] },
        Garage: { properties: { garageId: { type: 'string' }, name: { type: 'string' }, carIds: { type: 'array', items: { type: 'string' } } }, required: ['garageId', 'name'] },
        Fleet: { properties: { fleetId: { type: 'string' }, name: { type: 'string' }, carIds: { type: 'array', items: { type: 'string' } }, personIds: { type: 'array', items: { type: 'string' } } }, required: ['fleetId', 'name'] },
      },
    });
    const schema = r.getSchema('https://example.org/schemas/car-rel')!;
    const inst = { _type: 'Fleet', fleetId: 'fleet-1', name: 'City Fleet', carIds: ['car-1', 'car-2'], personIds: ['person-1'] };
    expect(validate(inst, schema.types['Fleet'], schema, r)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Relationships (§8.6–§8.11)
// ---------------------------------------------------------------------------

function relVerticalSchema() {
  return {
    '$oojs': '1.0', '$id': 'https://example.org/schemas/vertical',
    types: {
      Motor: {
        properties: {
          horsepower: { type: 'integer', minimum: 1 },
          fuelType: { type: 'string', enum: ['petrol', 'electric'] },
        },
        required: ['horsepower', 'fuelType'],
      },
      Wheel: {
        properties: { size: { type: 'number', minimum: 10 } },
        required: ['size'],
      },
      Car: {
        properties: {
          carId: { type: 'string' },
          make: { type: 'string' },
          motor: { type: 'Motor' },
          wheels: { type: 'array', items: { type: 'Wheel' }, minItems: 4, maxItems: 4 },
        },
        required: ['carId', 'make', 'motor', 'wheels'],
      },
    },
  };
}

function relHorizontalSchema() {
  return {
    '$oojs': '1.0', '$id': 'https://example.org/schemas/horizontal',
    types: {
      Person: {
        properties: {
          personId: { type: 'string' },
          name: { type: 'string' },
          carIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['personId', 'name'],
      },
      Car: {
        properties: {
          carId: { type: 'string' },
          make: { type: 'string' },
          ownerId: { type: 'string' },
        },
        required: ['carId', 'make', 'ownerId'],
      },
      Fleet: {
        properties: {
          fleetId: { type: 'string' },
          name: { type: 'string' },
          carIds: { type: 'array', items: { type: 'string' } },
          personIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['fleetId', 'name'],
      },
    },
  };
}

describe('Relationships', () => {
  it('vertical has-one valid', () => {
    const r = new Registry();
    const schema = r.loadDict(relVerticalSchema());
    const car = {
      _type: 'Car', carId: 'car-1', make: 'Acme',
      motor: { _type: 'Motor', horsepower: 180, fuelType: 'petrol' },
      wheels: [
        { _type: 'Wheel', size: 18 },
        { _type: 'Wheel', size: 18 },
        { _type: 'Wheel', size: 18 },
        { _type: 'Wheel', size: 18 },
      ],
    };
    expect(validate(car, schema.types.Car, schema, r)).toEqual([]);
  });

  it('vertical has-one embedded missing required field', () => {
    const r = new Registry();
    const schema = r.loadDict(relVerticalSchema());
    const car = {
      _type: 'Car', carId: 'car-1', make: 'Acme',
      motor: { _type: 'Motor', horsepower: 180 },
      wheels: [
        { _type: 'Wheel', size: 18 },
        { _type: 'Wheel', size: 18 },
        { _type: 'Wheel', size: 18 },
        { _type: 'Wheel', size: 18 },
      ],
    };
    const errs = validate(car, schema.types.Car, schema, r);
    expect(hasCode(errs, ErrorCode.MISSING_REQUIRED)).toBe(true);
  });

  it('vertical has-many wrong count', () => {
    const r = new Registry();
    const schema = r.loadDict(relVerticalSchema());
    const car = {
      _type: 'Car', carId: 'car-1', make: 'Acme',
      motor: { _type: 'Motor', horsepower: 200, fuelType: 'petrol' },
      wheels: [
        { _type: 'Wheel', size: 18 },
        { _type: 'Wheel', size: 18 },
        { _type: 'Wheel', size: 18 },
      ],
    };
    const errs = validate(car, schema.types.Car, schema, r);
    expect(hasCode(errs, ErrorCode.ARRAY_TOO_SHORT)).toBe(true);
  });

  it('horizontal has-one wrong type for id', () => {
    const r = new Registry();
    const schema = r.loadDict(relHorizontalSchema());
    const car = { _type: 'Car', carId: 'car-1', make: 'Acme', ownerId: 12345 };
    const errs = validate(car, schema.types.Car, schema, r);
    expect(hasCode(errs, ErrorCode.TYPE_MISMATCH)).toBe(true);
  });

  it('bidirectional inconsistency passes individual validation', () => {
    const r = new Registry();
    const schema = r.loadDict(relHorizontalSchema());
    const person = { _type: 'Person', personId: 'person-1', name: 'Alice', carIds: ['car-X'] };
    const car = { _type: 'Car', carId: 'car-X', make: 'Acme', ownerId: 'person-99' };
    expect(validate(person, schema.types.Person, schema, r)).toEqual([]);
    expect(validate(car, schema.types.Car, schema, r)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cycles (§8.13)
// ---------------------------------------------------------------------------

describe('Cycle', () => {
  it('self-referential type schema loads', () => {
    const r = new Registry();
    const schema = r.loadDict({
      '$oojs': '1.0', '$id': 'https://example.org/schemas/self-ref',
      types: {
        Employee: {
          properties: {
            employeeId: { type: 'string' },
            name: { type: 'string' },
            manager: { type: 'Employee' },
          },
          required: ['employeeId', 'name'],
        },
      },
    });
    expect('Employee' in schema.types).toBe(true);
  });

  it('two-type cycle schema loads', () => {
    const r = new Registry();
    const schema = r.loadDict({
      '$oojs': '1.0', '$id': 'https://example.org/schemas/two-cycle',
      types: {
        Employee: {
          properties: {
            employeeId: { type: 'string' },
            name: { type: 'string' },
            department: { type: 'Department' },
          },
          required: ['employeeId', 'name'],
        },
        Department: {
          properties: {
            departmentId: { type: 'string' },
            name: { type: 'string' },
            head: { type: 'Employee' },
          },
          required: ['departmentId', 'name'],
        },
      },
    });
    expect('Employee' in schema.types && 'Department' in schema.types).toBe(true);
  });

  it('finite nested self-reference validates', () => {
    const r = new Registry();
    const schema = r.loadDict({
      '$oojs': '1.0', '$id': 'https://example.org/schemas/self-ref-inst',
      types: {
        Employee: {
          properties: {
            employeeId: { type: 'string' },
            name: { type: 'string' },
            manager: { type: 'Employee' },
          },
          required: ['employeeId', 'name'],
        },
      },
    });

    const alice = {
      _type: 'Employee', employeeId: 'E-001', name: 'Alice',
      manager: {
        _type: 'Employee', employeeId: 'E-002', name: 'Bob',
        manager: { _type: 'Employee', employeeId: 'E-003', name: 'Carol' },
      },
    };
    expect(validate(alice, schema.types.Employee, schema, r)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Graph document (§8.12)
// ---------------------------------------------------------------------------

function employeeGraphSchema() {
  return {
    '$oojs': '1.0', '$id': 'https://example.org/schemas/employees',
    types: {
      Department: {
        properties: {
          departmentId: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['departmentId', 'name'],
      },
      Employee: {
        properties: {
          employeeId: { type: 'string' },
          name: { type: 'string' },
          department: { type: 'Department' },
          manager: { type: 'Employee' },
        },
        required: ['employeeId', 'name', 'department'],
      },
    },
  };
}

describe('GraphDocument', () => {
  it('valid shared reference graph', () => {
    const r = new Registry();
    const schema = r.loadDict(employeeGraphSchema());

    const graphDoc = {
      '$oojs': '1.0',
      roots: [
        {
          '$type': 'Employee', '$id': 'emp-alice',
          employeeId: 'E-001', name: 'Alice',
          department: { '$ref-id': 'dept-eng' },
        },
        {
          '$type': 'Employee', '$id': 'emp-bob',
          employeeId: 'E-002', name: 'Bob',
          department: { '$ref-id': 'dept-eng' },
        },
      ],
      objects: {
        'dept-eng': {
          '$type': 'Department', '$id': 'dept-eng',
          departmentId: 'D-01', name: 'Engineering',
        },
      },
    };

    expect(new Validator(r).validateGraphDocument(graphDoc, schema)).toEqual([]);
  });

  it('unresolved $ref-id produces error', () => {
    const r = new Registry();
    const schema = r.loadDict(employeeGraphSchema());

    const graphDoc = {
      '$oojs': '1.0',
      roots: [
        {
          '$type': 'Employee', '$id': 'emp-alice',
          employeeId: 'E-001', name: 'Alice',
          department: { '$ref-id': 'does-not-exist' },
        },
      ],
    };

    const errs = new Validator(r).validateGraphDocument(graphDoc, schema);
    expect(errs.length).toBeGreaterThan(0);
    expect(hasCode(errs, ErrorCode.UNRESOLVED_REFERENCE)).toBe(true);
  });

  it('ref-id target type mismatch produces error', () => {
    const r = new Registry();
    const schema = r.loadDict(employeeGraphSchema());

    const graphDoc = {
      '$oojs': '1.0',
      roots: [
        {
          '$type': 'Employee', '$id': 'emp-alice',
          employeeId: 'E-001', name: 'Alice',
          department: { '$ref-id': 'not-a-dept' },
        },
      ],
      objects: {
        'not-a-dept': {
          '$type': 'Employee', '$id': 'not-a-dept',
          employeeId: 'E-999', name: 'Impostor',
          department: { '$ref-id': 'not-a-dept' },
        },
      },
    };

    const errs = new Validator(r).validateGraphDocument(graphDoc, schema);
    expect(errs.length).toBeGreaterThan(0);
    expect(hasCode(errs, ErrorCode.TYPE_MISMATCH)).toBe(true);
  });

  it('root missing $type produces error', () => {
    const r = new Registry();
    const schema = r.loadDict(employeeGraphSchema());

    const graphDoc = {
      '$oojs': '1.0',
      roots: [
        { '$id': 'emp-alice', employeeId: 'E-001', name: 'Alice' },
      ],
    };

    const errs = new Validator(r).validateGraphDocument(graphDoc, schema);
    expect(errs.length).toBeGreaterThan(0);
    expect(hasCode(errs, ErrorCode.MISSING_DISCRIMINATOR)).toBe(true);
  });
});
