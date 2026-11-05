import { Field, inputClass, label } from "@/components/ui";

type Option = { id: string; name: string };

export type CarrierDefaults = {
  legalName?: string;
  displayName?: string;
  type?: string;
  status?: string;
  parentId?: string | null;
  ownerUserId?: string | null;
  website?: string | null;
};

/** Shared inputs for creating and editing a carrier. */
export function CarrierFields({ d = {}, types, parents, owners }: { d?: CarrierDefaults; types: readonly string[]; parents: Option[]; owners: Option[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Display name" htmlFor="displayName" hint="What staff call it, e.g. DEMO Summit Mutual">
        <input id="displayName" name="displayName" required maxLength={120} defaultValue={d.displayName} className={inputClass} />
      </Field>
      <Field label="Legal name" htmlFor="legalName">
        <input id="legalName" name="legalName" required maxLength={200} defaultValue={d.legalName} className={inputClass} />
      </Field>
      <Field label="Type" htmlFor="type" hint="Insurers write products; MGAs, wholesalers and program administrators are channels.">
        <select id="type" name="type" required defaultValue={d.type ?? "INSURER"} className={inputClass}>
          {types.map((t) => <option key={t} value={t}>{label(t)}</option>)}
        </select>
      </Field>
      <Field label="Status" htmlFor="status">
        <select id="status" name="status" defaultValue={d.status ?? "ACTIVE"} className={inputClass}>
          {["ACTIVE", "PROSPECT", "INACTIVE"].map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
      </Field>
      <Field label="Parent / group" htmlFor="parentId">
        <select id="parentId" name="parentId" defaultValue={d.parentId ?? ""} className={inputClass}>
          <option value="">None</option>
          {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="Relationship owner" htmlFor="ownerUserId">
        <select id="ownerUserId" name="ownerUserId" defaultValue={d.ownerUserId ?? ""} className={inputClass}>
          <option value="">Unassigned</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </Field>
      <Field label="Website" htmlFor="website">
        <input id="website" name="website" type="url" placeholder="https://" defaultValue={d.website ?? ""} className={inputClass} />
      </Field>
    </div>
  );
}
