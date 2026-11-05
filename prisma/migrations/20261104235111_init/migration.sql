-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('INSURER', 'GROUP', 'MGA', 'MGU', 'WHOLESALER', 'PROGRAM_ADMIN', 'GENERAL_AGENCY', 'AGENCY', 'OTHER');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "OrganizationRelationshipType" AS ENUM ('GROUP_MEMBER', 'WRITING_COMPANY_OF', 'MGA_FOR', 'MGU_FOR', 'WHOLESALER_FOR', 'PROGRAM_ADMIN_FOR', 'GENERAL_AGENT_FOR', 'OTHER');

-- CreateEnum
CREATE TYPE "ActiveStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DistributionType" AS ENUM ('DIRECT', 'WHOLESALE', 'MGA', 'PROGRAM', 'AGGREGATOR', 'OTHER');

-- CreateEnum
CREATE TYPE "AccessStatus" AS ENUM ('AVAILABLE', 'RESTRICTED', 'CLOSED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TerritoryType" AS ENUM ('COUNTRY', 'STATE', 'COUNTY', 'POSTAL_CODE');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "AgencyCodeType" AS ENUM ('MASTER', 'PRODUCER', 'SUB_CODE', 'LOCATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactRole" AS ENUM ('UNDERWRITER', 'MARKETING_REP', 'REGIONAL_MANAGER', 'PRODUCT_MANAGER', 'SERVICE', 'CLAIMS', 'OTHER');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('NOTE', 'CALL', 'MEETING', 'EMAIL', 'VISIT', 'OTHER');

-- CreateEnum
CREATE TYPE "Classification" AS ENUM ('GENERAL', 'INTERNAL', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "AppetiteOutcome" AS ENUM ('PREFERRED', 'ACCEPTED', 'REFERRAL', 'PROHIBITED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RuleOperator" AS ENUM ('EQ', 'NEQ', 'IN', 'NOT_IN', 'LT', 'LTE', 'GT', 'GTE', 'BETWEEN', 'EXISTS');

-- CreateEnum
CREATE TYPE "AttributeDataType" AS ENUM ('TEXT', 'INTEGER', 'NUMBER', 'MONEY', 'BOOLEAN', 'DATE', 'ENUM');

-- CreateEnum
CREATE TYPE "IndustryCodeSystem" AS ENUM ('NAICS', 'SIC', 'ISO_GL', 'NCCI', 'CARRIER_SPECIFIC', 'OTHER');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('NEW', 'RENEWAL', 'ENDORSEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "CommissionBasis" AS ENUM ('RATE', 'FLAT', 'TIERED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('APPETITE_GUIDE', 'BULLETIN', 'UNDERWRITING_GUIDELINES', 'AGREEMENT', 'COMMISSION_SCHEDULE', 'APPLICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RecordType" AS ENUM ('ORGANIZATION', 'CARRIER_PRODUCT', 'MARKET_CHANNEL', 'AGENCY_APPOINTMENT', 'AGENCY_CODE', 'CARRIER_PORTAL', 'CONTACT', 'CONTACT_ASSIGNMENT', 'APPETITE_PROFILE', 'APPETITE_RULE', 'UNDERWRITING_REQUIREMENT', 'COVERAGE_CAPABILITY', 'COMMISSION_AGREEMENT', 'COMMISSION_SCHEDULE', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('DOCUMENT', 'IMPORT', 'USER_ENTERED', 'AI_EXTRACTED');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'PREVIEWED', 'COMMITTED', 'FAILED', 'UNDONE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "identity_subject" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "agency_entities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "domicile_state" CHAR(2),
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "agency_entity_id" UUID,

    CONSTRAINT "business_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role_scopes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "agency_entity_id" UUID,
    "business_unit_id" UUID,
    "line_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_role_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legal_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "parent_id" UUID,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "owner_user_id" UUID,
    "website" TEXT,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_identifiers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_relationships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "from_org_id" UUID NOT NULL,
    "to_org_id" UUID NOT NULL,
    "relationship_type" "OrganizationRelationshipType" NOT NULL,
    "effective_from" DATE,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lines_of_business" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "lines_of_business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "line_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "product_type" TEXT,

    CONSTRAINT "insurance_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "writing_company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "program_name" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carrier_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_channels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "carrier_product_id" UUID NOT NULL,
    "intermediary_org_id" UUID,
    "distribution_type" "DistributionType" NOT NULL,
    "access_status" "AccessStatus" NOT NULL DEFAULT 'UNKNOWN',
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "territories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "country_code" CHAR(2) NOT NULL,
    "state_code" CHAR(2),
    "county_fips" CHAR(5),
    "postal_code" TEXT,
    "territory_type" "TerritoryType" NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "territories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_appointments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_entity_id" UUID NOT NULL,
    "market_channel_id" UUID NOT NULL,
    "appointment_type" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING',
    "effective_from" DATE,
    "effective_to" DATE,
    "source_document_version_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_authorizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "appointment_id" UUID NOT NULL,
    "territory_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "authority_type" TEXT NOT NULL,

    CONSTRAINT "appointment_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "appointment_id" UUID NOT NULL,
    "code_type" "AgencyCodeType" NOT NULL,
    "code_value" TEXT NOT NULL,
    "assigned_user_id" UUID,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_portals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "access_instructions" TEXT,
    "credential_vault_reference" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carrier_portals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "office_phone" TEXT,
    "mobile_phone" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "verified_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contact_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "market_channel_id" UUID,
    "territory_id" UUID,
    "title" TEXT,
    "role" "ContactRole" NOT NULL,
    "authority_notes" TEXT,
    "backup_contact_id" UUID,
    "effective_from" DATE,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_specialties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contact_assignment_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "industry_code" TEXT,

    CONSTRAINT "contact_specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationship_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contact_id" UUID,
    "owner_user_id" UUID NOT NULL,
    "type" "ActivityType" NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "notes" TEXT NOT NULL,
    "classification" "Classification" NOT NULL DEFAULT 'GENERAL',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relationship_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appetite_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "carrier_product_id" UUID NOT NULL,
    "market_channel_id" UUID,
    "version" INTEGER NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE,
    "effective_to" DATE,
    "owner_user_id" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "verified_at" TIMESTAMPTZ(6),
    "next_review_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appetite_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_attribute_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "data_type" "AttributeDataType" NOT NULL,
    "unit" TEXT,
    "validation_schema" JSONB,
    "searchable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "risk_attribute_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appetite_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profile_id" UUID NOT NULL,
    "attribute_definition_id" UUID,
    "operator" "RuleOperator",
    "typed_value" JSONB,
    "outcome" "AppetiteOutcome" NOT NULL DEFAULT 'UNKNOWN',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "effective_from" DATE,
    "effective_to" DATE,
    "rationale" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appetite_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appetite_rule_territories" (
    "rule_id" UUID NOT NULL,
    "territory_id" UUID NOT NULL,

    CONSTRAINT "appetite_rule_territories_pkey" PRIMARY KEY ("rule_id","territory_id")
);

-- CreateTable
CREATE TABLE "appetite_rule_industries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rule_id" UUID NOT NULL,
    "classification_system" "IndustryCodeSystem" NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "appetite_rule_industries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "underwriting_requirements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "carrier_product_id" UUID NOT NULL,
    "condition" JSONB,
    "requirement_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source_document_version_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "underwriting_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coverage_capabilities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "carrier_product_id" UUID NOT NULL,
    "coverage_code" TEXT NOT NULL,
    "min_limit" DECIMAL(18,2),
    "max_limit" DECIMAL(18,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',

    CONSTRAINT "coverage_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_agreements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_entity_id" UUID NOT NULL,
    "market_channel_id" UUID NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "agreement_ref" TEXT,
    "source_document_version_id" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "contingency_notes" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agreement_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "territory_id" UUID,
    "transaction_type" "TransactionType" NOT NULL,
    "basis" "CommissionBasis" NOT NULL,
    "rate" DECIMAL(9,6),
    "flat_amount" DECIMAL(18,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_tiers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schedule_id" UUID NOT NULL,
    "threshold_min" DECIMAL(18,2) NOT NULL,
    "threshold_max" DECIMAL(18,2),
    "rate" DECIMAL(9,6),
    "flat_amount" DECIMAL(18,2),

    CONSTRAINT "commission_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "classification" "Classification" NOT NULL DEFAULT 'INTERNAL',
    "owner_user_id" UUID,
    "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "object_key" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "record_type" "RecordType" NOT NULL,
    "record_id" UUID NOT NULL,
    "source_kind" "SourceKind" NOT NULL,
    "document_version_id" UUID,
    "import_job_id" UUID,
    "page_or_section" TEXT,
    "source_note" TEXT,
    "confidence" DECIMAL(4,3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "record_type" "RecordType" NOT NULL,
    "record_id" UUID,
    "proposed_patch" JSONB NOT NULL,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "proposed_by" UUID NOT NULL,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "rationale" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "record_type" "RecordType" NOT NULL,
    "record_id" UUID NOT NULL,
    "verified_by" UUID NOT NULL,
    "verified_at" TIMESTAMPTZ(6) NOT NULL,
    "next_review_at" TIMESTAMPTZ(6),
    "source_note" TEXT,

    CONSTRAINT "verification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "before_state" JSONB,
    "after_state" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlation_id" TEXT,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_filename" TEXT NOT NULL,
    "target_type" "RecordType" NOT NULL,
    "mapping" JSONB,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "accepted_rows" INTEGER NOT NULL DEFAULT 0,
    "rejected_rows" INTEGER NOT NULL DEFAULT 0,
    "error_object_key" TEXT,
    "initiated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_identity_subject_key" ON "users"("identity_subject");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "agency_entities_organization_id_key" ON "agency_entities"("organization_id");

-- CreateIndex
CREATE INDEX "business_units_agency_entity_id_idx" ON "business_units"("agency_entity_id");

-- CreateIndex
CREATE INDEX "user_role_scopes_user_id_idx" ON "user_role_scopes"("user_id");

-- CreateIndex
CREATE INDEX "user_role_scopes_role_id_idx" ON "user_role_scopes"("role_id");

-- CreateIndex
CREATE INDEX "user_role_scopes_agency_entity_id_idx" ON "user_role_scopes"("agency_entity_id");

-- CreateIndex
CREATE INDEX "user_role_scopes_business_unit_id_idx" ON "user_role_scopes"("business_unit_id");

-- CreateIndex
CREATE INDEX "user_role_scopes_line_id_idx" ON "user_role_scopes"("line_id");

-- CreateIndex
CREATE INDEX "organizations_parent_id_idx" ON "organizations"("parent_id");

-- CreateIndex
CREATE INDEX "organizations_owner_user_id_idx" ON "organizations"("owner_user_id");

-- CreateIndex
CREATE INDEX "organizations_type_status_idx" ON "organizations"("type", "status");

-- CreateIndex
CREATE INDEX "organization_identifiers_organization_id_idx" ON "organization_identifiers"("organization_id");

-- CreateIndex
CREATE INDEX "organization_relationships_from_org_id_idx" ON "organization_relationships"("from_org_id");

-- CreateIndex
CREATE INDEX "organization_relationships_to_org_id_idx" ON "organization_relationships"("to_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "lines_of_business_code_key" ON "lines_of_business"("code");

-- CreateIndex
CREATE INDEX "lines_of_business_parent_id_idx" ON "lines_of_business"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_products_line_id_code_key" ON "insurance_products"("line_id", "code");

-- CreateIndex
CREATE INDEX "carrier_products_writing_company_id_idx" ON "carrier_products"("writing_company_id");

-- CreateIndex
CREATE INDEX "carrier_products_product_id_idx" ON "carrier_products"("product_id");

-- CreateIndex
CREATE INDEX "market_channels_carrier_product_id_idx" ON "market_channels"("carrier_product_id");

-- CreateIndex
CREATE INDEX "market_channels_intermediary_org_id_idx" ON "market_channels"("intermediary_org_id");

-- CreateIndex
CREATE INDEX "territories_state_code_idx" ON "territories"("state_code");

-- CreateIndex
CREATE INDEX "agency_appointments_agency_entity_id_idx" ON "agency_appointments"("agency_entity_id");

-- CreateIndex
CREATE INDEX "agency_appointments_market_channel_id_idx" ON "agency_appointments"("market_channel_id");

-- CreateIndex
CREATE INDEX "agency_appointments_source_document_version_id_idx" ON "agency_appointments"("source_document_version_id");

-- CreateIndex
CREATE INDEX "agency_appointments_status_effective_to_idx" ON "agency_appointments"("status", "effective_to");

-- CreateIndex
CREATE INDEX "appointment_authorizations_appointment_id_idx" ON "appointment_authorizations"("appointment_id");

-- CreateIndex
CREATE INDEX "appointment_authorizations_territory_id_idx" ON "appointment_authorizations"("territory_id");

-- CreateIndex
CREATE INDEX "appointment_authorizations_product_id_idx" ON "appointment_authorizations"("product_id");

-- CreateIndex
CREATE INDEX "agency_codes_appointment_id_idx" ON "agency_codes"("appointment_id");

-- CreateIndex
CREATE INDEX "agency_codes_assigned_user_id_idx" ON "agency_codes"("assigned_user_id");

-- CreateIndex
CREATE INDEX "carrier_portals_organization_id_idx" ON "carrier_portals"("organization_id");

-- CreateIndex
CREATE INDEX "contacts_email_idx" ON "contacts"("email");

-- CreateIndex
CREATE INDEX "contact_assignments_contact_id_idx" ON "contact_assignments"("contact_id");

-- CreateIndex
CREATE INDEX "contact_assignments_organization_id_idx" ON "contact_assignments"("organization_id");

-- CreateIndex
CREATE INDEX "contact_assignments_market_channel_id_idx" ON "contact_assignments"("market_channel_id");

-- CreateIndex
CREATE INDEX "contact_assignments_territory_id_idx" ON "contact_assignments"("territory_id");

-- CreateIndex
CREATE INDEX "contact_assignments_backup_contact_id_idx" ON "contact_assignments"("backup_contact_id");

-- CreateIndex
CREATE INDEX "contact_specialties_contact_assignment_id_idx" ON "contact_specialties"("contact_assignment_id");

-- CreateIndex
CREATE INDEX "contact_specialties_product_id_idx" ON "contact_specialties"("product_id");

-- CreateIndex
CREATE INDEX "relationship_activities_organization_id_occurred_at_idx" ON "relationship_activities"("organization_id", "occurred_at");

-- CreateIndex
CREATE INDEX "relationship_activities_contact_id_idx" ON "relationship_activities"("contact_id");

-- CreateIndex
CREATE INDEX "relationship_activities_owner_user_id_idx" ON "relationship_activities"("owner_user_id");

-- CreateIndex
CREATE INDEX "appetite_profiles_carrier_product_id_idx" ON "appetite_profiles"("carrier_product_id");

-- CreateIndex
CREATE INDEX "appetite_profiles_market_channel_id_idx" ON "appetite_profiles"("market_channel_id");

-- CreateIndex
CREATE INDEX "appetite_profiles_owner_user_id_idx" ON "appetite_profiles"("owner_user_id");

-- CreateIndex
CREATE INDEX "appetite_profiles_approved_by_idx" ON "appetite_profiles"("approved_by");

-- CreateIndex
CREATE INDEX "appetite_profiles_status_next_review_at_idx" ON "appetite_profiles"("status", "next_review_at");

-- CreateIndex
CREATE UNIQUE INDEX "risk_attribute_definitions_product_id_key_key" ON "risk_attribute_definitions"("product_id", "key");

-- CreateIndex
CREATE INDEX "appetite_rules_profile_id_outcome_idx" ON "appetite_rules"("profile_id", "outcome");

-- CreateIndex
CREATE INDEX "appetite_rules_attribute_definition_id_idx" ON "appetite_rules"("attribute_definition_id");

-- CreateIndex
CREATE INDEX "appetite_rule_territories_territory_id_idx" ON "appetite_rule_territories"("territory_id");

-- CreateIndex
CREATE INDEX "appetite_rule_industries_classification_system_code_idx" ON "appetite_rule_industries"("classification_system", "code");

-- CreateIndex
CREATE UNIQUE INDEX "appetite_rule_industries_rule_id_classification_system_code_key" ON "appetite_rule_industries"("rule_id", "classification_system", "code");

-- CreateIndex
CREATE INDEX "underwriting_requirements_carrier_product_id_idx" ON "underwriting_requirements"("carrier_product_id");

-- CreateIndex
CREATE INDEX "underwriting_requirements_source_document_version_id_idx" ON "underwriting_requirements"("source_document_version_id");

-- CreateIndex
CREATE INDEX "coverage_capabilities_carrier_product_id_idx" ON "coverage_capabilities"("carrier_product_id");

-- CreateIndex
CREATE INDEX "commission_agreements_agency_entity_id_idx" ON "commission_agreements"("agency_entity_id");

-- CreateIndex
CREATE INDEX "commission_agreements_market_channel_id_idx" ON "commission_agreements"("market_channel_id");

-- CreateIndex
CREATE INDEX "commission_agreements_source_document_version_id_idx" ON "commission_agreements"("source_document_version_id");

-- CreateIndex
CREATE INDEX "commission_agreements_approved_by_idx" ON "commission_agreements"("approved_by");

-- CreateIndex
CREATE INDEX "commission_schedules_agreement_id_effective_from_idx" ON "commission_schedules"("agreement_id", "effective_from");

-- CreateIndex
CREATE INDEX "commission_schedules_product_id_idx" ON "commission_schedules"("product_id");

-- CreateIndex
CREATE INDEX "commission_schedules_territory_id_idx" ON "commission_schedules"("territory_id");

-- CreateIndex
CREATE INDEX "commission_schedules_approved_by_idx" ON "commission_schedules"("approved_by");

-- CreateIndex
CREATE INDEX "commission_tiers_schedule_id_idx" ON "commission_tiers"("schedule_id");

-- CreateIndex
CREATE INDEX "documents_owner_user_id_idx" ON "documents"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_object_key_key" ON "document_versions"("object_key");

-- CreateIndex
CREATE INDEX "document_versions_uploaded_by_idx" ON "document_versions"("uploaded_by");

-- CreateIndex
CREATE INDEX "document_versions_sha256_idx" ON "document_versions"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_number_key" ON "document_versions"("document_id", "version_number");

-- CreateIndex
CREATE INDEX "record_sources_record_type_record_id_idx" ON "record_sources"("record_type", "record_id");

-- CreateIndex
CREATE INDEX "record_sources_document_version_id_idx" ON "record_sources"("document_version_id");

-- CreateIndex
CREATE INDEX "record_sources_import_job_id_idx" ON "record_sources"("import_job_id");

-- CreateIndex
CREATE INDEX "record_sources_created_by_idx" ON "record_sources"("created_by");

-- CreateIndex
CREATE INDEX "change_requests_status_created_at_idx" ON "change_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "change_requests_record_type_record_id_idx" ON "change_requests"("record_type", "record_id");

-- CreateIndex
CREATE INDEX "change_requests_proposed_by_idx" ON "change_requests"("proposed_by");

-- CreateIndex
CREATE INDEX "change_requests_reviewed_by_idx" ON "change_requests"("reviewed_by");

-- CreateIndex
CREATE INDEX "verification_events_record_type_record_id_idx" ON "verification_events"("record_type", "record_id");

-- CreateIndex
CREATE INDEX "verification_events_next_review_at_idx" ON "verification_events"("next_review_at");

-- CreateIndex
CREATE INDEX "verification_events_verified_by_idx" ON "verification_events"("verified_by");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit_events"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_actor_id_idx" ON "audit_events"("actor_id");

-- CreateIndex
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events"("occurred_at");

-- CreateIndex
CREATE INDEX "import_jobs_initiated_by_idx" ON "import_jobs"("initiated_by");

-- CreateIndex
CREATE INDEX "import_jobs_status_idx" ON "import_jobs"("status");

-- CreateIndex
CREATE INDEX "app_settings_updated_by_idx" ON "app_settings"("updated_by");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_entities" ADD CONSTRAINT "agency_entities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_units" ADD CONSTRAINT "business_units_agency_entity_id_fkey" FOREIGN KEY ("agency_entity_id") REFERENCES "agency_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_scopes" ADD CONSTRAINT "user_role_scopes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_scopes" ADD CONSTRAINT "user_role_scopes_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_scopes" ADD CONSTRAINT "user_role_scopes_agency_entity_id_fkey" FOREIGN KEY ("agency_entity_id") REFERENCES "agency_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_scopes" ADD CONSTRAINT "user_role_scopes_business_unit_id_fkey" FOREIGN KEY ("business_unit_id") REFERENCES "business_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_scopes" ADD CONSTRAINT "user_role_scopes_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "lines_of_business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_identifiers" ADD CONSTRAINT "organization_identifiers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_relationships" ADD CONSTRAINT "organization_relationships_from_org_id_fkey" FOREIGN KEY ("from_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_relationships" ADD CONSTRAINT "organization_relationships_to_org_id_fkey" FOREIGN KEY ("to_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lines_of_business" ADD CONSTRAINT "lines_of_business_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "lines_of_business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_products" ADD CONSTRAINT "insurance_products_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "lines_of_business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_products" ADD CONSTRAINT "carrier_products_writing_company_id_fkey" FOREIGN KEY ("writing_company_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_products" ADD CONSTRAINT "carrier_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "insurance_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_channels" ADD CONSTRAINT "market_channels_carrier_product_id_fkey" FOREIGN KEY ("carrier_product_id") REFERENCES "carrier_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_channels" ADD CONSTRAINT "market_channels_intermediary_org_id_fkey" FOREIGN KEY ("intermediary_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_appointments" ADD CONSTRAINT "agency_appointments_agency_entity_id_fkey" FOREIGN KEY ("agency_entity_id") REFERENCES "agency_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_appointments" ADD CONSTRAINT "agency_appointments_market_channel_id_fkey" FOREIGN KEY ("market_channel_id") REFERENCES "market_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_appointments" ADD CONSTRAINT "agency_appointments_source_document_version_id_fkey" FOREIGN KEY ("source_document_version_id") REFERENCES "document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_authorizations" ADD CONSTRAINT "appointment_authorizations_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "agency_appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_authorizations" ADD CONSTRAINT "appointment_authorizations_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "territories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_authorizations" ADD CONSTRAINT "appointment_authorizations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "insurance_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_codes" ADD CONSTRAINT "agency_codes_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "agency_appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_codes" ADD CONSTRAINT "agency_codes_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_portals" ADD CONSTRAINT "carrier_portals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_assignments" ADD CONSTRAINT "contact_assignments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_assignments" ADD CONSTRAINT "contact_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_assignments" ADD CONSTRAINT "contact_assignments_market_channel_id_fkey" FOREIGN KEY ("market_channel_id") REFERENCES "market_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_assignments" ADD CONSTRAINT "contact_assignments_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "territories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_assignments" ADD CONSTRAINT "contact_assignments_backup_contact_id_fkey" FOREIGN KEY ("backup_contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_specialties" ADD CONSTRAINT "contact_specialties_contact_assignment_id_fkey" FOREIGN KEY ("contact_assignment_id") REFERENCES "contact_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_specialties" ADD CONSTRAINT "contact_specialties_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "insurance_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_activities" ADD CONSTRAINT "relationship_activities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_activities" ADD CONSTRAINT "relationship_activities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_activities" ADD CONSTRAINT "relationship_activities_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appetite_profiles" ADD CONSTRAINT "appetite_profiles_carrier_product_id_fkey" FOREIGN KEY ("carrier_product_id") REFERENCES "carrier_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appetite_profiles" ADD CONSTRAINT "appetite_profiles_market_channel_id_fkey" FOREIGN KEY ("market_channel_id") REFERENCES "market_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appetite_profiles" ADD CONSTRAINT "appetite_profiles_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appetite_profiles" ADD CONSTRAINT "appetite_profiles_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_attribute_definitions" ADD CONSTRAINT "risk_attribute_definitions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "insurance_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appetite_rules" ADD CONSTRAINT "appetite_rules_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "appetite_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appetite_rules" ADD CONSTRAINT "appetite_rules_attribute_definition_id_fkey" FOREIGN KEY ("attribute_definition_id") REFERENCES "risk_attribute_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appetite_rule_territories" ADD CONSTRAINT "appetite_rule_territories_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "appetite_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appetite_rule_territories" ADD CONSTRAINT "appetite_rule_territories_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "territories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appetite_rule_industries" ADD CONSTRAINT "appetite_rule_industries_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "appetite_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "underwriting_requirements" ADD CONSTRAINT "underwriting_requirements_carrier_product_id_fkey" FOREIGN KEY ("carrier_product_id") REFERENCES "carrier_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "underwriting_requirements" ADD CONSTRAINT "underwriting_requirements_source_document_version_id_fkey" FOREIGN KEY ("source_document_version_id") REFERENCES "document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverage_capabilities" ADD CONSTRAINT "coverage_capabilities_carrier_product_id_fkey" FOREIGN KEY ("carrier_product_id") REFERENCES "carrier_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_agreements" ADD CONSTRAINT "commission_agreements_agency_entity_id_fkey" FOREIGN KEY ("agency_entity_id") REFERENCES "agency_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_agreements" ADD CONSTRAINT "commission_agreements_market_channel_id_fkey" FOREIGN KEY ("market_channel_id") REFERENCES "market_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_agreements" ADD CONSTRAINT "commission_agreements_source_document_version_id_fkey" FOREIGN KEY ("source_document_version_id") REFERENCES "document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_agreements" ADD CONSTRAINT "commission_agreements_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_schedules" ADD CONSTRAINT "commission_schedules_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "commission_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_schedules" ADD CONSTRAINT "commission_schedules_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "insurance_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_schedules" ADD CONSTRAINT "commission_schedules_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "territories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_schedules" ADD CONSTRAINT "commission_schedules_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_tiers" ADD CONSTRAINT "commission_tiers_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "commission_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_sources" ADD CONSTRAINT "record_sources_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_sources" ADD CONSTRAINT "record_sources_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_sources" ADD CONSTRAINT "record_sources_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_proposed_by_fkey" FOREIGN KEY ("proposed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_events" ADD CONSTRAINT "verification_events_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
