const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRegistrationHandler, sqlLiteral, parseSqlJson } = require('../register.cjs');
const input = { email: ' Student@Example.com ', password: 'LabTesting2026!', name: '同学', student_id: '123', project: '机器人', token: 'e8d6b92b-b8b8-45fb-9a79-094732cda977' };
function setup(overrides = {}) {
  const calls = [];
  const adapter = {
    claim: async data => { calls.push(['claim', data]); return { uid: 'reserved-uid', username: data.username, completed: false }; },
    createUser: async data => { calls.push(['create', data]); },
    finish: async token => { calls.push(['finish', token]); },
    ...overrides,
  };
  return { calls, run: createRegistrationHandler(adapter) };
}
test('failed exam proof cannot reach account creation', async () => {
  const {run,calls} = setup({claim: async()=> {throw new Error('请先通过满分考试');}});
  assert.equal((await run(input)).ok, false);
  assert.equal(calls.length, 0);
});
test('creates only the reserved external user and never forwards a forged role or password to SQL', async () => {
  const {run,calls} = setup();
  assert.deepEqual(await run({...input, role:'admin', uid:'forged'}), {ok:true});
  assert.deepEqual(calls.map(x=>x[0]), ['claim','create','finish']);
  assert.equal(calls[0][1].email, 'student@example.com');
  assert.equal(calls[0][1].password, undefined);
  assert.equal(calls[0][1].role, undefined);
  assert.match(calls[0][1].username, /^hclab_[a-f0-9]{40}$/);
  assert.equal(calls[1][1].uid, 'reserved-uid');
  assert.equal(calls[1][1].type, 'externalUser');
  assert.equal(calls[1][1].password, input.password);
});
test('an interrupted native creation is recovered only by DB verification of the reserved identity', async () => {
  let finished = false;
  const {run} = setup({createUser: async()=>{throw new Error('timeout');}, finish: async()=>{finished=true;}});
  assert.deepEqual(await run(input), {ok:true});
  assert.equal(finished, true);
  const bad = setup({createUser: async()=>{throw new Error('timeout');},finish: async()=>{throw new Error('identity mismatch');}});
  assert.equal((await bad.run(input)).ok, false);
});
test('completed retry never recreates account or changes password', async () => {
  const {run,calls} = setup({claim: async()=>({uid:'reserved-uid', username:'fixed', completed:true})});
  assert.deepEqual(await run(input), {ok:true});
  assert.equal(calls.length, 0);
});
test('bad inputs and native password constraints fail before backend calls', async () => {
  for (const patch of [{password:'lowercase123'}, {password:'!LabTesting2026'}, {password:'A'.repeat(33)}, {password:'Ab1'}, {token:'no'}, {name:''}, {email:'bad'}]) {
    const {run,calls} = setup();
    assert.equal((await run({...input,...patch})).ok, false);
    assert.equal(calls.length, 0);
  }
});
test('SQL string serialization safely quotes untrusted text and rejects malformed result', () => {
  assert.equal(sqlLiteral("x');select 'secret"), "'x'');select ''secret'");
  assert.deepEqual(parseSqlJson({Rows:['["{\\"uid\\":\\"abc\\"}"]']}), {uid:'abc'});
  assert.throws(()=>parseSqlJson({Rows:[]}));
});
test('backend exceptions never disclose private provider details', async () => {
  const {run} = setup({claim: async()=>{throw new Error('secretId=secret-value');}});
  assert.equal(JSON.stringify(await run(input)).includes('secret-value'), false);
});
test('requested identity is only user or admin and never an actual native privilege', async () => {
  for (const requested_role of ['user','admin']) {
    const {run,calls}=setup();
    assert.equal((await run({...input,requested_role,role:'super_admin'})).ok,true);
    assert.equal(calls[0][1].requested_role,requested_role);
    assert.equal(calls[1][1].role,undefined);
    assert.equal(calls[1][1].requested_role,undefined);
  }
  for (const requested_role of ['super_admin','owner','',false,{}]) {
    const {run,calls}=setup();
    assert.equal((await run({...input,requested_role})).ok,false);
    assert.equal(calls.length,0);
  }
  const {run,calls}=setup();
  await run(input);
  assert.equal(calls[0][1].requested_role,'user');
});
