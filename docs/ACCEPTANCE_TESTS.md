# Acceptance Tests — MVP

## Access control
- Unauthenticated users cannot access any private API or document.
- Producer without `commission.read` cannot access commission screens, APIs, exports, or commission fields embedded in other responses.
- User scoped to agency entity A cannot access entity B appointments/codes/agreements.
- Admin without explicit finance permission cannot access restricted financial details.
- Cross-entity ID substitution and direct object URLs do not bypass permissions.

## Carrier model
- Create insurer, writing company, MGA, wholesaler and link relationships.
- One product supports multiple writing companies and multiple intermediary channels.
- Carrier archive preserves historical references.
- Search/filter carrier name, product, state, status and owner.

## Contacts
- One contact has multiple carrier/product/territory assignments.
- Contact verification dates and inactive assignments display correctly.

## Appointments and codes
- One agency entity has multiple appointments and codes.
- Expired appointments are not displayed as currently active.
- Duplicate overlapping active code conflicts are rejected or explicitly reviewed.
- No passwords or credentials are stored in portal records.

## Appetite
- Approved profile has source, owner and effective date.
- Search distinguishes accepted, referral, prohibited and unknown.
- Conflicting effective rules produce review warning.
- Historical appetite version remains retrievable.

## Commissions
- Rates vary by new/renewal, product, territory and effective date.
- Invalid overlapping approved schedules are rejected.
- Decimal calculations preserve precision; no floating-point money.
- Restricted document and rate access is enforced server-side.

## Documents and approvals
- Private document upload, version, and permission-filtered download work.
- Change request shows old/new data and supporting source.
- Approve/reject creates immutable audit event and preserves prior version.
- AI extraction is not active in MVP.

## Imports
- CSV preview maps columns and reports invalid rows.
- Duplicate candidate detection prevents silent overwrites.
- Import commit is transactional and produces error report.

## Quality gates
- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` pass (or documented equivalents).
- Playwright covers login, carrier creation, appetite lookup, restricted commissions, and approval flow.
- Accessibility checks on primary screens; no critical vulnerabilities in dependency/security review.
- No real carrier, agency, commission, or employee details in demo fixtures.
