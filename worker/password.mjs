import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

const format = /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{64})$/;
const derive = (password, salt) => new Promise((resolve, reject) => {
  scrypt(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, hash) => error ? reject(error) : resolve(hash));
});

export async function hashPassword(password) {
  if (typeof password !== 'string' || !password.length || password.length > 256) throw new Error('Enter a password of 1–256 characters.');
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt$32768$8$3$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  const match = typeof encoded === 'string' ? format.exec(encoded) : null;
  if (!match || typeof password !== 'string' || !password.length || password.length > 256) return false;
  const hash = await derive(password, Buffer.from(match[1], 'hex'));
  return timingSafeEqual(hash, Buffer.from(match[2], 'hex'));
}

/** @returns {Record<string, string>} */
export function readPasswordHashes(value) {
  let users;
  try { users = JSON.parse(value); } catch { throw new Error('Set USER_PASSWORD_HASHES to a JSON object of account IDs and password hashes.'); }
  if (!users || typeof users !== 'object' || Array.isArray(users) || !Object.keys(users).length || Object.entries(users).some(([id,hash]) => !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || typeof hash !== 'string' || !format.test(hash))) {
    throw new Error('USER_PASSWORD_HASHES contains invalid account IDs or password hashes.');
  }
  return users;
}
