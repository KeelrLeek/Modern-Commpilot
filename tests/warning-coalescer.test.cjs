const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.BW_TEST_PJAX_PATH || path.resolve(__dirname, '../src/content/pjax.js'), 'utf8');
// Exercise the actual small logger in isolation. No browser or network is needed
// to advance its clocks and verify expired diagnostic state is released.
const start = source.indexOf('  var cpCoMap = Object.create(null);');
const end = source.indexOf('  // Version stamp stays ALWAYS-ON', start);
assert.ok(start > 0 && end > start, 'warning coalescer source boundaries exist');
function fixture() {
  let now = 0, nextId = 0;
  const timers = new Map(), warnings = [];
  const scope = { window: { performance: { now: () => now } },
    console: { warn: message => warnings.push(message) },
    setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id) };
  scope.performance = scope.window.performance;
  vm.runInNewContext(source.slice(start, end), scope);
  const advance = time => {
    while (true) {
      const pending = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!pending || pending[1].at > time) break;
      timers.delete(pending[0]); now = pending[1].at; pending[1].fn();
    }
    now = time;
  };
  return { scope, warnings, timers, advance, warn: (key, message = 'Temporary failure') => scope.cpWarnCo(key, message) };
}

test('expired unique warning keys are released instead of accumulating for the tab lifetime', () => {
  const f = fixture();
  for (let i = 0; i < 1000; i++) f.warn('endpoint-' + i);
  assert.equal(f.warnings.length, 1000);
  f.advance(2000);
  assert.equal(f.timers.size, 0);
  assert.equal(Object.keys(f.scope.cpCoMap).length, 0);
});

test('an old warning timer cannot erase the newer burst for the same endpoint', () => {
  const f = fixture();
  f.warn('endpoint');
  f.advance(1550); f.warn('endpoint');
  f.advance(1650); f.warn('endpoint');
  assert.equal(f.warnings.length, 2, 'the third warning belongs to the second burst');
  f.advance(3300);
  assert.deepEqual(f.warnings, ['Temporary failure', 'Temporary failure', 'Temporary failure (x2)']);
});

test('a repeated warning burst still prints its first message and final count', () => {
  const f = fixture();
  f.warn('endpoint');
  f.advance(100); f.warn('endpoint');
  f.advance(200); f.warn('endpoint');
  assert.equal(f.warnings.length, 1);
  f.advance(2000);
  assert.deepEqual(f.warnings, ['Temporary failure', 'Temporary failure (x3)']);
});
