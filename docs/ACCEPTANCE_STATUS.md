# Acceptance test status (MVP)

Each item from `ACCEPTANCE_TESTS.md`, with where it is proven. "N/A (D1)" means the item assumes restricted roles, which Josh chose not to use. The checks exist and are proven with limited TEST roles, but the real roles grant everything.

Run on 2026-11-05: `npm run check` → 168 Vitest tests pass (twice in a row); `npm run test:e2e` → 5 Playwright tests pass; `npm run test:perf` → search timings below.

## Access control
| Item | Status | Proof |
|---|---|---|
| Unauthenticated users can't reach any private API or document | Pass | `route-sweep.test.ts` (every /api/v1 route and method returns 401), `api.test.ts`, `documents.test.ts` (signed links only) |
| Producer without `commission.read` can't see commission screens, APIs, exports or embedded fields | Pass with a limited TEST role; N/A (D1) for real roles | `commissions.test.ts`, `api.test.ts` (CSV 403), carrier responses carry no commission fields |
| Entity A user can't access entity B appointments, codes or agreements | N/A (D1, D17: one agency entity) | Scoped grants exist in the schema (`user_role_scopes`) but aren't used |
| Admin without explicit finance permission can't see restricted financial details | N/A (D1: ADMIN has everything) | Restricted documents need `commission.read` (`documents.test.ts`) |
| ID substitution and direct URLs don't bypass permissions | Pass | `carriers.test.ts`, `contacts.test.ts`, `codes.test.ts` (another record's children → 404) |

## Carrier model
| Item | Status | Proof |
|---|---|---|
| Insurer, writing company, MGA and wholesaler, linked | Pass | `constraints.test.ts`, `carriers.test.ts` |
| One product with several writing companies and intermediary channels | Pass | `constraints.test.ts`, `carriers.test.ts` |
| Archiving keeps historical references | Pass | `constraints.test.ts`, `carriers.test.ts`, e2e `smoke.spec.ts` |
| Search and filter by name, product, state, status, owner | Pass (state filter is in the Market Finder and Contacts) | `carriers.test.ts`, `market.test.ts` |

## Contacts
| Item | Status | Proof |
|---|---|---|
| One contact with several carrier/product/territory assignments | Pass | `contacts.test.ts`, e2e `contacts.spec.ts` |
| Verification dates and inactive assignments display correctly | Pass | `contacts.test.ts`, `dates.test.ts` |

## Appointments and codes
Appointments are managed by corporate (DECISIONS N19); only codes and portal links are kept here.
| Item | Status | Proof |
|---|---|---|
| One agency entity has many appointments and codes | Codes: Pass; appointments N/A (N19) | `codes.test.ts`, `constraints.test.ts` |
| Expired appointments never show as active | N/A (N19: appointment dates and statuses aren't kept) | Codes show "In use" / "Not in use": `codes.test.ts` |
| Overlapping active duplicate codes are rejected | Pass | `constraints.test.ts`, `codes.test.ts` (clear message) |
| No passwords or credentials in portal records | Pass | `constraints.test.ts` (no columns), `codes.test.ts`, `dates.test.ts` (credential guard) |

## Appetite
| Item | Status | Proof |
|---|---|---|
| An approved profile has a source, owner and effective date | Pass | `constraints.test.ts` (DB CHECK), `appetite.test.ts` (source required) |
| Search distinguishes accepted, referral, prohibited and unknown | Pass | `market.test.ts`, e2e `appetite.spec.ts` |
| Conflicting rules produce a warning | Pass | `appetite.test.ts` |
| Historical versions stay retrievable | Pass | `appetite.test.ts`, `constraints.test.ts` |

## Commissions
| Item | Status | Proof |
|---|---|---|
| Rates vary by new/renewal, product, territory and date | Pass | `constraints.test.ts`, `commissions.test.ts` |
| Overlapping approved schedules are rejected | Pass | `constraints.test.ts`, `commissions.test.ts` |
| Decimal precision; no floating-point money | Pass | `constraints.test.ts`, `commissions.test.ts` |
| Restricted documents and rates enforced on the server | Pass | `commissions.test.ts`, `documents.test.ts` |

## Documents and approvals
| Item | Status | Proof |
|---|---|---|
| Private upload, versions, permission-filtered download | Pass | `documents.test.ts`, `api.test.ts`, e2e `appetite.spec.ts` |
| Change request shows old and new data with its source | Pass (proposed rate, what it replaces, and its end date; the profile shows versions and sources) | `appetite.test.ts`, `commissions.test.ts`, the Approvals screen |
| Approve/reject writes an immutable audit event and keeps the prior version | Pass | `appetite.test.ts`, `commissions.test.ts`, `constraints.test.ts` (append-only) |
| AI extraction is not active in the MVP | Pass | Not built (D2) |

## Imports
| Item | Status | Proof |
|---|---|---|
| CSV preview maps columns and reports invalid rows | Pass | `imports.test.ts` |
| Duplicate candidates prevent silent overwrites | Pass (never overwrites; possible duplicates need an opt-in) | `imports.test.ts` |
| Commit is transactional and produces an error report | Pass | `imports.test.ts` |

## Quality gates
| Item | Status | Proof |
|---|---|---|
| lint, typecheck, test, build | Pass | `npm run check` |
| Playwright: login, carrier creation, appetite lookup, restricted commissions, approval flow | Pass, except restricted commissions: N/A (D1) in the browser; covered by API/service tests | `tests/e2e/*` |
| Accessibility checks on primary screens | Pass (axe: no serious or critical issues on 11 screens; not a full WCAG audit) | e2e `a11y.spec.ts` |
| No critical dependency vulnerabilities | Pass (0 in production deps) | `docs/SECURITY.md` |
| No real carrier, agency, commission or employee details in fixtures | Pass | `seed.test.ts`; all fixtures are DEMO/TEST, `@example.invalid` |
| p95 search under 2 s on a realistic size | Pass (Market Finder p95 928 ms for 300 carriers / 2,400 rules; global search 96 ms; local PGlite) | `tests/perf/perf.test.ts` (`npm run test:perf`) |
