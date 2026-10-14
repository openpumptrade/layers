import crypto from "node:crypto";
import { config } from "./config.js";

/// AES-256-GCM at rest for the coin wallets' secrets. MASTER_KEY = 64 hex chars.

function key() {
  if (!config.masterKey) return null;
  const k = Buffer.from(config.masterKey, "hex");
  if (k.length !== 32) throw new Error("MASTER_KEY must be 32 bytes of hex (64 chars)");
  return k;
}

export function encryptSecret(plain) {
  const k = key();
  if (!k) return `plain:${plain}`;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `gcm:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(stored) {
  if (stored.startsWith("plain:")) return stored.slice(6);
  const [tag, ivHex, authHex, dataHex] = stored.split(":");
  if (tag !== "gcm") throw new Error("unknown secret format");
  const k = key();
  if (!k) throw new Error("MASTER_KEY required to decrypt wallet secrets");
  const decipher = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}
