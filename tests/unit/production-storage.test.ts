import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { diskRoot, storage } from "@/server/storage";
import { scanUpload } from "@/server/storage/inspect";

/** Production storage and scanning on Render (DECISIONS D8a, D11a, D24; 2026-11-18). */
describe("disk storage (STORAGE_DRIVER=disk)", () => {
  const saved = { driver: process.env.STORAGE_DRIVER, dir: process.env.STORAGE_DISK_DIR };
  afterEach(() => {
    process.env.STORAGE_DRIVER = saved.driver;
    if (saved.dir === undefined) delete process.env.STORAGE_DISK_DIR;
    else process.env.STORAGE_DISK_DIR = saved.dir;
  });

  it("needs an absolute folder outside the app folder", () => {
    const app = path.resolve("/srv/app");
    expect(() => diskRoot(undefined, app)).toThrow(/must be set/);
    expect(() => diskRoot("data/files", app)).toThrow(/absolute/);
    expect(() => diskRoot(app, app)).toThrow(/outside the app folder/);
    expect(() => diskRoot(path.join(app, "uploads"), app)).toThrow(/outside the app folder/);
    expect(diskRoot(path.resolve("/var/data/files"), app)).toBe(path.resolve("/var/data/files"));
  });

  it("stores, reads back and never overwrites a file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tci-disk-"));
    process.env.STORAGE_DRIVER = "disk";
    process.env.STORAGE_DISK_DIR = dir;
    const s = storage();
    expect(s.driver).toBe("disk");
    const key = "test/2026/abc.pdf";
    await s.put(key, new Uint8Array([1, 2, 3]), "application/pdf");
    expect([...(await s.get(key))]).toEqual([1, 2, 3]);
    await expect(s.put(key, new Uint8Array([9]), "application/pdf")).rejects.toThrow();
    await expect(s.get("../outside.pdf")).rejects.toThrow(/Invalid object key/);
    const url = await s.signedUrl(key, { expiresAt: new Date(Date.now() + 60_000), filename: "abc.pdf", contentType: "application/pdf" });
    expect(url).toMatch(/^\/api\/v1\/files\?t=/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("upload scanning in production (D24)", () => {
  const pdf = new TextEncoder().encode("%PDF-1.4 hello");
  const eicar = new TextEncoder().encode("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");

  it("is refused in production unless UPLOAD_SCANNER=none", async () => {
    await expect(scanUpload(pdf, { NODE_ENV: "production" })).rejects.toThrow(/D24/);
    await expect(scanUpload(pdf, { NODE_ENV: "production", UPLOAD_SCANNER: "clamav" })).rejects.toThrow(/D24/);
  });

  it("with UPLOAD_SCANNER=none, records that the file was not scanned", async () => {
    expect(await scanUpload(pdf, { NODE_ENV: "production", UPLOAD_SCANNER: "none" })).toEqual({ clean: true, scanner: "none (D24)" });
    expect((await scanUpload(eicar, { NODE_ENV: "production", UPLOAD_SCANNER: "none" })).clean).toBe(false);
  });

  it("development keeps the labeled stub", async () => {
    expect(await scanUpload(pdf, { NODE_ENV: "development" })).toEqual({ clean: true, scanner: "dev-stub" });
  });
});
