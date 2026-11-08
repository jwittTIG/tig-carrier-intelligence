import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Private object storage (DECISIONS D11). Files are stored by object key only and are
 * reached through short-lived signed URLs issued after a permission check.
 *
 * - `dev`: DEVELOPMENT ONLY. Writes to DEV_STORAGE_DIR; signed URLs point at
 *   /api/v1/files. Refuses to run when NODE_ENV=production.
 * - `r2`: Cloudflare R2. Not built yet: needs an R2 bucket and keys.
 */
export interface ObjectStorage {
  readonly driver: string;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** A URL that serves the object until `expiresAt`. */
  signedUrl(key: string, opts: { expiresAt: Date; filename: string; contentType: string; inline?: boolean }): Promise<string>;
}

const KEY_RE = /^[a-z0-9][a-z0-9/_.-]{0,250}$/;

export function assertValidKey(key: string) {
  if (!KEY_RE.test(key) || key.includes("..") || key.includes("//")) throw new Error("Invalid object key");
}

function signingSecret(): string {
  const s = process.env.STORAGE_SIGNING_SECRET;
  if (!s || s.length < 32) throw new Error("STORAGE_SIGNING_SECRET must be set (32+ characters)");
  return s;
}

/** `inline`: open in the browser instead of downloading (PDFs only; see /api/v1/files). */
type Signed = { key: string; exp: number; name: string; type: string; inline?: boolean };

export function signToken(p: Signed): string {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  const sig = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** Returns the payload if the signature is valid and not expired, else null. */
export function verifyToken(token: string, now: number = Date.now()): Signed | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", signingSecret()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Signed;
    if (typeof p.exp !== "number" || p.exp < now) return null;
    assertValidKey(p.key);
    return p;
  } catch {
    return null;
  }
}

class DevLocalStorage implements ObjectStorage {
  readonly driver = "dev";
  constructor(private readonly root: string) {}
  private file(key: string) {
    assertValidKey(key);
    return path.join(this.root, ...key.split("/"));
  }
  async put(key: string, bytes: Uint8Array) {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    // Never overwrite: object keys are unique per version.
    await fs.writeFile(f, bytes, { flag: "wx" });
  }
  async get(key: string) {
    return new Uint8Array(await fs.readFile(this.file(key)));
  }
  async signedUrl(key: string, opts: { expiresAt: Date; filename: string; contentType: string; inline?: boolean }) {
    assertValidKey(key);
    return `/api/v1/files?t=${signToken({ key, exp: opts.expiresAt.getTime(), name: opts.filename, type: opts.contentType, ...(opts.inline && { inline: true }) })}`;
  }
}

export function storage(): ObjectStorage {
  const driver = process.env.STORAGE_DRIVER;
  if (driver === "dev") {
    if (process.env.NODE_ENV === "production") throw new Error("STORAGE_DRIVER=dev is refused when NODE_ENV=production");
    return new DevLocalStorage(path.resolve(process.env.DEV_STORAGE_DIR ?? ".data/storage"));
  }
  if (driver === "r2") throw new Error("R2 storage is not configured yet (DECISIONS D11): needs a bucket and keys");
  throw new Error("STORAGE_DRIVER must be set (see .env.example)");
}

/** How long a download link works. */
export const SIGNED_URL_TTL_MS = 5 * 60 * 1000;
