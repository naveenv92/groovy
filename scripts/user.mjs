import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { hashPassword } from '../functions/password.mjs';

const [id, ...extra] = process.argv.slice(2);
if (!id || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || extra.length) {
  console.error('Usage: npm run user -- <account-id>\nPrompts for a password and prints an entry for the USER_PASSWORD_HASHES Cloudflare secret.');
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error('Run this command in an interactive terminal so your password can be entered without echoing.');
  process.exit(1);
}
const hidden = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
const input = createInterface({ input: process.stdin, output: hidden, terminal: true });
input.on('SIGINT', () => { input.close(); process.stderr.write('\n'); process.exit(130); });
async function ask(label) {
  process.stderr.write(label);
  const value = await input.question('');
  process.stderr.write('\n');
  return value;
}
try {
  const password = await ask('Password (hidden): ');
  const confirmation = await ask('Confirm password (hidden): ');
  if (password !== confirmation) throw new Error('Passwords do not match.');
  const hash = await hashPassword(password);
  console.log('\nMerge this entry into your USER_PASSWORD_HASHES secret:');
  console.log(JSON.stringify({ [id]: hash }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  input.close();
}
