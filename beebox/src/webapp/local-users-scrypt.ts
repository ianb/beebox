/**
 * scrypt hashing primitives for the local credential store (`local-users.ts`).
 *
 * Split out to keep the store module under the line cap — the same reason
 * `local-users-errors.ts` is separate. Owns the work-factor parameters, the
 * promisified `deriveKey`, the new-password `hashPassword`, and the throwaway
 * `dummyVerify` the store runs on an unknown email to keep login timing uniform.
 */

import * as crypto from "node:crypto";

const PROD_SCRYPT_N = 2 ** 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEY_BYTES = 32;

export interface ScryptCostParams {
  N: number;
  r: number;
  p: number;
}

/** Stored per-user hash record — the same shape `scryptRecordSchema` validates
 *  in `local-users.ts` (structurally assignable into a `UserRecord.scrypt`). */
export interface StoredScrypt {
  N: number;
  r: number;
  p: number;
  salt: string;
  hash: string;
}

/**
 * Current scrypt cost parameters for new/rehashed passwords. Test-only seam (the
 * `BBX_TIME` precedent — principle #10): `BBX_AUTH_SCRYPT_N` lowers the work factor
 * so the pure-function doctest stays fast. Inert unless set (real deployments
 * hash at full strength); any invalid value falls back to the production factor
 * (fail toward strong hashing, never toward weak).
 */
export function currentScryptParams(): ScryptCostParams {
  const override = process.env.BBX_AUTH_SCRYPT_N;
  if (override !== undefined) {
    const n = Number(override);
    if (Number.isInteger(n) && n >= 2 ** 10 && (n & (n - 1)) === 0) {
      return { N: n, r: SCRYPT_R, p: SCRYPT_P };
    }
    console.warn(`[local-users] ignoring invalid BBX_AUTH_SCRYPT_N=${override}; using production work factor`);
  }
  return { N: PROD_SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P };
}

/**
 * Node's default `maxmem` (32MB) is far below what N=2^17, r=8 needs
 * (128·N·r ≈ 128MB), so scrypt throws unless it's raised next to the params.
 */
function scryptMaxmem(params: ScryptCostParams): number {
  return 132 * params.N * params.r;
}

export function deriveKey(opts: { password: string; salt: Buffer; params: ScryptCostParams }): Promise<Buffer> {
  const { password, salt, params } = opts;
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      SCRYPT_KEY_BYTES,
      { N: params.N, r: params.r, p: params.p, maxmem: scryptMaxmem(params) },
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      },
    );
  });
}

/**
 * A fixed all-zero salt for the throwaway hash `verifyPassword` runs when an
 * email has no record — the output is discarded, so the salt value is
 * irrelevant; only the CPU/memory cost must match a real verify.
 */
const DUMMY_SCRYPT_SALT = Buffer.alloc(SCRYPT_SALT_BYTES, 0);

/**
 * Run a throwaway scrypt at the CURRENT work factor (and its matching `maxmem`,
 * via the same `deriveKey` path a real verify uses) so an unknown email costs
 * comparable time to a known one — otherwise the fast "no record → null" return
 * enumerates valid users by response timing. The derived key is discarded.
 */
export async function dummyVerify(password: string): Promise<void> {
  try {
    await deriveKey({ password, salt: DUMMY_SCRYPT_SALT, params: currentScryptParams() });
  } catch (e) {
    // A dummy hash never gates a login, so a scrypt failure here must not throw
    // (that would itself become a timing/branch signal). A real verify's bad
    // params already fail loudly on their own path.
    console.warn("[local-users] dummy verify hash failed:", e);
  }
}

export async function hashPassword(password: string): Promise<StoredScrypt> {
  const params = currentScryptParams();
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
  const key = await deriveKey({ password, salt, params });
  return { N: params.N, r: params.r, p: params.p, salt: salt.toString("base64"), hash: key.toString("base64") };
}
