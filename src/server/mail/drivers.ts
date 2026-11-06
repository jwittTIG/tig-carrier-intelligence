import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Mail readers for email intake (DECISIONS D20).
 * - `dev`: DEVELOPMENT ONLY. Reads `.eml` files from MAIL_INTAKE_DEV_DIR. Refuses production.
 * - `graph`: reads the shared mailbox's Inbox through Microsoft Graph with app-only
 *   credentials, using a delta query so each message is fetched once. **Not tested against
 *   Microsoft yet**: it needs the mailbox and app registration in docs/EMAIL_SETUP.md. Its
 *   paging logic is tested with a mocked fetch.
 * Readers only read; they never move, delete or send mail.
 */
export type RawMail = { externalId: string; raw: Uint8Array };
export type FetchResult = { messages: RawMail[]; deltaLink: string | null };

export interface MailDriver {
  readonly source: "DEV" | "GRAPH";
  readonly mailbox: string;
  fetchNew(deltaLink: string | null): Promise<FetchResult>;
}

class DevFolderDriver implements MailDriver {
  readonly source = "DEV" as const;
  constructor(readonly mailbox: string, private readonly dir: string) {}
  async fetchNew(): Promise<FetchResult> {
    await fs.mkdir(this.dir, { recursive: true });
    const names = (await fs.readdir(this.dir)).filter((n) => n.toLowerCase().endsWith(".eml")).sort();
    const messages: RawMail[] = [];
    for (const name of names) messages.push({ externalId: name, raw: new Uint8Array(await fs.readFile(path.join(this.dir, name))) });
    return { messages, deltaLink: null };
  }
}

type Fetch = typeof fetch;

export class GraphDriver implements MailDriver {
  readonly source = "GRAPH" as const;
  constructor(
    readonly mailbox: string,
    private readonly creds: { tenantId: string; clientId: string; clientSecret: string },
    private readonly http: Fetch = fetch,
    private readonly maxPerRun = 200,
  ) {}

  private async token(): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.creds.clientId,
      client_secret: this.creds.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });
    const r = await this.http(`https://login.microsoftonline.com/${encodeURIComponent(this.creds.tenantId)}/oauth2/v2.0/token`, { method: "POST", body });
    if (!r.ok) throw new Error(`Microsoft sign-in for mail intake failed (HTTP ${r.status}). Check the tenant ID, client ID and secret.`);
    const j = (await r.json()) as { access_token?: string };
    if (!j.access_token) throw new Error("Microsoft sign-in returned no access token.");
    return j.access_token;
  }

  async fetchNew(deltaLink: string | null): Promise<FetchResult> {
    const auth = { authorization: `Bearer ${await this.token()}` };
    const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.mailbox)}`;
    let url: string | null = deltaLink ?? `${base}/mailFolders/inbox/messages/delta?$select=id,internetMessageId,receivedDateTime`;
    const ids: string[] = [];
    let nextDelta: string | null = null;
    // Delta pages: follow nextLink until a deltaLink arrives (that's where the next run starts).
    while (url) {
      if (!url.startsWith("https://graph.microsoft.com/")) throw new Error("Unexpected Graph paging URL.");
      const r: Response = await this.http(url, { headers: { ...auth, prefer: "odata.maxpagesize=50" } });
      if (r.status === 410) {
        // Delta token expired: start over (duplicates are dropped by Message-ID).
        url = `${base}/mailFolders/inbox/messages/delta?$select=id,internetMessageId,receivedDateTime`;
        continue;
      }
      if (!r.ok) throw new Error(`Reading the mailbox failed (HTTP ${r.status}). Check the mailbox address and the Exchange role assignment.`);
      const page = (await r.json()) as { value?: { id: string; "@removed"?: unknown }[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
      for (const m of page.value ?? []) if (!m["@removed"]) ids.push(m.id);
      url = page["@odata.nextLink"] ?? null;
      nextDelta = page["@odata.deltaLink"] ?? nextDelta;
      if (ids.length >= this.maxPerRun && url) {
        // Stop at a page boundary; the next run continues from this page link.
        nextDelta = url;
        break;
      }
    }
    const messages: RawMail[] = [];
    for (const id of ids) {
      const r = await this.http(`${base}/messages/${encodeURIComponent(id)}/$value`, { headers: auth });
      if (!r.ok) throw new Error(`Downloading a message failed (HTTP ${r.status}).`);
      messages.push({ externalId: id, raw: new Uint8Array(await r.arrayBuffer()) });
    }
    return { messages, deltaLink: nextDelta };
  }
}

export function mailDriver(): MailDriver {
  const driver = process.env.MAIL_INTAKE_DRIVER;
  if (driver === "dev") {
    if (process.env.NODE_ENV === "production") throw new Error("MAIL_INTAKE_DRIVER=dev is refused when NODE_ENV=production");
    return new DevFolderDriver(process.env.MAIL_INTAKE_MAILBOX || "dev-inbox@example.invalid", path.resolve(process.env.MAIL_INTAKE_DEV_DIR ?? ".data/inbox"));
  }
  if (driver === "graph") {
    const { MAIL_INTAKE_MAILBOX: mailbox, MS_GRAPH_TENANT_ID: tenantId, MS_GRAPH_CLIENT_ID: clientId, MS_GRAPH_CLIENT_SECRET: clientSecret } = process.env;
    if (!mailbox || !tenantId || !clientId || !clientSecret) throw new Error("Mail intake isn't configured: set MAIL_INTAKE_MAILBOX and the MS_GRAPH_* values (docs/EMAIL_SETUP.md).");
    return new GraphDriver(mailbox, { tenantId, clientId, clientSecret });
  }
  throw new Error("Mail intake is off: set MAIL_INTAKE_DRIVER to 'dev' or 'graph' (see .env.example).");
}
