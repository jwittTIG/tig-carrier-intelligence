import Link from "next/link";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { ActionForm } from "@/components/action-form";
import { Section } from "@/components/ui";
import { createContactAction } from "../actions";
import { ContactFields } from "../contact-fields";

export const metadata = { title: "New contact" };

export default async function NewContactPage() {
  const ctx = await requireAuth();
  if (!can(ctx, "contact.write")) return <p role="alert">You don&apos;t have permission to add contacts.</p>;
  return (
    <>
      <Link href="/contacts" className="back-link">← Contacts</Link>
      <h1 className="page-title">New contact</h1>
      <Section title="Details">
        <ActionForm action={createContactAction} submitLabel="Create contact" showOk={false}>
          <ContactFields />
        </ActionForm>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">After creating the contact, add the carriers, territories and lines they cover.</p>
      </Section>
    </>
  );
}
