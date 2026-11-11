import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [id, ...flags] = process.argv.slice(2);
if (!id || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || flags.some(f=>f!=='--remote')) {
  console.error('Usage: npm run user -- <account-id> [--remote]\nCreates an account or rotates its password and revokes its sessions.'); process.exit(1);
}
const password = randomBytes(24).toString('base64url');
const hash = createHash('sha256').update(password).digest('hex');
const folder = mkdtempSync(join(tmpdir(),'groovy-user-'));
try {
  const file = join(folder,'user.sql');
  writeFileSync(file,`INSERT INTO users(id,password_hash) VALUES('${id}','${hash}') ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash;\nDELETE FROM sessions WHERE user_id='${id}';`,{mode:0o600});
  const result = spawnSync('npx',['wrangler','d1','execute','groovy',flags.includes('--remote')?'--remote':'--local','--file',file],{stdio:'inherit'});
  if (result.status !== 0) process.exitCode=1;
  else console.log(`\nAccount: ${id}\nPassword (store securely; shown only now): ${password}`);
} finally { rmSync(folder,{recursive:true,force:true}); }
