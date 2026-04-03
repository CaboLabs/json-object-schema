/**
 * Minimal test runner adapter for Node.js (node:test).
 * Exports the same API surface as the browser runner so test files are
 * interchangeable between js/ (browser) and js-node/ (Node).
 *
 * Requires Node.js >= 18.
 */

export { test } from 'node:test';

// ---------------------------------------------------------------------------
// Assertion helpers  (mirror the browser runner exactly)
// ---------------------------------------------------------------------------

export function assert(condition, msg) {
  if (!condition) throw new Error(msg ?? 'Assertion failed');
}

export function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `Expected ${e}\n     got ${a}`);
}

export function assertEmpty(arr, msg) {
  if (!Array.isArray(arr) || arr.length !== 0)
    throw new Error(msg ?? `Expected empty array, got ${JSON.stringify(arr)}`);
}

export function assertNotEmpty(arr, msg) {
  if (!Array.isArray(arr) || arr.length === 0)
    throw new Error(msg ?? 'Expected non-empty array');
}

export function assertContains(arr, item, msg) {
  if (!arr.includes(item))
    throw new Error(msg ?? `Expected array to contain ${JSON.stringify(item)}`);
}

export function assertHasKey(obj, key, msg) {
  if (!Object.prototype.hasOwnProperty.call(obj, key))
    throw new Error(msg ?? `Expected object to have key '${key}'`);
}

/**
 * Assert that `fn` throws. Optionally match error message.
 * @param {() => void} fn
 * @param {RegExp | string | null} [match]
 */
export function assertThrows(fn, match = null) {
  let threw = false, err = null;
  try { fn(); } catch (e) { threw = true; err = e; }
  if (!threw) throw new Error('Expected an error to be thrown but none was');
  if (match instanceof RegExp && !match.test(err.message))
    throw new Error(`Error "${err.message}" does not match ${match}`);
  if (typeof match === 'string' && !err.message.includes(match))
    throw new Error(`Error "${err.message}" does not include "${match}"`);
}
