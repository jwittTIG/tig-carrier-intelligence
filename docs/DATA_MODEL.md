# Database Design — TIG Carrier Intelligence

## Principles
PostgreSQL relational source of truth; UUID primary keys; timestamptz created/updated; immutable audit records; normalized carrier/market structure; effective dating; provenance; default-deny authorization. Prisma migrations, plus raw SQL for exclusion constraints and RLS where necessary. No health/life/benefits tables.

## Core entities (PK id UUID unless noted)
### Identity & agency
- users(identity_subject UNIQUE, name, email, status)
- roles(code UNIQUE, description)
- permissions(code UNIQUE, description)
- role_permissions(role_id FK, permission_id FK, PK pair)
- agency_entities(organization_id FK UNIQUE, domicile_state, status)
- business_units(name, agency_entity_id FK nullable)
- user_role_scopes(user_id FK, role_id FK, agency_entity_id FK nullable, business_unit_id FK nullable, line_id FK nullable)

### Market structure
- organizations(legal_name, display_name, type ENUM insurer/group/mga/mgu/wholesaler/program_admin/general_agency/agency/other, parent_id FK nullable, status)
- organization_identifiers(organization_id FK, type, value, jurisdiction, UNIQUE(type,value,jurisdiction) where appropriate)
- organization_relationships(from_org_id FK, to_org_id FK, relationship_type, effective_from, effective_to)
- lines_of_business(code UNIQUE, name, parent_id nullable) — P&C only
- insurance_products(line_id FK, code, name, product_type, UNIQUE(line_id,code))
- carrier_products(writing_company_id FK organizations, product_id FK, program_name, status)
- market_channels(carrier_product_id FK, intermediary_org_id FK nullable, distribution_type, access_status)
- territories(country_code, state_code nullable, county_fips nullable, postal_code nullable, territory_type)

### Appointments and access
- agency_appointments(agency_entity_id FK, market_channel_id FK, appointment_type, status, effective_from, effective_to, source_document_version_id nullable)
- appointment_authorizations(appointment_id FK, territory_id FK, product_id FK, authority_type)
- agency_codes(appointment_id FK, code_type, code_value, effective_from, effective_to, status)
- carrier_portals(organization_id FK, name, url, access_instructions, credential_vault_reference nullable) — no passwords

### People and relationships
- contacts(first_name, last_name, email, office_phone, mobile_phone, status, verified_at)
- contact_assignments(contact_id FK, organization_id FK, market_channel_id FK nullable, territory_id FK nullable, title, role, authority_notes, backup_contact_id FK nullable, effective_from, effective_to)
- contact_specialties(contact_assignment_id FK, product_id FK, industry_code nullable)
- relationship_activities(organization_id FK, contact_id FK nullable, owner_user_id FK, type, occurred_at, notes, classification)

### Appetite
- appetite_profiles(carrier_product_id FK, market_channel_id FK nullable, version, status draft/pending/approved/retired, effective_from, effective_to, owner_user_id FK, verified_at, next_review_at)
- risk_attribute_definitions(product_id FK, key, label, data_type, unit nullable, validation_schema JSONB, searchable BOOLEAN)
- appetite_rules(profile_id FK, attribute_definition_id FK, operator, typed_value JSONB, outcome preferred/accepted/referral/prohibited/unknown, priority, effective_from, effective_to, rationale)
- appetite_rule_territories(rule_id FK, territory_id FK)
- appetite_rule_industries(rule_id FK, classification_system, code)
- underwriting_requirements(carrier_product_id FK, condition JSONB, requirement_type, description, source_document_version_id FK nullable)
- coverage_capabilities(carrier_product_id FK, coverage_code, min_limit NUMERIC nullable, max_limit NUMERIC nullable, currency)

### Finance
- commission_agreements(agency_entity_id FK, market_channel_id FK, status, agreement_ref, source_document_version_id FK, approved_by FK nullable)
- commission_schedules(agreement_id FK, product_id FK, territory_id FK nullable, transaction_type new/renewal/endorsement/other, basis, rate NUMERIC(9,6) nullable, flat_amount NUMERIC(18,2) nullable, currency, effective_from, effective_to, status)
- commission_tiers(schedule_id FK, threshold_min NUMERIC, threshold_max NUMERIC nullable, rate NUMERIC(9,6) nullable, flat_amount NUMERIC(18,2) nullable)
- contingency_agreements(agreement_id FK, measurement_period, formula JSONB, status) — P2
- commission_transactions(external_id, policy_ref, schedule_id FK nullable, gross_premium NUMERIC(18,2), expected_amount NUMERIC(18,2), actual_amount NUMERIC(18,2)) — P1

### Documents, approvals, audit
- documents(title, document_type, classification, owner_user_id FK, status)
- document_versions(document_id FK, version_number, object_key, sha256, mime_type, size_bytes, uploaded_by FK, uploaded_at, UNIQUE(document_id,version_number))
- record_sources(record_type, record_id, document_version_id FK, page_or_section, source_note) — validated by service, since polymorphic FK
- change_requests(record_type, record_id, proposed_patch JSONB, status, proposed_by FK, reviewed_by FK nullable, reviewed_at nullable, rationale)
- verification_events(record_type, record_id, verified_by FK, verified_at, next_review_at, source_note)
- audit_events(actor_id FK nullable, action, entity_type, entity_id, before_state JSONB, after_state JSONB, occurred_at, correlation_id) append-only
- import_jobs(source_filename, mapping JSONB, status, total_rows, accepted_rows, rejected_rows, error_object_key, initiated_by FK)
- notifications(recipient_user_id FK, event_type, payload JSONB, read_at) — P1

### Submissions (P1)
- risks(external_account_ref, line_id FK, product_id FK, risk_summary, owner_user_id FK)
- risk_attribute_values(risk_id FK, attribute_definition_id FK, typed_value JSONB)
- submissions(risk_id FK, submitted_by FK, status, created_at)
- submission_markets(submission_id FK, market_channel_id FK, contact_assignment_id FK nullable, status)
- quotes(submission_market_id FK, premium NUMERIC(18,2), terms JSONB, expires_at)
- declinations(submission_market_id FK, reason_code, notes)
- placement_outcomes(submission_id FK, selected_quote_id FK nullable, outcome, bound_at nullable)

## Constraints & indexes
- CHECK effective_to >= effective_from where both present.
- Approved appetite/commission records require source, owner/approver and effective_from via service + DB constraints where feasible.
- PostgreSQL exclusion constraint for overlapping approved commission schedule periods with identical agreement/product/territory/transaction/basis; use daterange + GiST/btree_gist, account for NULL territory with normalized scope.
- Prevent duplicate active agency codes for same appointment/type/value with overlapping dates; permit historical changes.
- Index foreign keys; organizations(display_name), contacts(email), appointments(status, effective_to), appetite(profile_id,outcome), commission(agreement_id,effective_from), verification(next_review_at); GIN/trigram for searchable names and selected JSONB fields.
- Audit append-only permissions; enforce tenant/entity scopes at service and optionally RLS; financial tables require separate explicit permission.
- Soft archive operational records; do not cascade-delete history.
- Source documents stored privately; object keys only, never public permanent URLs.

## ER relationship summary
organizations 1:N carrier_products; insurance_products 1:N carrier_products; carrier_products 1:N market_channels; agency_entities 1:N agency_appointments; market_channels 1:N agency_appointments; agency_appointments 1:N agency_codes; carrier_products 1:N appetite_profiles 1:N appetite_rules; commission_agreements 1:N commission_schedules; contacts M:N organizations via contact_assignments; documents 1:N document_versions; document_versions M:N source-backed business records via record_sources.

## Seed data
Seed P&C line taxonomy only and fake example organizations prefixed `DEMO`. Do not seed real carriers, rates, agency codes or personal contacts without provided source data.
