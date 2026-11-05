-- Constraints Prisma cannot express. See docs/DATA_MODEL.md "Constraints & indexes".
-- Every rule here has a test in tests/integration/constraints.test.ts.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── Effective dating: effective_to >= effective_from where both present ──
ALTER TABLE organization_relationships ADD CONSTRAINT organization_relationships_dates_chk CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from);
ALTER TABLE agency_appointments        ADD CONSTRAINT agency_appointments_dates_chk        CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from);
ALTER TABLE agency_codes               ADD CONSTRAINT agency_codes_dates_chk               CHECK (effective_to IS NULL OR effective_to >= effective_from);
ALTER TABLE contact_assignments        ADD CONSTRAINT contact_assignments_dates_chk        CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from);
ALTER TABLE appetite_profiles          ADD CONSTRAINT appetite_profiles_dates_chk          CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from);
ALTER TABLE appetite_rules             ADD CONSTRAINT appetite_rules_dates_chk             CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from);
ALTER TABLE commission_schedules       ADD CONSTRAINT commission_schedules_dates_chk       CHECK (effective_to IS NULL OR effective_to >= effective_from);

-- ── Organizations ──
ALTER TABLE organization_relationships ADD CONSTRAINT organization_relationships_not_self_chk CHECK (from_org_id <> to_org_id);
ALTER TABLE organizations ADD CONSTRAINT organizations_not_own_parent_chk CHECK (parent_id IS NULL OR parent_id <> id);
CREATE UNIQUE INDEX organization_identifiers_type_value_jurisdiction_key
  ON organization_identifiers (type, value, COALESCE(jurisdiction, ''));
CREATE INDEX organizations_display_name_trgm ON organizations USING gin (display_name gin_trgm_ops);
CREATE INDEX organizations_legal_name_trgm   ON organizations USING gin (legal_name gin_trgm_ops);

-- ── Users: email unique regardless of case ──
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

-- ── Territories: one row per natural key; type matches the columns filled ──
CREATE UNIQUE INDEX territories_natural_key
  ON territories (country_code, COALESCE(state_code, ''), COALESCE(county_fips, ''), COALESCE(postal_code, ''));
ALTER TABLE territories ADD CONSTRAINT territories_type_chk CHECK (
  (territory_type = 'COUNTRY'     AND state_code IS NULL AND county_fips IS NULL AND postal_code IS NULL) OR
  (territory_type = 'STATE'       AND state_code IS NOT NULL AND county_fips IS NULL AND postal_code IS NULL) OR
  (territory_type = 'COUNTY'      AND state_code IS NOT NULL AND county_fips IS NOT NULL) OR
  (territory_type = 'POSTAL_CODE' AND postal_code IS NOT NULL)
);

-- ── Carrier portals: links only. A URL must be http(s). (No password column exists.) ──
ALTER TABLE carrier_portals ADD CONSTRAINT carrier_portals_url_chk CHECK (url ~* '^https?://');

-- ── Contacts: name search ──
CREATE INDEX contacts_name_trgm ON contacts USING gin ((first_name || ' ' || last_name) gin_trgm_ops);

-- ── Agency codes: no overlapping ACTIVE duplicates for the same appointment/type/value ──
ALTER TABLE agency_codes ADD CONSTRAINT agency_codes_no_overlap_excl
  EXCLUDE USING gist (
    appointment_id WITH =,
    code_type WITH =,
    code_value WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  ) WHERE (status = 'ACTIVE');

-- ── Appetite ──
CREATE UNIQUE INDEX appetite_profiles_version_key
  ON appetite_profiles (carrier_product_id, COALESCE(market_channel_id, '00000000-0000-0000-0000-000000000000'::uuid), version);
ALTER TABLE appetite_profiles ADD CONSTRAINT appetite_profiles_version_chk CHECK (version >= 1);
-- An APPROVED profile needs an owner, an approver and an effective date. A source
-- (record_sources row) is also required; that is checked by the service layer (M4)
-- because record_sources is polymorphic.
ALTER TABLE appetite_profiles ADD CONSTRAINT appetite_profiles_approved_chk CHECK (
  status <> 'APPROVED' OR (owner_user_id IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND effective_from IS NOT NULL)
);
ALTER TABLE appetite_rules ADD CONSTRAINT appetite_rules_operator_chk CHECK (
  (attribute_definition_id IS NULL AND operator IS NULL AND typed_value IS NULL) OR
  (attribute_definition_id IS NOT NULL AND operator IS NOT NULL AND (operator = 'EXISTS' OR typed_value IS NOT NULL))
);
ALTER TABLE coverage_capabilities ADD CONSTRAINT coverage_capabilities_limits_chk CHECK (
  (min_limit IS NULL OR min_limit >= 0) AND (max_limit IS NULL OR max_limit >= 0) AND
  (min_limit IS NULL OR max_limit IS NULL OR max_limit >= min_limit)
);

-- ── Commissions ──
ALTER TABLE commission_agreements ADD CONSTRAINT commission_agreements_approved_chk CHECK (
  status <> 'APPROVED' OR (source_document_version_id IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
);
ALTER TABLE commission_schedules ADD CONSTRAINT commission_schedules_approved_chk CHECK (
  status <> 'APPROVED' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
);
-- rate is a fraction: 0.125 = 12.5%.
ALTER TABLE commission_schedules ADD CONSTRAINT commission_schedules_amounts_chk CHECK (
  (rate IS NULL OR (rate >= 0 AND rate <= 1)) AND (flat_amount IS NULL OR flat_amount >= 0) AND
  (basis <> 'RATE' OR rate IS NOT NULL) AND
  (basis <> 'FLAT' OR flat_amount IS NOT NULL)
);
-- Overlapping APPROVED schedules with identical scope are rejected. A null territory
-- means "all territories" and is normalized so two null-territory rows still collide.
ALTER TABLE commission_schedules ADD CONSTRAINT commission_schedules_no_overlap_excl
  EXCLUDE USING gist (
    agreement_id WITH =,
    product_id WITH =,
    (COALESCE(territory_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    transaction_type WITH =,
    basis WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  ) WHERE (status = 'APPROVED');
ALTER TABLE commission_tiers ADD CONSTRAINT commission_tiers_chk CHECK (
  threshold_min >= 0 AND (threshold_max IS NULL OR threshold_max >= threshold_min) AND
  (rate IS NULL OR (rate >= 0 AND rate <= 1)) AND (flat_amount IS NULL OR flat_amount >= 0) AND
  (rate IS NOT NULL OR flat_amount IS NOT NULL)
);

-- ── Documents & provenance ──
ALTER TABLE document_versions ADD CONSTRAINT document_versions_chk CHECK (
  version_number >= 1 AND size_bytes >= 0 AND sha256 ~ '^[0-9a-f]{64}$'
);
ALTER TABLE record_sources ADD CONSTRAINT record_sources_kind_chk CHECK (
  (source_kind <> 'DOCUMENT' OR document_version_id IS NOT NULL) AND
  (source_kind <> 'IMPORT' OR import_job_id IS NOT NULL) AND
  (confidence IS NULL OR (source_kind = 'AI_EXTRACTED' AND confidence >= 0 AND confidence <= 1))
);
ALTER TABLE change_requests ADD CONSTRAINT change_requests_review_chk CHECK (
  status IN ('PENDING', 'WITHDRAWN') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
);

-- ── Audit log: append-only ──
CREATE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (% rejected)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER audit_events_no_update_delete BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();
