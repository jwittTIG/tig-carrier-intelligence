import { randomUUID } from "node:crypto";
import type { MailDriver, RawMail } from "@/server/mail/drivers";

/** Builds a fictional RFC 5322 email with optional attachments (base64). */
export function eml(o: {
  from: string;
  subject?: string;
  body?: string;
  html?: string;
  messageId?: string | null;
  attachments?: { filename: string; contentType: string; bytes: Uint8Array; inline?: boolean }[];
  headers?: Record<string, string>;
}): Uint8Array {
  const boundary = `b_${randomUUID()}`;
  const lines = [
    `From: ${o.from}`,
    "To: carrier-updates@example.invalid",
    `Subject: ${o.subject ?? "TEST bulletin"}`,
    "Date: Wed, 04 Nov 2026 15:00:00 +0000",
    ...(o.messageId === null ? [] : [`Message-ID: <${o.messageId ?? `${randomUUID()}@example.invalid`}>`]),
    ...Object.entries(o.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    o.html ? "Content-Type: text/html; charset=utf-8" : "Content-Type: text/plain; charset=utf-8",
    "",
    o.html ?? o.body ?? "TEST body",
  ];
  for (const a of o.attachments ?? []) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${a.contentType}; name="${a.filename}"`,
      `Content-Disposition: ${a.inline ? "inline" : "attachment"}; filename="${a.filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(a.bytes).toString("base64").replace(/.{76}/g, "$&\r\n"),
    );
  }
  lines.push(`--${boundary}--`, "");
  return new TextEncoder().encode(lines.join("\r\n"));
}

export const pdfBytes = (tag = "TEST") => new TextEncoder().encode(`%PDF-1.4\n% ${tag} ${randomUUID()}\n%%EOF\n`);

/** An in-memory mailbox for tests. */
export class MemoryDriver implements MailDriver {
  readonly source = "DEV" as const;
  readonly mailbox = `test-${randomUUID().slice(0, 6)}@example.invalid`;
  constructor(public messages: RawMail[] = []) {}
  add(raw: Uint8Array) {
    this.messages.push({ externalId: `m-${this.messages.length + 1}`, raw });
    return this;
  }
  async fetchNew() {
    return { messages: this.messages, deltaLink: null };
  }
}
