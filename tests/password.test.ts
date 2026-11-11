import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, readPasswordHashes } from '../worker/password.mjs';

test('chosen passwords including spaces and Unicode round trip with salted scrypt',async()=>{
  const password='  groovy 🎧  ';
  const hash=await hashPassword(password),second=await hashPassword(password);
  assert.match(hash,/^scrypt\$32768\$8\$3\$/);assert.notEqual(hash,second);assert.ok(!hash.includes(password));
  assert.equal(await verifyPassword(password,hash),true);
  assert.equal(await verifyPassword(password.trim(),hash),false);
  assert.equal(await verifyPassword('different',hash),false);
  assert.equal(await verifyPassword('x','scrypt$999999999$8$3$bad'),false);
  await assert.rejects(hashPassword(''));await assert.rejects(hashPassword('x'.repeat(257)));
});
test('secret configuration rejects missing, malformed, weak and invalid entries',async()=>{
  for(const value of [undefined,'not JSON','{}','[]','{"alice":"plaintext"}','{"bad id":"x"}'])assert.throws(()=>readPasswordHashes(value));
  const hash=await hashPassword('short');assert.deepEqual(readPasswordHashes(JSON.stringify({alice:hash})),{alice:hash});
});
