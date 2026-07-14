// Per-user GitHub PATs (KANBAN-21 / GH-2) are encrypted at rest with AES-256-GCM.
//
// The 32-byte key (KEK) is supplied via the GITHUB_PAT_ENC_KEY env var as base64
// and lives ONLY in the environment (Vercel / .env.local) — never in the database.
// The stored value is base64(nonce || ciphertext || authTag), so the DB only ever
// holds ciphertext: a database-only compromise never yields a plaintext PAT, since
// the KEK sits in a separate trust domain. See docs/github-integration.md §Security.
//
// Server-only. Never import this into client code.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_ENV = 'GITHUB_PAT_ENC_KEY';
const NONCE_BYTES = 12; // AES-GCM standard nonce length
const TAG_BYTES = 16; // AES-GCM auth tag length

function getKey(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw) {
    throw new Error(
      `${KEY_ENV} is not set. Generate one with \`openssl rand -base64 32\` and set it in the environment.`,
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`${KEY_ENV} must decode to exactly 32 bytes (got ${key.length}).`);
  }
  return key;
}

/** Encrypt a PAT → base64(nonce || ciphertext || authTag). */
export function encryptPat(plaintext: string): string {
  const key = getKey();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]).toString('base64');
}

/** Decrypt a value produced by {@link encryptPat}. Throws if tampered or wrong key. */
export function decryptPat(encoded: string): string {
  const key = getKey();
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length < NONCE_BYTES + TAG_BYTES) {
    throw new Error('Ciphertext too short to be valid.');
  }
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ciphertext = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * True if the KEK is configured (present + 32 bytes). Lets routes return a clean
 * "GitHub connect isn't configured" error instead of throwing on first use.
 */
export function isGithubCryptoConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}
