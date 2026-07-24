/**
 * Symmetric encryption for per-user secrets (Jester API keys).
 *
 * AES-256-GCM with a master key resolved at call time via getSetting("JESTER_MASTER_KEY")
 * — a 32-byte key encoded as base64 (44 chars) or hex (64 chars). Generate one with:
 *     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * DESIGN NOTE (per design doc §12): production should source this from a real secret
 * manager / KMS and prefer envelope encryption (a KMS-wrapped data key) so rotation
 * doesn't require re-encrypting every row. `encVersion` on jester_credentials is the
 * seam for that. For dev, the env var is acceptable. This module is the single place
 * to swap in KMS later — nothing else touches raw key material.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

/** Marker for a sealed value stored in app_settings: enc:v1:<b64 iv>:<b64 ct+tag>. */
const ENC_PREFIX = "enc:v1:";

export interface Sealed {
  encryptedKey: string; // base64(ciphertext || authTag)
  keyNonce: string; // base64(iv)
  encVersion: number;
}

/**
 * The master key is read from the ENVIRONMENT ONLY — never via getSetting().
 *
 * It protects the secrets stored in app_settings, so storing it in that same table would be
 * circular (you'd need the key to read the key) and would defeat encryption at rest entirely:
 * anyone with database access would hold both the ciphertext and the key. Env-only also breaks
 * the config↔crypto import cycle.
 */
async function masterKey(): Promise<Buffer> {
  const raw = process.env.JESTER_MASTER_KEY;
  if (!raw) {
    throw new Error(
      "JESTER_MASTER_KEY is not set — cannot encrypt/decrypt credentials. " +
        "Set a 32-byte base64 key (node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\").",
    );
  }
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(`JESTER_MASTER_KEY must decode to 32 bytes, got ${buf.length}`);
  }
  return buf;
}

/** Encrypt a plaintext secret. Returns the columns to persist. */
export async function seal(plaintext: string): Promise<Sealed> {
  const key = await masterKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encryptedKey: Buffer.concat([ct, tag]).toString("base64"),
    keyNonce: iv.toString("base64"),
    encVersion: 1,
  };
}

/** Decrypt a sealed secret back to plaintext. Throws on tamper (bad auth tag). */
export async function open(sealed: Pick<Sealed, "encryptedKey" | "keyNonce">): Promise<string> {
  const key = await masterKey();
  const iv = Buffer.from(sealed.keyNonce, "base64");
  const blob = Buffer.from(sealed.encryptedKey, "base64");
  const tag = blob.subarray(blob.length - 16);
  const ct = blob.subarray(0, blob.length - 16);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** True if a stored setting value is an encrypted envelope (vs legacy plaintext). */
export function isSealed(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

/** Seal a secret into a single self-describing string for app_settings. */
export async function sealToString(plaintext: string): Promise<string> {
  const s = await seal(plaintext);
  return `${ENC_PREFIX}${s.keyNonce}:${s.encryptedKey}`;
}

/** Reverse of sealToString. Throws on tamper or a malformed envelope. */
export async function openFromString(blob: string): Promise<string> {
  const parts = blob.split(":"); // ["enc","v1",<iv>,<ct+tag>] — base64 never contains ":"
  if (parts.length !== 4) throw new Error("malformed sealed setting");
  return open({ keyNonce: parts[2], encryptedKey: parts[3] });
}
