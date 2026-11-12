import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { listCarrierOptions } from "@/server/services/carriers";
import { getInboxMessage } from "@/server/services/inbox";
import { listCarrierProducts } from "@/server/services/inbox-options";
import { ActionForm } from "@/components/action-form";
import { Badge, Field, Section, fmtDateTime, inputClass, label } from "@/components/ui";
import { appetiteDraftAction, dismissAction, fileAction, heldAction } from "../actions";

export const metadata = { title: "Email" };

export default async function InboxMessagePage({ params }: PageProps<"/inbox/[id]">) {
  const ctx = await requireAuth();
  const { id } = await params;
  let m;
  try {
    m = await getInboxMessage(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [carriers, products] = await Promise.all([listCarrierOptions(ctx), listCarrierProducts(ctx, m.organizationId)]);
  const triage = can(ctx, "inbox.triage") && m.senderStatus === "ACCEPTED";
  const stored = m.attachments.filter((a) => a.documentVersion);

  return (
    <>
      <Link href="/inbox" className="back-link">← Inbox</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title">{m.subject}</h1>
        {m.senderStatus === "HELD" ? <Badge tone="warn">Held: unknown sender</Badge> : <Badge tone={m.status === "NEW" ? "warn" : "good"}>{m.status === "TRIAGED" ? "Done" : label(m.status)}</Badge>}
      </div>
      <p className="-mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Received {fmtDateTime(m.receivedAt)} from {m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress}
        {m.senderUser && ` (TIG: ${m.senderUser.name})`}
        {m.originalFrom && <> · originally from <strong>{m.originalFrom}</strong></>}
        {m.organization && <> · filed under <Link href={`/carriers/${m.organization.id}?tab=updates`}>{m.organization.displayName}</Link></>}
        {m.triagedBy && ` · handled by ${m.triagedBy.name} ${fmtDateTime(m.triagedAt!)}`}
      </p>
      {m.dismissReason && <p className="text-sm">Dismissed: {m.dismissReason}</p>}

      {m.senderStatus === "HELD" && (
        <Section title="Unknown sender">
          <p className="text-sm">This email didn&apos;t come from an active TIG user, so its attachments haven&apos;t been opened or stored. Only an admin can accept or discard it.</p>
          {m.authResults && <p className="break-all font-mono text-xs text-zinc-600 dark:text-zinc-400">{m.authResults}</p>}
          {can(ctx, "inbox.manage") && (
            <div className="flex flex-wrap gap-4">
              <ActionForm action={heldAction.bind(null, m.id, "ACCEPT")} submitLabel="Accept" className="flex flex-wrap items-end gap-2">
                <Field label="Why it's legitimate" htmlFor="hAcc"><input id="hAcc" name="reason" required className={`${inputClass} min-w-64`} /></Field>
              </ActionForm>
              <ActionForm action={heldAction.bind(null, m.id, "DISCARD")} submitLabel="Discard" variant="danger" className="flex flex-wrap items-end gap-2">
                <Field label="Why" htmlFor="hDis"><input id="hDis" name="reason" required className={`${inputClass} min-w-64`} /></Field>
              </ActionForm>
            </div>
          )}
        </Section>
      )}

      <Section title="Attachments">
        <ul className="flex flex-col gap-1.5 text-[13px] font-medium text-zinc-700 dark:text-zinc-200">
          <li>
            Original email (.eml):{" "}
            <a href={`/api/v1/document-versions/${m.rawDocumentVersionId}/download`}>Download</a>
          </li>
          {m.attachments.map((a) => (
            <li key={a.id}>
              {a.documentVersion ? (
                <>
                  <Link href={`/documents/${a.documentVersion.document.id}`}>{a.filename}</Link> <Badge>{label(a.documentVersion.document.documentType)}</Badge>{" "}
                  <a href={`/api/v1/document-versions/${a.documentVersion.id}/download`} className="text-xs">Download</a>
                </>
              ) : (
                <><span>{a.filename}</span> <Badge tone="neutral">Not stored</Badge> <span className="text-xs text-zinc-600 dark:text-zinc-400">{a.rejectedReason}</span></>
              )}
            </li>
          ))}
          {m.attachments.length === 0 && <li className="text-zinc-600 dark:text-zinc-400">No attachments.</li>}
        </ul>
        {m.citedBy.length > 0 && <p className="text-xs text-zinc-600 dark:text-zinc-400">Cited as a source on: {m.citedBy.map((c) => `${label(c.recordType)}${c.pageOrSection ? ` (${c.pageOrSection})` : ""}`).join(", ")}</p>}
      </Section>

      {triage && m.status !== "DISMISSED" && (
        <Section title="What to do with it">
          {m.suggestions.length > 0 && (
            <p className="text-sm">Looks like it&apos;s from: {m.suggestions.map((s, i) => <span key={s.id}>{i > 0 && ", "}<strong>{s.displayName}</strong></span>)}</p>
          )}
          <ActionForm action={fileAction.bind(null, m.id)} submitLabel="File under carrier" className="flex flex-wrap items-end gap-2">
            <Field label="Carrier" htmlFor="fOrg" hint="The email and its files appear on the carrier's Documents and Updates tabs">
              <select id="fOrg" name="organizationId" defaultValue={m.organizationId ?? m.suggestions[0]?.id ?? ""} required className={inputClass}>
                <option value="" disabled>Choose…</option>
                {carriers.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
              </select>
            </Field>
          </ActionForm>
          {products.length > 0 ? (
            <ActionForm action={appetiteDraftAction.bind(null, m.id)} submitLabel="Start appetite draft" showOk={false} className="flex flex-wrap items-end gap-2">
              <Field label="Product" htmlFor="aProd" hint={m.organizationId ? undefined : "File it under a carrier first to narrow this list"}>
                <select id="aProd" name="carrierProductId" required className={inputClass}>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </Field>
              {stored.length > 0 && (
                <Field label="Source file" htmlFor="aSrc">
                  <select id="aSrc" name="documentVersionId" className={inputClass}>
                    {stored.map((a) => <option key={a.id} value={a.documentVersion!.id}>{a.filename}</option>)}
                    <option value={m.rawDocumentVersionId}>The email itself</option>
                  </select>
                </Field>
              )}
            </ActionForm>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">To start an appetite draft, the carrier needs a product (Writing companies &amp; channels tab).</p>
          )}
          <p className="text-xs text-zinc-600 dark:text-zinc-400">A draft opens with this email as its source; add the rules and submit it for approval as usual. If a draft is already open for that product, the email is added to it.</p>
          <ActionForm action={dismissAction.bind(null, m.id)} submitLabel="Dismiss" variant="secondary" className="flex flex-wrap items-end gap-2">
            <Field label="Why (required)" htmlFor="dReason"><input id="dReason" name="reason" required placeholder="e.g. marketing only, duplicate" className={`${inputClass} min-w-64`} /></Field>
          </ActionForm>
        </Section>
      )}

      <Section title="Message">
        <p className="text-xs text-zinc-600 dark:text-zinc-400">Shown as plain text. Links and images in the original aren&apos;t loaded.</p>
        <pre className="max-h-[40rem] overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-50 p-3 font-sans text-sm dark:bg-zinc-950">{m.bodyText || "(empty)"}</pre>
      </Section>
    </>
  );
}
