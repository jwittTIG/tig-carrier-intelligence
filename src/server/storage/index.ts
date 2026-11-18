import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Private object storage (DECISIONS D11a). Files are stored by object key only and are
 * reached through short-lived signed URLs issued after a permission check (/api/v1/files).
 *
 * - `disk`: production. A private persistent disk (Render, D8a) at STORAGE_DISK_DIR, an
 *   absolute path outside the app folder. Render's daily disk snapshots are the backup.
 * - `dev`: DEVELOPMENT ONLY. Writes to DEV_STORAGE_DIR (default .data/storage). Refuses to
 *   run when NODE_ENV=production.
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

/** Files on a local or attached disk, one file per object key, never overwritten. */
class DiskStorage implements ObjectStorage {
  constructor(readonly driver: "dev" | "disk", private readonly root: string) {}
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
    return new DiskStorage("dev", path.resolve(process.env.DEV_STORAGE_DIR ?? ".data/storage"));
  }
  if (driver === "disk") return new DiskStorage("disk", diskRoot());
  throw new Error("STORAGE_DRIVER must be set (see .env.example)");
}

/** STORAGE_DISK_DIR: required for `disk`, absolute, and never inside the app folder (which deploys replace). */
export function diskRoot(dir = process.env.STORAGE_DISK_DIR, appDir = process.cwd()): string {
  if (!dir) throw new Error("STORAGE_DISK_DIR must be set for STORAGE_DRIVER=disk");
  if (!path.isAbsolute(dir)) throw new Error("STORAGE_DISK_DIR must be an absolute path (the disk's mount path)");
  const root = path.resolve(dir);
  const rel = path.relative(path.resolve(appDir), root);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) throw new Error("STORAGE_DISK_DIR must be outside the app folder");
  return root;
}

/** How long a download link works. */
export const SIGNED_URL_TTL_MS = 5 * 60 * 1000;
