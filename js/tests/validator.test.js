/**
 * OOJS validator conformance tests (§12.2) — browser ES module edition.
 * Mirrors the Python/PHP test suites; no server required (inline test data).
 */

import { test, assert, assertEqual, assertEmpty, assertNotEmpty } from './runner.js';
import { Registry, SchemaError, ErrorCode, validate, Validator } from '../src/index.js';

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
      properties: {
        breed: { type: 'string' },
      },
      required: ['breed'],
    },
    Cat: {
      extends: 'Animal',
      properties: {
        indoor: { type: 'boolean' },
      },
    },
  },
};

function makeRegistry(...schemas) {
  const r = new Registry();
  for (const s of schemas) r.loadDict(s);
  return r;
}

function animalRegistry() {
  const r = makeRegistry(MINIMAL_SCHEMA);
  const schema = r.getSchema('https://example.org/schemas/test');
  return { r, schema };
}

function hasCode(errors, code) {
  return errors.some(e => e.code === code);
}

function hasCodeAndMessage(errors, code, substring) {
  return errors.some(e => e.code === code && e.message.includes(substring));
}

// ---------------------------------------------------------------------------
// Schema loading (§4, §5, §6, §10, §11)
// ---------------------------------------------------------------------------

test('SchemaLoading: minimal valid schema', () => {
  const { schema } = animalRegistry();
  assert(schema !== null, 'schema should not be null');
  assert('Animal' in schema.types, 'Animal type expected');
  assert('Dog' in schema.types, 'Dog type expected');
});

test('SchemaLoading: missing $oojs', () => {
  let threw = false;
  try { makeRegistry({ '$id': 'x', types: { A: {} } }); } catch (e) { threw = true; assert(e instanceof SchemaError && e.message.includes('$oojs')); }
  assert(threw, 'expected SchemaError');
});

test('SchemaLoading: wrong version', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '2.0', '$id': 'x', types: { A: {} } }); } catch (e) { threw = true; assert(e instanceof SchemaError && /unsupported/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('SchemaLoading: missing $id', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', types: { A: {} } }); } catch (e) { threw = true; assert(e instanceof SchemaError && e.message.includes('$id')); }
  assert(threw, 'expected SchemaError');
});

test('SchemaLoading: missing types', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x' }); } catch (e) { threw = true; assert(e instanceof SchemaError && e.message.includes('types')); }
  assert(threw, 'expected SchemaError');
});

test('SchemaLoading: empty types', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: {} }); } catch (e) { threw = true; assert(e instanceof SchemaError && e.message.includes('types')); }
  assert(threw, 'expected SchemaError');
});

test('SchemaLoading: invalid type name (lowercase)', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { dog: {} } }); } catch (e) { threw = true; assert(e instanceof SchemaError && /naming rules/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('SchemaLoading: reserved type name', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { string: {} } }); } catch (e) { threw = true; assert(e instanceof SchemaError && /reserved/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('SchemaLoading: discriminator collides with property', () => {
  let threw = false;
  try {
    makeRegistry({
      '$oojs': '1.0', '$id': 'x',
      discriminator: 'kind',
      types: { Foo: { properties: { kind: { type: 'string' } } } },
    });
  } catch (e) { threw = true; assert(e instanceof SchemaError && /collides/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('SchemaLoading: inheritance resolved', () => {
  const { schema } = animalRegistry();
  const dog = schema.types['Dog'];
  assert(dog.supertype === schema.types['Animal'], 'Dog.supertype should be Animal');
});

test('SchemaLoading: cycle detection', () => {
  let threw = false;
  try {
    makeRegistry({
      '$oojs': '1.0', '$id': 'x',
      types: { A: { extends: 'B' }, B: { extends: 'A' } },
    });
  } catch (e) { threw = true; assert(e instanceof SchemaError && /cycle/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('SchemaLoading: property redeclaration forbidden', () => {
  let threw = false;
  try {
    makeRegistry({
      '$oojs': '1.0', '$id': 'x',
      types: {
        Base: { properties: { name: { type: 'string' } } },
        Child: { extends: 'Base', properties: { name: { type: 'string' } } },
      },
    });
  } catch (e) { threw = true; assert(e instanceof SchemaError && /redeclares/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('SchemaLoading: required references own property only', () => {
  let threw = false;
  try {
    makeRegistry({
      '$oojs': '1.0', '$id': 'x',
      types: {
        Base: { properties: { name: { type: 'string' } }, required: ['name'] },
        Child: { extends: 'Base', required: ['name'] },
      },
    });
  } catch (e) { threw = true; assert(e instanceof SchemaError && /not declared in own/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('SchemaLoading: duplicate discriminator value', () => {
  let threw = false;
  try {
    makeRegistry({
      '$oojs': '1.0', '$id': 'x',
      types: {
        A: { discriminatorValue: 'shared' },
        B: { discriminatorValue: 'shared' },
      },
    });
  } catch (e) { threw = true; assert(e instanceof SchemaError && /discriminator value/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('SchemaLoading: idempotent reload', () => {
  const r = new Registry();
  const s1 = r.loadDict(MINIMAL_SCHEMA);
  const s2 = r.loadDict(MINIMAL_SCHEMA);
  assert(s1 === s2, 'should return same schema instance on reload');
});

test('SchemaLoading: invalid property name', () => {
  let threw = false;
  try {
    makeRegistry({
      '$oojs': '1.0', '$id': 'x',
      types: { Foo: { properties: { BadName: { type: 'string' } } } },
    });
  } catch (e) { threw = true; assert(e instanceof SchemaError && /naming rules/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('SchemaLoading: mutually exclusive minimum', () => {
  let threw = false;
  try {
    makeRegistry({
      '$oojs': '1.0', '$id': 'x',
      types: { Foo: { properties: { n: { type: 'integer', minimum: 0, exclusiveMinimum: 0 } } } },
    });
  } catch (e) { threw = true; assert(e instanceof SchemaError && /mutually exclusive/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('SchemaLoading: nested array forbidden', () => {
  let threw = false;
  try {
    makeRegistry({
      '$oojs': '1.0', '$id': 'x',
      types: {
        Foo: {
          properties: {
            matrix: { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
          },
        },
      },
    });
  } catch (e) { threw = true; assert(e instanceof SchemaError && /nested array/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

// ---------------------------------------------------------------------------
// Discriminator (§7, §9.2 Phase 1)
// ---------------------------------------------------------------------------

function animalValidate(instance, typeName = 'Animal') {
  const { r, schema } = animalRegistry();
  return validate(instance, schema.types[typeName], schema, r);
}

test('Discriminator: missing discriminator', () => {
  const errs = animalValidate({ name: 'Rex', breed: 'Labrador' });
  assert(hasCode(errs, ErrorCode.MISSING_DISCRIMINATOR), 'expected MISSING_DISCRIMINATOR');
});

test('Discriminator: invalid discriminator type', () => {
  const errs = animalValidate({ _type: 42, name: 'Rex', breed: 'Labrador' });
  assert(hasCode(errs, ErrorCode.INVALID_DISCRIMINATOR_TYPE), 'expected INVALID_DISCRIMINATOR_TYPE');
});

test('Discriminator: unknown type', () => {
  const errs = animalValidate({ _type: 'Fish', name: 'Nemo' });
  assert(hasCode(errs, ErrorCode.UNKNOWN_TYPE), 'expected UNKNOWN_TYPE');
});

test('Discriminator: abstract type', () => {
  const errs = animalValidate({ _type: 'Animal', name: 'Generic' });
  assert(hasCode(errs, ErrorCode.ABSTRACT_TYPE), 'expected ABSTRACT_TYPE');
});

test('Discriminator: type not subtype of target', () => {
  const errs = animalValidate({ _type: 'Dog', name: 'Rex', breed: 'Labrador' }, 'Cat');
  assert(hasCode(errs, ErrorCode.TYPE_MISMATCH), 'expected TYPE_MISMATCH');
});

test('Discriminator: valid concrete subtype', () => {
  const errs = animalValidate({ _type: 'Dog', name: 'Rex', breed: 'Labrador' });
  assertEmpty(errs, 'expected no errors');
});

test('Discriminator: custom discriminatorValue', () => {
  const r = new Registry();
  r.loadDict({
    '$oojs': '1.0', '$id': 'https://example.org/schemas/dv-test',
    types: {
      Vehicle: { abstract: true, properties: { speed: { type: 'number' } } },
      Car: { extends: 'Vehicle', discriminatorValue: 'automobile' },
    },
  });
  const schema = r.getSchema('https://example.org/schemas/dv-test');
  const errs = validate({ _type: 'automobile', speed: 100 }, schema.types['Vehicle'], schema, r);
  assertEmpty(errs, 'expected no errors');
});

// ---------------------------------------------------------------------------
// Required properties (§5.6, §9.2 Phase 2)
// ---------------------------------------------------------------------------

test('Required: missing own required', () => {
  const errs = animalValidate({ _type: 'Dog', name: 'Rex' }); // missing breed
  assert(hasCodeAndMessage(errs, ErrorCode.MISSING_REQUIRED, 'breed'), 'expected MISSING_REQUIRED for breed');
});

test('Required: missing inherited required', () => {
  const errs = animalValidate({ _type: 'Dog', breed: 'Labrador' }); // missing name
  assert(hasCodeAndMessage(errs, ErrorCode.MISSING_REQUIRED, 'name'), 'expected MISSING_REQUIRED for name');
});

test('Required: all required present', () => {
  const errs = animalValidate({ _type: 'Dog', name: 'Rex', breed: 'Labrador' });
  assertEmpty(errs, 'expected no errors');
});

test('Required: optional property absent is ok', () => {
  const errs = animalValidate({ _type: 'Cat', name: 'Whiskers' }); // indoor is optional
  assertEmpty(errs, 'expected no errors');
});

// ---------------------------------------------------------------------------
// Additional properties (§8.4, §9.2 Phase 3)
// ---------------------------------------------------------------------------

test('AdditionalProperties: extra property rejected in closed world', () => {
  const { r, schema } = animalRegistry();
  const errs = validate(
    { _type: 'Dog', name: 'Rex', breed: 'Lab', color: 'black' },
    schema.types['Dog'], schema, r,
  );
  assert(hasCode(errs, ErrorCode.ADDITIONAL_PROPERTY), 'expected ADDITIONAL_PROPERTY');
});

test('AdditionalProperties: open world allows extra', () => {
  const r = new Registry();
  r.loadDict({
    '$oojs': '1.0', '$id': 'https://example.org/schemas/open',
    additionalProperties: true,
    types: { Foo: { properties: { x: { type: 'string' } } } },
  });
  const schema = r.getSchema('https://example.org/schemas/open');
  const errs = validate({ _type: 'Foo', x: 'hello', extra: 99 }, schema.types['Foo'], schema, r);
  assertEmpty(errs, 'expected no errors');
});

// ---------------------------------------------------------------------------
// String constraints (§6.1)
// ---------------------------------------------------------------------------

function strSchema(constraints) {
  const r = new Registry();
  r.loadDict({
    '$oojs': '1.0', '$id': 'https://example.org/schemas/str-test',
    types: { Str: { properties: { v: { type: 'string', ...constraints } } } },
  });
  const schema = r.getSchema('https://example.org/schemas/str-test');
  return { r, schema };
}

function strErrs(value, constraints = {}) {
  const { r, schema } = strSchema(constraints);
  return validate({ _type: 'Str', v: value }, schema.types['Str'], schema, r);
}

test('StringConstraints: minLength ok', () => assertEmpty(strErrs('hi', { minLength: 2 })));
test('StringConstraints: minLength fail', () => {
  assert(hasCode(strErrs('x', { minLength: 2 }), ErrorCode.STRING_TOO_SHORT));
});
test('StringConstraints: maxLength ok', () => assertEmpty(strErrs('hi', { maxLength: 5 })));
test('StringConstraints: maxLength fail', () => {
  assert(hasCode(strErrs('toolong', { maxLength: 5 }), ErrorCode.STRING_TOO_LONG));
});
test('StringConstraints: pattern match', () => assertEmpty(strErrs('abc123', { pattern: '^[a-z]+[0-9]+$' })));
test('StringConstraints: pattern no match', () => {
  assert(hasCode(strErrs('123abc', { pattern: '^[a-z]+[0-9]+$' }), ErrorCode.PATTERN_MISMATCH));
});
test('StringConstraints: enum match', () => assertEmpty(strErrs('yes', { enum: ['yes', 'no'] })));
test('StringConstraints: enum mismatch', () => {
  assert(hasCode(strErrs('maybe', { enum: ['yes', 'no'] }), ErrorCode.ENUM_MISMATCH));
});
test('StringConstraints: type mismatch', () => {
  assert(hasCode(strErrs(42), ErrorCode.TYPE_MISMATCH));
});

// ---------------------------------------------------------------------------
// Numeric constraints (§6.1)
// ---------------------------------------------------------------------------

function numSchema(kind, constraints) {
  const r = new Registry();
  r.loadDict({
    '$oojs': '1.0', '$id': 'https://example.org/schemas/num-test',
    types: { Num: { properties: { v: { type: kind, ...constraints } } } },
  });
  const schema = r.getSchema('https://example.org/schemas/num-test');
  return { r, schema };
}

function numErrs(value, kind = 'number', constraints = {}) {
  const { r, schema } = numSchema(kind, constraints);
  return validate({ _type: 'Num', v: value }, schema.types['Num'], schema, r);
}

test('NumericConstraints: minimum ok', () => assertEmpty(numErrs(5, 'number', { minimum: 0 })));
test('NumericConstraints: minimum fail', () => {
  assert(hasCode(numErrs(-1, 'number', { minimum: 0 }), ErrorCode.BELOW_MINIMUM));
});
test('NumericConstraints: maximum ok', () => assertEmpty(numErrs(10, 'number', { maximum: 10 })));
test('NumericConstraints: maximum fail', () => {
  assert(hasCode(numErrs(11, 'number', { maximum: 10 }), ErrorCode.ABOVE_MAXIMUM));
});
test('NumericConstraints: exclusiveMinimum ok', () => assertEmpty(numErrs(1, 'number', { exclusiveMinimum: 0 })));
test('NumericConstraints: exclusiveMinimum fail', () => {
  assert(hasCode(numErrs(0, 'number', { exclusiveMinimum: 0 }), ErrorCode.BELOW_EXCLUSIVE_MINIMUM));
});
test('NumericConstraints: exclusiveMaximum ok', () => assertEmpty(numErrs(9, 'number', { exclusiveMaximum: 10 })));
test('NumericConstraints: exclusiveMaximum fail', () => {
  assert(hasCode(numErrs(10, 'number', { exclusiveMaximum: 10 }), ErrorCode.ABOVE_EXCLUSIVE_MAXIMUM));
});
test('NumericConstraints: multipleOf ok', () => assertEmpty(numErrs(6, 'number', { multipleOf: 3 })));
test('NumericConstraints: multipleOf fail', () => {
  assert(hasCode(numErrs(7, 'number', { multipleOf: 3 }), ErrorCode.NOT_MULTIPLE_OF));
});
test('NumericConstraints: integer ok', () => assertEmpty(numErrs(3, 'integer')));
test('NumericConstraints: integer float with fraction', () => {
  assert(hasCode(numErrs(3.5, 'integer'), ErrorCode.NOT_INTEGER));
});
test('NumericConstraints: integer float no fraction', () => {
  assertEmpty(numErrs(3.0, 'integer')); // 3.0 is acceptable
});
test('NumericConstraints: enum number ok', () => assertEmpty(numErrs(2, 'number', { enum: [1, 2, 3] })));
test('NumericConstraints: enum number fail', () => {
  assert(hasCode(numErrs(5, 'number', { enum: [1, 2, 3] }), ErrorCode.ENUM_MISMATCH));
});

// ---------------------------------------------------------------------------
// Array constraints (§6.3, §9.2 Phase 4)
// ---------------------------------------------------------------------------

function arrSchema(itemType = 'string', constraints = {}) {
  const r = new Registry();
  r.loadDict({
    '$oojs': '1.0', '$id': 'https://example.org/schemas/arr-test',
    types: { Arr: { properties: { v: { type: 'array', items: { type: itemType }, ...constraints } } } },
  });
  const schema = r.getSchema('https://example.org/schemas/arr-test');
  return { r, schema };
}

function arrErrs(value, constraints = {}) {
  const { r, schema } = arrSchema('string', constraints);
  return validate({ _type: 'Arr', v: value }, schema.types['Arr'], schema, r);
}

test('ArrayConstraints: not array', () => {
  assert(hasCode(arrErrs('notarray'), ErrorCode.TYPE_MISMATCH));
});
test('ArrayConstraints: minItems ok', () => assertEmpty(arrErrs(['a', 'b'], { minItems: 2 })));
test('ArrayConstraints: minItems fail', () => {
  assert(hasCode(arrErrs(['a'], { minItems: 2 }), ErrorCode.ARRAY_TOO_SHORT));
});
test('ArrayConstraints: maxItems ok', () => assertEmpty(arrErrs(['a'], { maxItems: 2 })));
test('ArrayConstraints: maxItems fail', () => {
  assert(hasCode(arrErrs(['a', 'b', 'c'], { maxItems: 2 }), ErrorCode.ARRAY_TOO_LONG));
});
test('ArrayConstraints: uniqueItems ok', () => assertEmpty(arrErrs(['a', 'b'], { uniqueItems: true })));
test('ArrayConstraints: uniqueItems fail', () => {
  assert(hasCode(arrErrs(['a', 'a'], { uniqueItems: true }), ErrorCode.ARRAY_DUPLICATE_ITEMS));
});
test('ArrayConstraints: item constraint propagated', () => {
  const r = new Registry();
  r.loadDict({
    '$oojs': '1.0', '$id': 'https://example.org/schemas/arr-item-constraint',
    types: {
      Arr: { properties: { v: { type: 'array', items: { type: 'string', maxLength: 5 } } } },
    },
  });
  const schema = r.getSchema('https://example.org/schemas/arr-item-constraint');
  const errs = validate({ _type: 'Arr', v: ['toolong'] }, schema.types['Arr'], schema, r);
  assert(hasCode(errs, ErrorCode.STRING_TOO_LONG));
});

// ---------------------------------------------------------------------------
// Polymorphic array (§7, §8)
// ---------------------------------------------------------------------------

function polySetup() {
  const r = new Registry();
  r.loadDict({
    '$oojs': '1.0', '$id': 'https://example.org/schemas/poly',
    types: {
      Shape: { abstract: true, properties: { color: { type: 'string' } } },
      Circle: {
        extends: 'Shape',
        properties: { radius: { type: 'number' } },
        required: ['radius'],
      },
      Rect: {
        extends: 'Shape',
        properties: { width: { type: 'number' }, height: { type: 'number' } },
        required: ['width', 'height'],
      },
      Canvas: {
        properties: {
          shapes: { type: 'array', items: { type: 'Shape' } },
        },
      },
    },
  });
  const schema = r.getSchema('https://example.org/schemas/poly');
  return { r, schema };
}

test('PolymorphicArray: valid mixed-type array', () => {
  const { r, schema } = polySetup();
  const instance = {
    _type: 'Canvas',
    shapes: [
      { _type: 'Circle', radius: 5.0 },
      { _type: 'Rect', width: 10.0, height: 4.0 },
    ],
  };
  assertEmpty(validate(instance, schema.types['Canvas'], schema, r));
});

test('PolymorphicArray: abstract item rejected', () => {
  const { r, schema } = polySetup();
  const instance = { _type: 'Canvas', shapes: [{ _type: 'Shape', color: 'red' }] };
  assert(hasCode(validate(instance, schema.types['Canvas'], schema, r), ErrorCode.ABSTRACT_TYPE));
});

test('PolymorphicArray: missing required in array item', () => {
  const { r, schema } = polySetup();
  const instance = { _type: 'Canvas', shapes: [{ _type: 'Circle' }] }; // missing radius
  assert(hasCode(validate(instance, schema.types['Canvas'], schema, r), ErrorCode.MISSING_REQUIRED));
});

// ---------------------------------------------------------------------------
// Fail-fast (§9.6)
// ---------------------------------------------------------------------------

test('FailFast: returns single error', () => {
  const { r, schema } = animalRegistry();
  const instance = { _type: 'Dog' }; // missing name and breed
  const errs = validate(instance, schema.types['Animal'], schema, r, true);
  assertEqual(errs.length, 1, 'fail-fast should return exactly 1 error');
});

test('FailFast: full mode returns all errors', () => {
  const { r, schema } = animalRegistry();
  const instance = { _type: 'Dog' }; // missing name and breed → ≥2 errors
  const errs = validate(instance, schema.types['Animal'], schema, r, false);
  assert(errs.length >= 2, `expected ≥2 errors, got ${errs.length}`);
});

// ---------------------------------------------------------------------------
// Clinical example — inline data (integration test)
// ---------------------------------------------------------------------------

const CLINICAL_SCHEMA = {
  '$oojs': '1.0',
  '$id': 'https://example.org/schemas/clinical',
  title: 'Clinical Entries',
  discriminator: '_type',
  types: {
    ClinicalEntry: {
      abstract: true,
      properties: {
        id:        { type: 'string', minLength: 1 },
        timestamp: { type: 'string', format: 'date-time' },
        subjectId: { type: 'string' },
      },
      required: ['id', 'timestamp', 'subjectId'],
    },
    Observation: {
      extends: 'ClinicalEntry',
      properties: {
        code:  { type: 'string' },
        value: { type: 'number' },
        unit:  { type: 'string' },
      },
      required: ['code', 'value'],
    },
    Diagnosis: {
      extends: 'ClinicalEntry',
      properties: {
        icdCode:     { type: 'string', pattern: '^[A-Z][0-9]{2}(\\.[0-9]{1,4})?$' },
        description: { type: 'string' },
        certainty:   { type: 'string', enum: ['confirmed', 'probable', 'possible'] },
      },
      required: ['icdCode', 'certainty'],
    },
    Procedure: {
      extends: 'ClinicalEntry',
      properties: {
        code:        { type: 'string' },
        description: { type: 'string' },
        outcome:     { type: 'string', enum: ['successful', 'unsuccessful', 'partial'] },
      },
      required: ['code'],
    },
    Encounter: {
      properties: {
        id:        { type: 'string', minLength: 1 },
        patientId: { type: 'string' },
        startTime: { type: 'string', format: 'date-time' },
        endTime:   { type: 'string', format: 'date-time' },
        findings:  { type: 'array', items: { type: 'ClinicalEntry' } },
      },
      required: ['id', 'patientId'],
    },
  },
};

const CLINICAL_VALID = [
  {
    _type: 'Observation',
    id: 'obs-001', timestamp: '2026-03-29T10:00:00Z', subjectId: 'patient-42',
    code: '8480-6', value: 120, unit: 'mmHg',
  },
  {
    _type: 'Diagnosis',
    id: 'dx-001', timestamp: '2026-03-29T10:05:00Z', subjectId: 'patient-42',
    icdCode: 'J18.9', description: 'Community-acquired pneumonia', certainty: 'confirmed',
  },
  {
    _type: 'Encounter',
    id: 'enc-001', patientId: 'patient-42', startTime: '2026-03-29T09:00:00Z',
    findings: [
      {
        _type: 'Observation',
        id: 'obs-002', timestamp: '2026-03-29T09:15:00Z', subjectId: 'patient-42',
        code: '8310-5', value: 37.2, unit: 'Cel',
      },
      {
        _type: 'Procedure',
        id: 'proc-001', timestamp: '2026-03-29T09:30:00Z', subjectId: 'patient-42',
        code: '33195004', description: 'Blood draw', outcome: 'successful',
      },
    ],
  },
];

const CLINICAL_INVALID = [
  { _type: 'ClinicalEntry', id: 'entry-001', timestamp: '2026-03-29T10:00:00Z', subjectId: 'patient-42' },
  { _type: 'Diagnosis', id: 'dx-002', subjectId: 'patient-42', icdCode: 'J18.9', certainty: 'confirmed' },
  { id: 'obs-003', timestamp: '2026-03-29T10:00:00Z', subjectId: 'patient-42', code: '8480-6', value: 120 },
  { _type: 'Diagnosis', id: 'dx-003', timestamp: '2026-03-29T10:00:00Z', subjectId: 'patient-42', icdCode: 'J18.9', certainty: 'definite' },
];

test('ClinicalExample: valid instances pass', () => {
  const r = new Registry();
  const schema = r.loadDict(CLINICAL_SCHEMA);
  for (const inst of CLINICAL_VALID) {
    const dv = inst['_type'];
    const typedef = schema.types[dv];
    if (!typedef) continue;
    const errs = validate(inst, typedef, schema, r);
    assertEmpty(errs, `Expected valid but got errors for ${dv}: ${errs.map(e => e.toString()).join(', ')}`);
  }
});

test('ClinicalExample: invalid instances fail', () => {
  const r = new Registry();
  const schema = r.loadDict(CLINICAL_SCHEMA);
  for (const inst of CLINICAL_INVALID) {
    const dv = inst['_type'];
    const target = dv ? (schema.types[dv] ?? Object.values(schema.types)[0]) : schema.types['Observation'];
    const errs = validate(inst, target, schema, r);
    assertNotEmpty(errs, `Expected validation errors for invalid instance (_type=${dv ?? 'none'})`);
  }
});

// ---------------------------------------------------------------------------
// Subtype check (§9.4)
// ---------------------------------------------------------------------------

test('SubtypeCheck: direct subtype', () => {
  const { schema } = animalRegistry();
  assert(schema.types['Dog'].isSubtypeOf(schema.types['Animal']));
});

test('SubtypeCheck: same type', () => {
  const { schema } = animalRegistry();
  assert(schema.types['Dog'].isSubtypeOf(schema.types['Dog']));
});

test('SubtypeCheck: not subtype', () => {
  const { schema } = animalRegistry();
  assert(!schema.types['Cat'].isSubtypeOf(schema.types['Dog']));
});

test('SubtypeCheck: transitive', () => {
  const r = new Registry();
  r.loadDict({
    '$oojs': '1.0', '$id': 'https://example.org/schemas/deep',
    types: { A: { abstract: true }, B: { extends: 'A' }, C: { extends: 'B' }, D: { extends: 'C' } },
  });
  const schema = r.getSchema('https://example.org/schemas/deep');
  assert(schema.types['D'].isSubtypeOf(schema.types['A']));
});

// ---------------------------------------------------------------------------
// Effective property set (§9.5)
// ---------------------------------------------------------------------------

test('EffectivePropertySet: inherits parent properties', () => {
  const { schema } = animalRegistry();
  const eff = schema.types['Dog'].effectiveProperties();
  assert('name' in eff, 'should inherit name from Animal');
  assert('age' in eff, 'should inherit age from Animal');
  assert('breed' in eff, 'should have own breed');
});

test('EffectivePropertySet: effectiveRequired union', () => {
  const { schema } = animalRegistry();
  const req = schema.types['Dog'].effectiveRequired();
  assert(req.includes('name'), 'should include inherited name');
  assert(req.includes('breed'), 'should include own breed');
});

// ---------------------------------------------------------------------------
// ValidationError model
// ---------------------------------------------------------------------------

test('ValidationError: toString format', () => {
  const { r, schema } = animalRegistry();
  const errs = validate({ _type: 'Dog', breed: 'Lab' }, schema.types['Animal'], schema, r);
  const err = errs.find(e => e.code === ErrorCode.MISSING_REQUIRED);
  assert(err !== undefined, 'expected a MISSING_REQUIRED error');
  const str = err.toString();
  assert(str.includes('[MISSING_REQUIRED]'), `toString should include code: ${str}`);
  assert(str.includes('name'), `toString should include message: ${str}`);
  assert(str.startsWith('/'), `toString should start with path: ${str}`);
});

// ---------------------------------------------------------------------------
// Registry — loadJson / loadFile edge cases
// ---------------------------------------------------------------------------

test('Registry: loadJson invalid JSON', () => {
  let threw = false;
  try { new Registry().loadJson('{'); } catch (e) { threw = true; assert(/invalid JSON/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: loadJson success', () => {
  const schema = new Registry().loadJson(JSON.stringify(MINIMAL_SCHEMA));
  assert(schema.schemaId === 'https://example.org/schemas/test');
});

test('Registry: schema must be a JSON object', () => {
  let threw = false;
  try { new Registry().loadJson('null'); } catch (e) { threw = true; assert(/schema must be a JSON object/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: $id must be non-empty string', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': '', types: { A: {} } }); } catch (e) { threw = true; assert(/non-empty string/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: discriminator must be non-empty string', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', discriminator: '', types: { A: {} } }); } catch (e) { threw = true; assert(/discriminator/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: imports must be an object', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', imports: 'nope', types: { A: {} } }); } catch (e) { threw = true; assert(/imports/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: import alias must match naming rules', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', imports: { BadAlias: 'https://x' }, types: { A: {} } }); } catch (e) { threw = true; assert(/import alias/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: import value must be string', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', imports: { other: 123 }, types: { A: {} } }); } catch (e) { threw = true; assert(/import value/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: type definition must be object', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: 'nope' } }); } catch (e) { threw = true; assert(/definition must be a JSON object/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: extends must be string', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { extends: 123 } } }); } catch (e) { threw = true; assert(/extends/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: abstract must be boolean', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { abstract: 'yes' } } }); } catch (e) { threw = true; assert(/abstract/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: discriminatorValue must be string', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { discriminatorValue: 1 } } }); } catch (e) { threw = true; assert(/discriminatorValue/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: properties must be object', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: 'bad' } } }); } catch (e) { threw = true; assert(/properties/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: required must be array', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { required: 'bad' } } }); } catch (e) { threw = true; assert(/required/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: required entries must be strings', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { required: [1] } } }); } catch (e) { threw = true; assert(/'required' entries must be strings/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: required duplicates rejected', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { a: { type: 'string' } }, required: ['a', 'a'] } } }); } catch (e) { threw = true; assert(/more than once/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: property must be object', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { p: 'bad' } } } }); } catch (e) { threw = true; assert(/must be a JSON object/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: property missing type', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { p: {} } } } }); } catch (e) { threw = true; assert(/missing 'type'/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: property type must be string', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { p: { type: 1 } } } } }); } catch (e) { threw = true; assert(/'type' must be a string/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: invalid minLength (negative)', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { s: { type: 'string', minLength: -1 } } } } }); } catch (e) { threw = true; assert(/non-negative integer/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: boolean used for minimum', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { n: { type: 'integer', minimum: true } } } } }); } catch (e) { threw = true; assert(/must be a number/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: minLength greater than maxLength', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { s: { type: 'string', minLength: 5, maxLength: 3 } } } } }); } catch (e) { threw = true; assert(/'minLength' > 'maxLength'/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: pattern must be string', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { s: { type: 'string', pattern: 123 } } } } }); } catch (e) { threw = true; assert(/pattern/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: string enum must be non-empty array', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { s: { type: 'string', enum: [] } } } } }); } catch (e) { threw = true; assert(/enum/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: exclusiveMaximum conflicts with maximum', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { n: { type: 'number', maximum: 1, exclusiveMaximum: 1 } } } } }); } catch (e) { threw = true; assert(/mutually exclusive/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: multipleOf must be greater than zero', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { n: { type: 'number', multipleOf: 0 } } } } }); } catch (e) { threw = true; assert(/multipleOf/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: numeric enum must be non-empty array', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { n: { type: 'number', enum: [] } } } } }); } catch (e) { threw = true; assert(/enum/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: array missing items', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { arr: { type: 'array' } } } } }); } catch (e) { threw = true; assert(/missing 'items'/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: array minItems must be non-negative integer', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { arr: { type: 'array', items: { type: 'string' }, minItems: -1 } } } } }); } catch (e) { threw = true; assert(/non-negative integer/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: array minItems greater than maxItems', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { arr: { type: 'array', items: { type: 'string' }, minItems: 5, maxItems: 3 } } } } }); } catch (e) { threw = true; assert(/'minItems' > 'maxItems'/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: uniqueItems must be boolean', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { arr: { type: 'array', items: { type: 'string' }, uniqueItems: 'yes' } } } } }); } catch (e) { threw = true; assert(/uniqueItems/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: imported schema not loaded', () => {
  let threw = false;
  try { makeRegistry({ '$oojs': '1.0', '$id': 'x', imports: { other: 'https://example.org/schemas/other' }, types: { Foo: { extends: 'other.Bar' } } }); } catch (e) { threw = true; assert(/not loaded/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

test('Registry: imported type missing', () => {
  let threw = false;
  const r = new Registry();
  r.loadDict({ '$oojs': '1.0', '$id': 'https://example.org/schemas/other', types: { Pet: {} } });
  try { r.loadDict({ '$oojs': '1.0', '$id': 'x', imports: { other: 'https://example.org/schemas/other' }, types: { Foo: { extends: 'other.Missing' } } }); } catch (e) { threw = true; assert(/not found in schema/i.test(e.message)); }
  assert(threw, 'expected SchemaError');
});

// ---------------------------------------------------------------------------
// Validator — validateJson
// ---------------------------------------------------------------------------

test('Validator: validateJson invalid JSON', () => {
  const { r, schema } = animalRegistry();
  let threw = false;
  try { new Validator(r).validateJson('{', 'Dog', schema); }
  catch (e) { threw = true; assert(/Invalid JSON/i.test(e.message)); }
  assert(threw, 'expected Error');
});

test('Validator: validateJson unknown type name', () => {
  const { r, schema } = animalRegistry();
  let threw = false;
  try { new Validator(r).validateJson('{"_type":"Dog"}', 'Missing', schema); }
  catch (e) { threw = true; assert(/not found/i.test(e.message)); }
  assert(threw, 'expected Error');
});

test('Validator: validateJson success', () => {
  const { r, schema } = animalRegistry();
  const errs = new Validator(r).validateJson('{"_type":"Dog","name":"Rex","breed":"Lab"}', 'Dog', schema);
  assertEmpty(errs, 'expected no errors');
});

// ---------------------------------------------------------------------------
// Validator — type reference edge cases
// ---------------------------------------------------------------------------

test('TypeRef: non-object value gives TYPE_MISMATCH', () => {
  const r = new Registry();
  r.loadDict({
    '$oojs': '1.0', '$id': 'https://example.org/schemas/ref-mismatch',
    types: {
      Parent: { properties: { child: { type: 'Child' } }, required: ['child'] },
      Child: { properties: { name: { type: 'string' } }, required: ['name'] },
    },
  });
  const schema = r.getSchema('https://example.org/schemas/ref-mismatch');
  const errs = validate({ _type: 'Parent', child: 'nope' }, schema.types['Parent'], schema, r);
  assert(hasCode(errs, ErrorCode.TYPE_MISMATCH));
});

test('TypeRef: unresolvable type gives UNKNOWN_TYPE', () => {
  const r = new Registry();
  r.loadDict({
    '$oojs': '1.0', '$id': 'https://example.org/schemas/ref-unknown',
    types: { Parent: { properties: { child: { type: 'MissingType' } }, required: ['child'] } },
  });
  const schema = r.getSchema('https://example.org/schemas/ref-unknown');
  const errs = validate({ _type: 'Parent', child: { x: 1 } }, schema.types['Parent'], schema, r);
  assert(hasCode(errs, ErrorCode.UNKNOWN_TYPE));
});

test('TypeRef: resolves via imports', () => {
  const r = new Registry();
  r.loadDict({ '$oojs': '1.0', '$id': 'https://example.org/schemas/other', types: { Pet: { properties: { name: { type: 'string' } }, required: ['name'] } } });
  r.loadDict({ '$oojs': '1.0', '$id': 'https://example.org/schemas/owner', imports: { other: 'https://example.org/schemas/other' }, types: { Owner: { properties: { pet: { type: 'other.Pet' } }, required: ['pet'] } } });
  const schema = r.getSchema('https://example.org/schemas/owner');
  const errs = validate({ _type: 'Owner', pet: { _type: 'Pet', name: 'Fido' } }, schema.types['Owner'], schema, r);
  assertEmpty(errs);
});

// ---------------------------------------------------------------------------
// Validator — jsonTypeName in error messages
// ---------------------------------------------------------------------------

test('jsonTypeName: null in TYPE_MISMATCH message', () => {
  const { r, schema: s } = (() => {
    const r = new Registry();
    r.loadDict({ '$oojs': '1.0', '$id': 'x', types: { Str: { properties: { v: { type: 'string' } } } } });
    return { r, schema: r.getSchema('x') };
  })();
  const errs = validate({ _type: 'Str', v: null }, s.types['Str'], s, r);
  assert(hasCodeAndMessage(errs, ErrorCode.TYPE_MISMATCH, 'null'));
});

test('jsonTypeName: boolean in TYPE_MISMATCH message', () => {
  const r = new Registry();
  r.loadDict({ '$oojs': '1.0', '$id': 'x', types: { Str: { properties: { v: { type: 'string' } } } } });
  const schema = r.getSchema('x');
  const errs = validate({ _type: 'Str', v: true }, schema.types['Str'], schema, r);
  assert(hasCodeAndMessage(errs, ErrorCode.TYPE_MISMATCH, 'boolean'));
});

test('jsonTypeName: array in TYPE_MISMATCH message', () => {
  const r = new Registry();
  r.loadDict({ '$oojs': '1.0', '$id': 'x', types: { Num: { properties: { v: { type: 'integer' } } } } });
  const schema = r.getSchema('x');
  const errs = validate({ _type: 'Num', v: [1] }, schema.types['Num'], schema, r);
  assert(hasCodeAndMessage(errs, ErrorCode.TYPE_MISMATCH, 'array'));
});

test('null and boolean property types pass validation', () => {
  const r = new Registry();
  r.loadDict({ '$oojs': '1.0', '$id': 'x', types: { Foo: { properties: { n: { type: 'null' }, b: { type: 'boolean' } }, required: ['n', 'b'] } } });
  const schema = r.getSchema('x');
  assertEmpty(validate({ _type: 'Foo', n: null, b: true }, schema.types['Foo'], schema, r));
});

// ---------------------------------------------------------------------------
// Fail-fast — extended coverage
// ---------------------------------------------------------------------------

test('FailFast: non-object instance returns single TYPE_MISMATCH', () => {
  const { r, schema } = animalRegistry();
  const errs = validate('nope', schema.types['Animal'], schema, r, true);
  assertEqual(errs.length, 1);
  assertEqual(errs[0].code, ErrorCode.TYPE_MISMATCH);
});

test('FailFast: additional property stops at first', () => {
  const { r, schema } = animalRegistry();
  const errs = validate({ _type: 'Dog', name: 'Rex', breed: 'Lab', color: 'black' }, schema.types['Dog'], schema, r, true);
  assertEqual(errs.length, 1);
  assertEqual(errs[0].code, ErrorCode.ADDITIONAL_PROPERTY);
});

function ffArr(v, constraints = {}) {
  const r = new Registry();
  r.loadDict({ '$oojs': '1.0', '$id': 'x', types: { Arr: { properties: { v: { type: 'array', items: { type: 'string' }, ...constraints } } } } });
  const schema = r.getSchema('x');
  return validate({ _type: 'Arr', v }, schema.types['Arr'], schema, r, true);
}

test('FailFast: array too short', () => { const e = ffArr(['a'], { minItems: 2 }); assertEqual(e.length, 1); assertEqual(e[0].code, ErrorCode.ARRAY_TOO_SHORT); });
test('FailFast: array too long', () => { const e = ffArr(['a','b'], { maxItems: 1 }); assertEqual(e.length, 1); assertEqual(e[0].code, ErrorCode.ARRAY_TOO_LONG); });
test('FailFast: array duplicate items', () => { const e = ffArr(['a','a'], { uniqueItems: true }); assertEqual(e.length, 1); assertEqual(e[0].code, ErrorCode.ARRAY_DUPLICATE_ITEMS); });
test('FailFast: array item validation', () => { const e = ffArr([123]); assertEqual(e.length, 1); assertEqual(e[0].code, ErrorCode.TYPE_MISMATCH); });

function ffNum(v, kind, constraints = {}) {
  const r = new Registry();
  r.loadDict({ '$oojs': '1.0', '$id': 'x', types: { Num: { properties: { n: { type: kind, ...constraints } } } } });
  const schema = r.getSchema('x');
  return validate({ _type: 'Num', n: v }, schema.types['Num'], schema, r, true);
}

test('FailFast: integer fraction', () => { const e = ffNum(3.5, 'integer'); assertEqual(e.length, 1); assertEqual(e[0].code, ErrorCode.NOT_INTEGER); });
test('FailFast: number below minimum', () => { const e = ffNum(-1, 'number', { minimum: 0 }); assertEqual(e.length, 1); assertEqual(e[0].code, ErrorCode.BELOW_MINIMUM); });
test('FailFast: number above maximum', () => { const e = ffNum(2, 'number', { maximum: 1 }); assertEqual(e.length, 1); assertEqual(e[0].code, ErrorCode.ABOVE_MAXIMUM); });
test('FailFast: number below exclusive minimum', () => { const e = ffNum(0, 'number', { exclusiveMinimum: 0 }); assertEqual(e.length, 1); assertEqual(e[0].code, ErrorCode.BELOW_EXCLUSIVE_MINIMUM); });
test('FailFast: number above exclusive maximum', () => { const e = ffNum(1, 'number', { exclusiveMaximum: 1 }); assertEqual(e.length, 1); assertEqual(e[0].code, ErrorCode.ABOVE_EXCLUSIVE_MAXIMUM); });
test('FailFast: number not multiple of', () => { const e = ffNum(3, 'number', { multipleOf: 2 }); assertEqual(e.length, 1); assertEqual(e[0].code, ErrorCode.NOT_MULTIPLE_OF); });
test('FailFast: number enum mismatch', () => { const e = ffNum(3, 'number', { enum: [1, 2] }); assertEqual(e.length, 1); assertEqual(e[0].code, ErrorCode.ENUM_MISMATCH); });

function ffStr(v, constraints = {}) {
  const r = new Registry();
  r.loadDict({ '$oojs': '1.0', '$id': 'x', types: { Str: { properties: { s: { type: 'string', ...constraints } } } } });
  const schema = r.getSchema('x');
  return validate({ _type: 'Str', s: v }, schema.types['Str'], schema, r, true);
}

test('FailFast: string too short', () => { const e = ffStr('a', { minLength: 2 }); assertEqual(e.length, 1); assertEqual(e[0].code, ErrorCode.STRING_TOO_SHORT); });
test('FailFast: string too long', () => { const e = ffStr('toolong', { maxLength: 2 }); assertEqual(e.length, 1); assertEqual(e[0].code, ErrorCode.STRING_TOO_LONG); });
test('FailFast: string invalid pattern', () => { const e = ffStr('a', { pattern: '(' }); assertEqual(e.length, 1); assertEqual(e[0].code, ErrorCode.PATTERN_MISMATCH); });
test('FailFast: string pattern mismatch', () => { const e = ffStr('b', { pattern: '^a+$' }); assertEqual(e.length, 1); assertEqual(e[0].code, ErrorCode.PATTERN_MISMATCH); });
test('FailFast: string enum mismatch', () => { const e = ffStr('b', { enum: ['a'] }); assertEqual(e.length, 1); assertEqual(e[0].code, ErrorCode.ENUM_MISMATCH); });

// ---------------------------------------------------------------------------
// Unique-items — object key canonicalization and nested arrays
// ---------------------------------------------------------------------------

test('UniqueItems: object key order is irrelevant', () => {
  const r = new Registry();
  r.loadDict({ '$oojs': '1.0', '$id': 'x', additionalProperties: true, types: { Obj: {}, Arr: { properties: { v: { type: 'array', items: { type: 'Obj' }, uniqueItems: true } } } } });
  const schema = r.getSchema('x');
  const errs = validate(
    { _type: 'Arr', v: [{ _type: 'Obj', a: 1, b: 2 }, { _type: 'Obj', b: 2, a: 1 }] },
    schema.types['Arr'], schema, r,
  );
  assert(hasCode(errs, ErrorCode.ARRAY_DUPLICATE_ITEMS));
});

test('UniqueItems: nested arrays treated as duplicates', () => {
  const r = new Registry();
  r.loadDict({ '$oojs': '1.0', '$id': 'x', types: { Arr: { properties: { v: { type: 'array', items: { type: 'string' }, uniqueItems: true } } } } });
  const schema = r.getSchema('x');
  // item values are arrays (mixed type check triggers TYPE_MISMATCH on items, but uniqueItems still runs)
  // easier: just validate primitive duplicates confirmed already; use object-in-array check
  const r2 = new Registry();
  r2.loadDict({ '$oojs': '1.0', '$id': 'y', additionalProperties: true, types: { Obj: {}, Arr: { properties: { v: { type: 'array', items: { type: 'Obj' }, uniqueItems: true } } } } });
  const s2 = r2.getSchema('y');
  const errs = validate(
    { _type: 'Arr', v: [{ _type: 'Obj', x: [1, 2] }, { _type: 'Obj', x: [1, 2] }] },
    s2.types['Arr'], s2, r2,
  );
  assert(hasCode(errs, ErrorCode.ARRAY_DUPLICATE_ITEMS));
});

// ---------------------------------------------------------------------------
// Sample schemas
// ---------------------------------------------------------------------------

test('Sample: car + motor + wheels (nested type-refs and fixed-count array)', () => {
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
  const schema = r.getSchema('https://example.org/schemas/car');
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
  assertEmpty(validate(inst, schema.types['Car'], schema, r));
});

test('Sample: fleet with has-many ID arrays (relationships via IDs)', () => {
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
  const schema = r.getSchema('https://example.org/schemas/car-rel');
  const inst = { _type: 'Fleet', fleetId: 'fleet-1', name: 'City Fleet', carIds: ['car-1', 'car-2'], personIds: ['person-1'] };
  assertEmpty(validate(inst, schema.types['Fleet'], schema, r));
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

test('Relationships: vertical has-one valid', () => {
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
  assertEmpty(validate(car, schema.types.Car, schema, r));
});

test('Relationships: vertical has-one embedded missing required field', () => {
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
  assert(hasCode(errs, ErrorCode.MISSING_REQUIRED));
});

test('Relationships: vertical has-many wrong count', () => {
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
  assert(hasCode(errs, ErrorCode.ARRAY_TOO_SHORT));
});

test('Relationships: horizontal has-one wrong type for id', () => {
  const r = new Registry();
  const schema = r.loadDict(relHorizontalSchema());
  const car = { _type: 'Car', carId: 'car-1', make: 'Acme', ownerId: 12345 };
  const errs = validate(car, schema.types.Car, schema, r);
  assert(hasCode(errs, ErrorCode.TYPE_MISMATCH));
});

test('Relationships: bidirectional inconsistency passes individual validation', () => {
  const r = new Registry();
  const schema = r.loadDict(relHorizontalSchema());
  const person = { _type: 'Person', personId: 'person-1', name: 'Alice', carIds: ['car-X'] };
  const car = { _type: 'Car', carId: 'car-X', make: 'Acme', ownerId: 'person-99' };
  assertEmpty(validate(person, schema.types.Person, schema, r));
  assertEmpty(validate(car, schema.types.Car, schema, r));
});

// ---------------------------------------------------------------------------
// Cycles (§8.13)
// ---------------------------------------------------------------------------

test('Cycle: self-referential type schema loads', () => {
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
  assert('Employee' in schema.types);
});

test('Cycle: two-type cycle schema loads', () => {
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
  assert('Employee' in schema.types && 'Department' in schema.types);
});

test('Cycle: finite nested self-reference validates', () => {
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
  assertEmpty(validate(alice, schema.types.Employee, schema, r));
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

test('GraphDocument: valid shared reference graph', () => {
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

  const errs = new Validator(r).validateGraphDocument(graphDoc, schema);
  assertEmpty(errs);
});

test('GraphDocument: unresolved $ref-id produces error', () => {
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
  assertNotEmpty(errs);
  assert(hasCode(errs, ErrorCode.UNRESOLVED_REFERENCE));
});

test('GraphDocument: ref-id target type mismatch produces error', () => {
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
  assertNotEmpty(errs);
  assert(hasCode(errs, ErrorCode.TYPE_MISMATCH));
});

test('GraphDocument: root missing $type produces error', () => {
  const r = new Registry();
  const schema = r.loadDict(employeeGraphSchema());

  const graphDoc = {
    '$oojs': '1.0',
    roots: [
      { '$id': 'emp-alice', employeeId: 'E-001', name: 'Alice' },
    ],
  };

  const errs = new Validator(r).validateGraphDocument(graphDoc, schema);
  assertNotEmpty(errs);
  assert(hasCode(errs, ErrorCode.MISSING_DISCRIMINATOR));
});

// ---------------------------------------------------------------------------
// §8.7 — Cardinality × Structure combinations
// ---------------------------------------------------------------------------

function relationshipsSchema() {
  return {
    '$oojs': '1.0', '$id': 'https://example.org/schemas/relationships',
    discriminator: '_type',
    types: {
      Address: {
        properties: {
          street:  { type: 'string', minLength: 1 },
          city:    { type: 'string', minLength: 1 },
          country: { type: 'string', minLength: 1 },
        },
        required: ['street', 'city'],
      },
      Badge: {
        properties: {
          badgeId: { type: 'string', minLength: 1 },
          label:   { type: 'string', minLength: 1 },
          level:   { type: 'integer', minimum: 1, maximum: 5 },
        },
        required: ['badgeId', 'label'],
      },
      Employee: {
        properties: {
          employeeId:   { type: 'string', minLength: 1 },
          name:         { type: 'string', minLength: 1 },
          address:      { type: 'Address' },
          badges:       { type: 'array', items: { type: 'Badge' } },
          departmentId: { type: 'string', minLength: 1 },
          projectIds:   { type: 'array', items: { type: 'string' } },
        },
        required: ['employeeId', 'name', 'departmentId'],
      },
    },
  };
}

// --- has-one vertical ---

test('RelCardinality: has-one vertical valid embedded object', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = {
    _type: 'Employee', employeeId: 'emp-001', name: 'Alice', departmentId: 'dept-eng',
    address: { _type: 'Address', street: '1 Main St', city: 'Springfield' },
  };
  assertEmpty(validate(emp, schema.types.Employee, schema, r));
});

test('RelCardinality: has-one vertical optional may be absent', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = { _type: 'Employee', employeeId: 'emp-002', name: 'Bob', departmentId: 'dept-ops' };
  assertEmpty(validate(emp, schema.types.Employee, schema, r));
});

test('RelCardinality: has-one vertical missing required field in embedded object', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = {
    _type: 'Employee', employeeId: 'emp-003', name: 'Carol', departmentId: 'dept-eng',
    address: { _type: 'Address', city: 'Springfield' }, // street absent
  };
  const errs = validate(emp, schema.types.Employee, schema, r);
  assert(hasCode(errs, ErrorCode.MISSING_REQUIRED));
});

test('RelCardinality: has-one vertical type mismatch — wrong embedded type', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = {
    _type: 'Employee', employeeId: 'emp-004', name: 'Dave', departmentId: 'dept-eng',
    address: { _type: 'Badge', badgeId: 'b-1', label: 'X' },
  };
  const errs = validate(emp, schema.types.Employee, schema, r);
  assert(hasCode(errs, ErrorCode.TYPE_MISMATCH));
});

test('RelCardinality: has-one vertical must be object not string', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = {
    _type: 'Employee', employeeId: 'emp-005', name: 'Eve', departmentId: 'dept-eng',
    address: 'not-an-object',
  };
  const errs = validate(emp, schema.types.Employee, schema, r);
  assert(hasCode(errs, ErrorCode.TYPE_MISMATCH));
});

// --- has-many vertical ---

test('RelCardinality: has-many vertical valid multiple items', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = {
    _type: 'Employee', employeeId: 'emp-010', name: 'Frank', departmentId: 'dept-eng',
    badges: [
      { _type: 'Badge', badgeId: 'b-1', label: 'Safety', level: 3 },
      { _type: 'Badge', badgeId: 'b-2', label: 'Leader' },
    ],
  };
  assertEmpty(validate(emp, schema.types.Employee, schema, r));
});

test('RelCardinality: has-many vertical valid empty array', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = { _type: 'Employee', employeeId: 'emp-011', name: 'Grace', departmentId: 'dept-hr', badges: [] };
  assertEmpty(validate(emp, schema.types.Employee, schema, r));
});

test('RelCardinality: has-many vertical missing required field in one item', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = {
    _type: 'Employee', employeeId: 'emp-012', name: 'Henry', departmentId: 'dept-eng',
    badges: [
      { _type: 'Badge', badgeId: 'b-ok', label: 'OK' },
      { _type: 'Badge', badgeId: 'b-bad' }, // label absent
    ],
  };
  const errs = validate(emp, schema.types.Employee, schema, r);
  assert(hasCode(errs, ErrorCode.MISSING_REQUIRED));
});

test('RelCardinality: has-many vertical constraint violation in one item', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = {
    _type: 'Employee', employeeId: 'emp-013', name: 'Iris', departmentId: 'dept-eng',
    badges: [{ _type: 'Badge', badgeId: 'b-1', label: 'Expert', level: 10 }], // max 5
  };
  const errs = validate(emp, schema.types.Employee, schema, r);
  assert(hasCode(errs, ErrorCode.ABOVE_MAXIMUM));
});

test('RelCardinality: has-many vertical must be array not object', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = {
    _type: 'Employee', employeeId: 'emp-014', name: 'Jack', departmentId: 'dept-eng',
    badges: { _type: 'Badge', badgeId: 'b-1', label: 'X' },
  };
  const errs = validate(emp, schema.types.Employee, schema, r);
  assert(hasCode(errs, ErrorCode.TYPE_MISMATCH));
});

// --- has-one horizontal ---

test('RelCardinality: has-one horizontal valid string id', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = { _type: 'Employee', employeeId: 'emp-020', name: 'Karen', departmentId: 'dept-eng' };
  assertEmpty(validate(emp, schema.types.Employee, schema, r));
});

test('RelCardinality: has-one horizontal required must be present', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = { _type: 'Employee', employeeId: 'emp-021', name: 'Leo' }; // departmentId absent
  const errs = validate(emp, schema.types.Employee, schema, r);
  assert(hasCode(errs, ErrorCode.MISSING_REQUIRED));
});

test('RelCardinality: has-one horizontal must be string not integer', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = { _type: 'Employee', employeeId: 'emp-022', name: 'Mia', departmentId: 42 };
  const errs = validate(emp, schema.types.Employee, schema, r);
  assert(hasCode(errs, ErrorCode.TYPE_MISMATCH));
});

test('RelCardinality: has-one horizontal must be string not array', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = { _type: 'Employee', employeeId: 'emp-023', name: 'Nick', departmentId: ['dept-eng'] };
  const errs = validate(emp, schema.types.Employee, schema, r);
  assert(hasCode(errs, ErrorCode.TYPE_MISMATCH));
});

test('RelCardinality: has-one horizontal minLength enforced — empty string rejected', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = { _type: 'Employee', employeeId: 'emp-024', name: 'Olivia', departmentId: '' };
  const errs = validate(emp, schema.types.Employee, schema, r);
  assert(hasCode(errs, ErrorCode.STRING_TOO_SHORT));
});

// --- has-many horizontal ---

test('RelCardinality: has-many horizontal valid multiple ids', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = {
    _type: 'Employee', employeeId: 'emp-030', name: 'Paul', departmentId: 'dept-eng',
    projectIds: ['proj-alpha', 'proj-beta', 'proj-gamma'],
  };
  assertEmpty(validate(emp, schema.types.Employee, schema, r));
});

test('RelCardinality: has-many horizontal valid empty array', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = {
    _type: 'Employee', employeeId: 'emp-031', name: 'Quinn', departmentId: 'dept-eng',
    projectIds: [],
  };
  assertEmpty(validate(emp, schema.types.Employee, schema, r));
});

test('RelCardinality: has-many horizontal item must be string not integer', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = {
    _type: 'Employee', employeeId: 'emp-032', name: 'Rose', departmentId: 'dept-eng',
    projectIds: ['proj-ok', 99],
  };
  const errs = validate(emp, schema.types.Employee, schema, r);
  assert(hasCode(errs, ErrorCode.TYPE_MISMATCH));
});

test('RelCardinality: has-many horizontal must be array not bare string', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = {
    _type: 'Employee', employeeId: 'emp-033', name: 'Sam', departmentId: 'dept-eng',
    projectIds: 'proj-alpha',
  };
  const errs = validate(emp, schema.types.Employee, schema, r);
  assert(hasCode(errs, ErrorCode.TYPE_MISMATCH));
});

test('RelCardinality: all four quadrants populated simultaneously', () => {
  const r = new Registry();
  const schema = r.loadDict(relationshipsSchema());
  const emp = {
    _type: 'Employee', employeeId: 'emp-040', name: 'Tina',
    address: { _type: 'Address', street: '5 Oak Rd', city: 'Shelbyville' },
    badges: [
      { _type: 'Badge', badgeId: 'b-1', label: 'Expert', level: 4 },
      { _type: 'Badge', badgeId: 'b-2', label: 'Mentor' },
    ],
    departmentId: 'dept-rd',
    projectIds: ['proj-x', 'proj-y'],
  };
  assertEmpty(validate(emp, schema.types.Employee, schema, r));
});
