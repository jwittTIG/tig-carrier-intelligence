import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getIndustry } from "@/server/services/industries";
import { ActionForm } from "@/components/action-form";
import { Field, Section, fmtDate, inputClass } from "@/components/ui";
import { addKeywordAction, removeKeywordAction } from "../../actions";

export async function generateMetadata({ params }: PageProps<"/industries/[system]/[code]">) {
  const { system, code } = await params;
  return { title: `${system} ${decodeURIComponent(code)}` };
}

export default async function IndustryPage({ params }: PageProps<"/industries/[system]/[code]">) {
  const ctx = await requireAuth();
  const { system, code: rawCode } = await params;
  const code = decodeURIComponent(rawCode);
  let industry;
  try {
    industry = await getIndustry(ctx, system, code);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const write = can(ctx, "appetite.write");

  return (
    <>
      <Link href="/industries" className="text-sm hover:underline">← Industry codes</Link>
      <h1 className="text-xl font-semibold">NAICS {industry.code}: {industry.title}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Source: {industry.sourceVersion} (U.S. Census Bureau).
        {industry.level < 6 && " This is a broader group: a carrier rule for it covers every industry under it."}
      </p>
      {industry.parents.length > 0 && (
        <p className="text-sm">
          Part of:{" "}
          {industry.parents.map((p, i) => (
            <span key={p.code}>{i > 0 && " › "}<Link href={`/industries/NAICS/${p.code}`} className="hover:underline">{p.code} {p.title}</Link></span>
          ))}
        </p>
      )}

      <Section title={`Search words (${industry.keywords.length})`}>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Extra words that find this code in the Market Finder, besides its official title. Use the words staff and clients say, e.g. “hvac”, “drywall”, “c-store”.
        </p>
        {industry.keywords.length === 0 ? (
          <p className="text-sm">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {industry.keywords.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3">
                <span className="font-medium">{k.keyword}</span>
                <span className="text-xs text-zinc-600 dark:text-zinc-400">added by {k.createdBy.name} on {fmtDate(k.createdAt)}</span>
                {write && (
                  <ActionForm action={removeKeywordAction.bind(null, industry.classificationSystem, industry.code, k.id)} submitLabel="Remove" variant="danger" className="flex items-center gap-2">
                    <span className="sr-only">Remove the search word {k.keyword}</span>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
        {write && (
          <ActionForm action={addKeywordAction.bind(null, industry.classificationSystem, industry.code)} submitLabel="Add search word" className="flex flex-wrap items-end gap-3">
            <Field label="New search word" htmlFor="keyword" hint="2–60 characters: letters, numbers, spaces, & ' . -">
              <input id="keyword" name="keyword" required maxLength={60} className={inputClass} />
            </Field>
          </ActionForm>
        )}
      </Section>

      {industry.children.length > 0 && (
        <Section title="Industries in this group">
          <ul className="flex flex-col gap-1 text-sm">
            {industry.children.map((c) => <li key={c.code}><Link href={`/industries/NAICS/${c.code}`} className="hover:underline">{c.code} {c.title}</Link></li>)}
          </ul>
        </Section>
      )}

      <p className="text-sm">
        <Link href={`/markets?industry=${encodeURIComponent(`NAICS ${industry.code}`)}`} className="text-blue-800 hover:underline dark:text-blue-300">Find markets for this industry</Link>
        <span className="text-xs text-zinc-600 dark:text-zinc-400"> (choose a line or product there)</span>
      </p>
    </>
  );
}
