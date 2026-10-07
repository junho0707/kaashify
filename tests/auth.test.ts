import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify, constants } from "node:crypto";
import * as Auth from "../src/lib/auth.ts";

const rec = (keyId: string, k: Auth.SigningKey): Auth.KeyRecord => ({ keyId, ...k });

test("RSA key in Kalshi's PKCS#1 format signs timestamp+method+path with RSA-PSS (salt 32), query stripped", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
  assert.match(pem, /BEGIN RSA PRIVATE KEY/);
  const k = await Auth.importPem(pem);
  assert.equal(k.alg, "rsa");
  assert.equal(k.key.extractable, false);
  const h = await Auth.headersFor(rec("abc", k), "GET", "/portfolio/positions?limit=5", 1700000000000);
  assert.equal(h["KALSHI-ACCESS-KEY"], "abc");
  assert.equal(h["KALSHI-ACCESS-TIMESTAMP"], "1700000000000");
  const ok = verify("sha256", Buffer.from("1700000000000GET/trade-api/v2/portfolio/positions"),
    { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, Buffer.from(h["KALSHI-ACCESS-SIGNATURE"], "base64"));
  assert.ok(ok);
});

test("PKCS#8 RSA and Ed25519 keys work too", async () => {
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.equal((await Auth.importPem(rsa.privateKey.export({ type: "pkcs8", format: "pem" }) as string)).alg, "rsa");
  const ed = generateKeyPairSync("ed25519");
  const k = await Auth.importPem(ed.privateKey.export({ type: "pkcs8", format: "pem" }) as string);
  assert.equal(k.alg, "ed25519");
  const h = await Auth.headersFor(rec("abc", k), "GET", "/trade-api/v2/portfolio/fills", 1);
  assert.ok(verify(null, Buffer.from("1GET/trade-api/v2/portfolio/fills"), ed.publicKey, Buffer.from(h["KALSHI-ACCESS-SIGNATURE"], "base64")));
});

test("rejects things that aren't a private key", async () => {
  await assert.rejects(Auth.importPem("hello"), /doesn't look like a private key/);
  await assert.rejects(Auth.importPem("-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----"), /Unsupported key type/);
});
