/**
 * Minimal async test runner for browser ES modules.
 * No dependencies — works in any modern browser without a build step.
 */

const _queue = [];

/**
 * Register a test.
 * @param {string} name
 * @param {() => void | Promise<void>} fn
 */
export function test(name, fn) {
  _queue.push({ name, fn });
}

/**
 * Run all registered tests and append results to `outputEl`.
 * Returns a summary object.
 * @param {HTMLElement} outputEl
 * @returns {Promise<{passed: number, failed: number, total: number}>}
 */
export async function runAll(outputEl) {
  let passed = 0, failed = 0;
  for (const { name, fn } of _queue) {
    const li = document.createElement('li');
    try {
      await fn();
      passed++;
      li.className = 'pass';
      li.textContent = `✓ ${name}`;
    } catch (e) {
      failed++;
      li.className = 'fail';
      li.textContent = `✗ ${name}`;
      const detail = document.createElement('pre');
      detail.textContent = e.message ?? String(e);
      li.appendChild(detail);
    }
    outputEl.appendChild(li);
  }
  return { passed, failed, total: _queue.length };
}

// ---------------------------------------------------------------------------
// Assertion helpers
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
 * Assert that `fn` throws. Optionally check the error type and/or message.
 * @param {() => void} fn
 * @param {RegExp | string | null} [match]  Pattern or substring to match in error.message
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
