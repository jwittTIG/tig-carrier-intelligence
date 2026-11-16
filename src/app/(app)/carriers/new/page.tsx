import Link from "next/link";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { CARRIER_TYPES, listCarrierOptions, listLines } from "@/server/services/carriers";
import { LineCheckboxes } from "@/components/line-picker";
import { listActiveUsers } from "@/server/services/users";
import { ActionForm } from "@/components/action-form";
import { Section } from "@/components/ui";
import { createCarrierAction } from "../actions";
import { CarrierFields } from "../carrier-fields";

export const metadata = { title: "New carrier" };

export default async function NewCarrierPage() {
  const ctx = await requireAuth();
  if (!can(ctx, "carrier.write")) return <p role="alert">You don&apos;t have permission to create carriers.</p>;
  const [parents, owners, lines] = await Promise.all([listCarrierOptions(ctx), listActiveUsers(ctx), listLines(ctx)]);
  return (
    <>
      <Link href="/carriers" className="back-link">← Carriers</Link>
      <h1 className="page-title">New carrier</h1>
      <Section title="Details">
        <ActionForm action={createCarrierAction} submitLabel="Create carrier" showOk={false}>
          <CarrierFields types={CARRIER_TYPES} parents={parents.map((p) => ({ id: p.id, name: p.displayName }))} owners={owners} />
          <LineCheckboxes lines={lines} legend="Products this company writes (required for an insurer)" hint="Tick every line it writes. MGAs, wholesalers and other intermediaries don't write lines themselves: leave these unticked for them." />
        </ActionForm>
      </Section>
    </>
  );
}
