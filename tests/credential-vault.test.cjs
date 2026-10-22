const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.resolve(process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..'));

// The encrypted vault in a Node vm, with extension storage and the key database in memory.
function vault() {
  let handler, key;
  const storage = {};
  const db = { close() {}, transaction: () => {
    const tx = { objectStore: () => ({
      get: () => { const request = {}; queueMicrotask(() => { request.result = key; request.onsuccess(); }); return request; },
      put: value => queueMicrotask(() => { key = value; tx.oncomplete(); })
    }) };
    return tx;
  } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/bg/credential-bridge.js'), 'utf8'), {
    URL, Set, TextEncoder, TextDecoder, crypto: webcrypto, btoa, atob,
    indexedDB: { open: () => { const request = { result: db }; queueMicrotask(() => request.onsuccess()); return request; } },
    chrome: { runtime: { onMessage: { addListener: callback => { handler = callback; } } }, storage: { local: {
      get: (name, done) => queueMicrotask(() => done({ [name]: storage[name] })),
      set: (data, done) => { Object.assign(storage, data); queueMicrotask(done); },
      remove: (name, done) => { delete storage[name]; queueMicrotask(done); }
    } } }
  });
  const send = (message, host = 'apps-sbx.avpaas.io') => new Promise(resolve =>
    handler({ kind: 'bwCredential', ...message }, { tab: { id: 1 }, url: `https://${host}/commpilot/Login/` },
      result => resolve(JSON.parse(JSON.stringify(result)))));   // plain objects, not the vm's
  return { send, storage };
}

test('saving a User ID that is already saved replaces its sign-in instead of adding a second one', async () => {
  const { send, storage } = vault();
  const first = await send({ op: 'add', user: 'group.admin', password: 'old-fixture-password', mode: 'auto' });
  const other = await send({ op: 'add', user: 'other.admin', password: 'other-fixture-password', mode: 'auto' });

  // A changed password saved again, this time behind a PIN: still one entry, in its place, with the new password.
  const again = await send({ op: 'add', user: 'group.admin', password: 'new-fixture-password', mode: 'pin', pin: '1357' });
  assert.deepEqual((await send({ op: 'list' })).profiles, [
    { id: first.id, user: 'group.admin', mode: 'pin', hasPin: true },
    { id: other.id, user: 'other.admin', mode: 'auto', hasPin: false }
  ]);
  assert.deepEqual([first.ok, first.updated, other.updated, again.ok, again.updated, again.id], [true, false, false, true, true, first.id]);
  assert.equal((await send({ op: 'unlock', id: first.id, pin: '0000' })).ok, false);
  assert.equal((await send({ op: 'unlock', id: first.id, pin: '1357' })).password, 'new-fixture-password');

  // Back to automatic: the PIN goes with the old entry.
  await send({ op: 'add', user: 'group.admin', password: 'newer-fixture-password', mode: 'auto' });
  assert.deepEqual((await send({ op: 'list' })).profiles[0], { id: first.id, user: 'group.admin', mode: 'auto', hasPin: false });
  assert.equal((await send({ op: 'unlock', id: first.id })).password, 'newer-fixture-password');

  // The same User ID on another site is its own sign-in.
  const elsewhere = await send({ op: 'add', user: 'group.admin', password: 'site-fixture-password', mode: 'auto' }, 'apps01.avpaas.io');
  assert.equal(elsewhere.updated, false);
  assert.notEqual(elsewhere.id, first.id);
  assert.equal((await send({ op: 'list' })).profiles.length, 2);
  assert.equal((await send({ op: 'unlock', id: first.id })).password, 'newer-fixture-password');
  assert.equal((await send({ op: 'unlock', id: elsewhere.id }, 'apps01.avpaas.io')).password, 'site-fixture-password');
  assert.equal(/fixture-password|group\.admin/.test(JSON.stringify(storage)), false, 'only ciphertext is stored');
});
