-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "portal_url" TEXT;

-- A web address only: http(s), and no username or password in it (DECISIONS D4).
ALTER TABLE organizations ADD CONSTRAINT organizations_portal_url_chk CHECK (portal_url IS NULL OR portal_url ~* '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$');
