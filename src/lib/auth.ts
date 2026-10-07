// The user's own Kalshi API key: imported once as a non-extractable WebCrypto key (it can sign, but can't be read
// back out), stored in IndexedDB, and used to sign requests the way Kalshi specifies. It never leaves the browser.

const API_PREFIX = "/trade-api/v2";

export type KeyAlg = "rsa" | "ed25519";
export interface SigningKey {
  key: CryptoKey;
  alg: KeyAlg;
}
export interface KeyRecord extends SigningKey {
  keyId: string;
  savedAt?: number;
}

// --- PEM / DER --------------------------------------------------------------

function pemBody(pem: string): { type: string; der: Uint8Array<ArrayBuffer> } {
  const m = /-----BEGIN ([A-Z ]+)-----([\s\S]+?)-----END \1-----/.exec(String(pem));
  if (!m) throw new Error("That doesn't look like a private key file (expected -----BEGIN … PRIVATE KEY-----).");
  const bin = atob(m[2].replace(/\s+/g, ""));
  return { type: m[1], der: Uint8Array.from(bin, (c) => c.charCodeAt(0)) };
}

const derLen = (n: number): number[] =>
  n < 128 ? [n] : n < 256 ? [0x81, n] : n < 65536 ? [0x82, n >> 8, n & 255] : [0x83, n >> 16, (n >> 8) & 255, n & 255];

function tlv(tag: number, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const len = derLen(bytes.length);
  const out = new Uint8Array(1 + len.length + bytes.length);
  out.set([tag, ...len]);
  out.set(bytes, out.length - bytes.length);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

// Kalshi's RSA keys are PKCS#1 ("BEGIN RSA PRIVATE KEY"); WebCrypto only imports PKCS#8, so wrap it.
const RSA_ALG_ID = Uint8Array.of(0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00);
export const pkcs1ToPkcs8 = (pkcs1: Uint8Array): Uint8Array<ArrayBuffer> =>
  tlv(0x30, concat(Uint8Array.of(0x02, 0x01, 0x00), RSA_ALG_ID, tlv(0x04, pkcs1)));

const RSA = { name: "RSA-PSS", hash: "SHA-256" };

/** Imports Kalshi's RSA PKCS#1 key, or a PKCS#8 RSA / Ed25519 key, as a non-extractable signing key. */
export async function importPem(pem: string): Promise<SigningKey> {
  const { type, der } = pemBody(pem);
  if (type === "RSA PRIVATE KEY") {
    return { key: await crypto.subtle.importKey("pkcs8", pkcs1ToPkcs8(der), RSA, false, ["sign"]), alg: "rsa" };
  }
  if (type !== "PRIVATE KEY") throw new Error(`Unsupported key type "${type}". Use the private key file Kalshi gave you.`);
  try {
    return { key: await crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]), alg: "ed25519" };
  } catch {
    return { key: await crypto.subtle.importKey("pkcs8", der, RSA, false, ["sign"]), alg: "rsa" };
  }
}

const b64 = (buf: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(buf)));

/** Signature over timestamp + method + path (path without the query string), as Kalshi specifies. */
export async function sign({ key, alg }: SigningKey, text: string): Promise<string> {
  const params = alg === "rsa" ? { name: "RSA-PSS", saltLength: 32 } : { name: "Ed25519" };
  return b64(await crypto.subtle.sign(params, key, new TextEncoder().encode(text)));
}

export async function headersFor(rec: KeyRecord, method: string, path: string, now = Date.now()): Promise<Record<string, string>> {
  const ts = String(now);
  const p = (path.startsWith(API_PREFIX) ? path : API_PREFIX + path).split("?")[0];
  return { "KALSHI-ACCESS-KEY": rec.keyId, "KALSHI-ACCESS-TIMESTAMP": ts, "KALSHI-ACCESS-SIGNATURE": await sign(rec, ts + method + p) };
}

// --- Storage (IndexedDB stores CryptoKeys as-is, still non-extractable) ---

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("kaashify", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("keys");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = d.transaction("keys", mode), req = fn(t.objectStore("keys"));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
    });
  } finally {
    d.close();
  }
}

let cached: KeyRecord | null | undefined;

export async function load(): Promise<KeyRecord | null> {
  if (cached === undefined) cached = (await tx<KeyRecord | undefined>("readonly", (s) => s.get("kalshi")).catch(() => null)) || null;
  return cached;
}

export async function save(keyId: string, pem: string): Promise<KeyRecord> {
  keyId = String(keyId || "").trim();
  if (!/^[0-9a-f-]{20,}$/i.test(keyId)) throw new Error("The Key ID should look like 1a2b3c4d-…  (shown next to the key on Kalshi).");
  const rec: KeyRecord = { keyId, ...(await importPem(pem)), savedAt: Date.now() };
  await tx("readwrite", (s) => s.put(rec, "kalshi"));
  cached = rec;
  return rec;
}

export async function clear(): Promise<void> {
  cached = null;
  await tx("readwrite", (s) => s.delete("kalshi")).catch(() => {});
}
