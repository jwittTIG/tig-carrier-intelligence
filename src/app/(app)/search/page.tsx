import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { globalSearch } from "@/server/services/overview";
import { Badge, Section, label } from "@/components/ui";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const ctx = await requireAuth();
  const q = (await searchParams).q;
  const term = Array.isArray(q) ? q[0] : q;
  let r: Awaited<ReturnType<typeof globalSearch>> | null = null;
  let error: string | null = null;
  if (term) {
    try {
      r = await globalSearch(ctx, term);
    } catch (e) {
      if (e instanceof AppError) error = e.message;
      else throw e;
    }
  }
  const empty = r && !r.carriers.length && !r.contacts.length && !r.codes.length && !r.documents.length;
  return (
    <>
      <h1 className="text-xl font-semibold">Search{term && <>: &ldquo;{term}&rdquo;</>}</h1>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!term && <p className="text-sm text-zinc-500">Use the search box at the top to find carriers, contacts, codes and documents.</p>}
      {empty && <p className="text-sm">Nothing found.</p>}
      {r && r.carriers.length > 0 && (
        <Section title="Carriers">
          <ul className="text-sm">{r.carriers.map((c) => <li key={c.id}><Link href={`/carriers/${c.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{c.displayName}</Link> <span className="text-zinc-500">{label(c.type)}</span>{c.archivedAt && <> <Badge>Archived</Badge></>}</li>)}</ul>
        </Section>
      )}
      {r && r.contacts.length > 0 && (
        <Section title="Contacts">
          <ul className="text-sm">{r.contacts.map((c) => <li key={c.id}><Link href={`/contacts/${c.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{c.firstName} {c.lastName}</Link> <span className="text-zinc-500">{c.email}</span></li>)}</ul>
        </Section>
      )}
      {r && r.codes.length > 0 && (
        <Section title="Agency codes">
          <ul className="text-sm">
            {r.codes.map((c) => (
              <li key={c.id}>
                <span className="font-mono">{c.codeValue}</span> ·{" "}
                <Link href={`/carriers/${c.appointment.marketChannel.carrierProduct.writingCompany.id}?tab=appointments`} className="text-blue-800 hover:underline dark:text-blue-300">{c.appointment.marketChannel.carrierProduct.writingCompany.displayName}</Link>
                <span className="text-zinc-500"> · {label(c.codeType)} · {label(c.status)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {r && r.documents.length > 0 && (
        <Section title="Documents">
          <ul className="text-sm">{r.documents.map((d) => <li key={d.id}><Link href={`/documents/${d.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{d.title}</Link> <span className="text-zinc-500">{label(d.documentType)}</span></li>)}</ul>
        </Section>
      )}
    </>
  );
}
