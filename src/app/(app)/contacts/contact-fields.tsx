import { Field, inputClass } from "@/components/ui";

type Defaults = { firstName?: string; lastName?: string; email?: string | null; officePhone?: string | null; mobilePhone?: string | null; status?: string };

export function ContactFields({ d = {} }: { d?: Defaults }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Field label="First name" htmlFor="firstName"><input id="firstName" name="firstName" required maxLength={80} defaultValue={d.firstName} className={inputClass} /></Field>
      <Field label="Last name" htmlFor="lastName"><input id="lastName" name="lastName" required maxLength={80} defaultValue={d.lastName} className={inputClass} /></Field>
      <Field label="Email" htmlFor="email"><input id="email" name="email" type="email" defaultValue={d.email ?? ""} className={inputClass} /></Field>
      <Field label="Office phone" htmlFor="officePhone"><input id="officePhone" name="officePhone" maxLength={40} defaultValue={d.officePhone ?? ""} className={inputClass} /></Field>
      <Field label="Mobile phone" htmlFor="mobilePhone"><input id="mobilePhone" name="mobilePhone" maxLength={40} defaultValue={d.mobilePhone ?? ""} className={inputClass} /></Field>
      <Field label="Status" htmlFor="status">
        <select id="status" name="status" defaultValue={d.status ?? "ACTIVE"} className={inputClass}>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive (left the role)</option>
        </select>
      </Field>
    </div>
  );
}
