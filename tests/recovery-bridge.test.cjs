const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..'),'src/content/recovery-bridge.js'), 'utf8');
const origin = 'https://fixture.invalid';
const tokenKey = 'cpRecoverToken:' + origin;
const navKey = 'cpRecoverNav:' + origin;

function fixture({ failure = '', pathname = '/commpilot/User/Profile/', deferWrites = false } = {}) {
  const handlers = {}, writes = [], replies = [], session = new Map();
  const runtime = {};
  let consumedErrors = 0;
  let token = 'fixture-token';
  const completions = [];
  const error = () => Object.defineProperty(runtime, 'lastError', {
    configurable: true, get() { consumedErrors++; return { message: 'Storage unavailable' }; }
  });
  const storage = { [tokenKey]: 'fixture-token', [navKey]: { url: '/commpilot/User/DND/', params: {} } };
  const context = {
    URL, location: { origin, pathname, href: origin + pathname },
    document: { readyState: 'complete',
      querySelector: selector => selector.startsWith('td') ? {} : { value: token },
      addEventListener: (name, fn) => { handlers[name] = fn; } },
    sessionStorage: { setItem: (key, value) => session.set(key, value) },
    chrome: { runtime, storage: { local: {
      set(data, done) {
        if (failure === 'throw') throw new Error('Extension context invalidated.');
        writes.push(data);
        if (deferWrites) { completions.push(done); return; }
        if (failure === 'callback') error();
        if (done) done();
        delete runtime.lastError;
      },
      get(keys, done) {
        if (failure === 'throw') throw new Error('Extension context invalidated.');
        if (failure === 'callback') error();
        done(failure === 'callback' ? undefined : storage);
        delete runtime.lastError;
      }
    } } },
    addEventListener: (name, fn) => { handlers[name] = fn; },
    postMessage: message => replies.push(JSON.parse(JSON.stringify(message)))
  };
  context.window = context; context.top = context;
  vm.createContext(context);
  vm.runInContext(script, context);
  return { writes, replies, session, consumedErrors: () => consumedErrors,
    setStoredNav: value => { storage[navKey] = value; },
    setToken: value => { token = value; },
    finishWrite: (index, failed = false) => { if (failed) error(); completions[index](); delete runtime.lastError; },
    send: data => handlers.message({ source: vm.runInContext('window', context), origin, data }),
    reskin: () => handlers['cp:reskin']() };
}

test('recovery serializes token persistence and coalesces intermediate values', () => {
  const f = fixture({deferWrites:true});
  f.setToken('intermediate');f.reskin();
  f.setToken('newest');f.reskin();
  assert.equal(f.writes.length,1);
  f.finishWrite(0);
  assert.equal(f.writes.length,2);
  assert.equal(f.writes[1][tokenKey],'newest');
  f.finishWrite(1);f.reskin();
  assert.equal(f.writes.length,2,'unchanged acknowledged token does not write again');
});

for(const name of ['pin','newPasscode','voicePortalPasscode']){
  test('recovery storage excludes '+name+' from destinations and ancestry',()=>{
    for(const query of [false,true])for(const entry of [false,true]){
      const f=fixture();
      const nav={url:'/commpilot/User/Profile/'+(query?'?'+name+'=fixture-private':''),params:query?{}:{[name]:'fixture-private'}};
      f.send({__cpRecoverNav:entry?{url:'/commpilot/User/DND/',entry:nav}:nav});
      assert.equal(f.writes.length,1,'credential-bearing navigation is not persisted');
    }
  });
  test('recovery replies reject previously stored '+name,()=>{
    const f=fixture();
    f.setStoredNav({url:'/commpilot/User/Profile/',params:{[name]:'fixture-private'}});
    f.send({__cpStubNavQuery:1});
    assert.equal(f.replies[0].__cpStubNavReply.nav,null);
  });
}

test('recovery can retry a failed token write on the next page event', () => {
  const f = fixture({deferWrites:true});
  f.finishWrite(0,true);f.reskin();
  assert.equal(f.writes.length,2);
  f.finishWrite(1);f.reskin();
  assert.equal(f.writes.length,2);
});

test('recovery stores and returns same-host navigation and token', () => {
  const f = fixture();
  f.send({ __cpRecoverNav: { url: '/commpilot/User/DND/', params: { menuId: '2' } } });
  f.send({ __cpStubNavQuery: 1 });
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[1][navKey].url, '/commpilot/User/DND/');
  assert.equal(f.replies[0].__cpStubNavReply.token, 'fixture-token');
  assert.equal(f.session.get('cp-stub-tries'), '0');
});

for (const failure of ['throw', 'callback']) {
  test(`recovery tolerates ${failure} storage failures and answers with an empty fallback`, () => {
    const f = fixture({ failure });
    assert.doesNotThrow(() => f.reskin());
    assert.doesNotThrow(() => f.send({ __cpRecoverNav: { url: '/commpilot/User/DND/' } }));
    assert.doesNotThrow(() => f.send({ __cpStubNavQuery: 1 }));
    assert.deepEqual(f.replies, [{ __cpStubNavReply: { nav: null, token: null } }]);
    if (failure === 'callback') assert.equal(f.consumedErrors(), 4, 'all failed storage callbacks consume runtime.lastError');
  });
}

test('login and logout pages do not persist their tokens', () => {
  for (const pathname of ['/commpilot/Login/', '/commpilot/Logout/']) {
    assert.equal(fixture({ pathname }).writes.length, 0);
  }
});

test('foreign navigation cannot replace the recovery destination', () => {
  const f = fixture();
  f.send({ __cpRecoverNav: { url: 'https://other.invalid/commpilot/User/DND/' } });
  assert.equal(f.writes.length, 1);
});

test('invalid recovery records and invalid required ancestry cannot become a partial saved navigation', () => {
  for (const nav of [true, [], {}, { url: 123 },
    { url: '/commpilot/User/Profile/', entry: { url: 'https://other.invalid/commpilot/Group/Members/Modify/' } },
    { url: '/commpilot/User/Profile/', entry: {} }]) {
    const f = fixture();
    f.send({ __cpRecoverNav: nav });
    assert.equal(f.writes.length, 1, 'reject the whole record instead of removing ancestry or inventing a URL');
  }
});

test('recovery storage rejects submitted fields in the destination and required context', () => {
  const invalid = [
    {password: 'fixture-secret'}, {newPassword: 'fixture-secret'},
    {__cpFormEntries: [['arbitrary', 'fixture-secret']]}, {apply: ''},
    {buttonClicked: 'save'}, {nested: {value: 'fixture-secret'}}
  ];
  for (const params of invalid) {
    for (const asEntry of [false, true]) {
      const f = fixture();
      const nav = {url: '/commpilot/User/Profile/', params};
      f.send({__cpRecoverNav: asEntry ? {url:'/commpilot/User/DND/', entry:nav} : nav});
      assert.equal(f.writes.length, 1, 'unsafe fields must never enter persistent recovery storage');
    }
  }
});

test('recovery storage strips tokens and rejects mutation or credential query URLs', () => {
  for (const url of ['/commpilot/Logout/', '/commpilot/%4cogout/',
    '/commpilot/User/Profile/?password=fixture-secret', '/commpilot/User/Profile/?apply=1']) {
    const f = fixture();
    f.send({__cpRecoverNav:{url,params:{}}});
    assert.equal(f.writes.length,1);
  }
  const f = fixture();
  f.send({__cpRecoverNav:{url:'/commpilot/User/Profile/?formtokenserial=old&selectedTab=1',
    params:{formtokenserial:'old',userId:'fixture-user'}}});
  assert.equal(f.writes.length,2);
  assert.equal(f.writes[1][navKey].url,'/commpilot/User/Profile/?selectedTab=1');
  assert.deepEqual(JSON.parse(JSON.stringify(f.writes[1][navKey].params)),{userId:'fixture-user'});
});
