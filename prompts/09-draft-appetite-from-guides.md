# Milestone 9: AI drafts appetite from a guide (P2, part 2)

Status: started 2026-11-08. Josh asked for a way to read a guide once and save what it says, instead of an AI call per question. He chose option 1: AI turns a guide into appetite rules once. He chose "everything it can" (eligibility, limits, deductibles, forms, binding rules), and new risk details are proposed inside the draft (DECISIONS N22).

## Build
- **Start:** on a guide document (and on the carrier's Appetite tab), **Draft appetite from this guide**. Pick the carrier product it covers (e.g. Personal Homeowners).
- **One AI read per guide:**
  - Claude Opus 5.5 reads the PDF (Files API, already uploaded by Ask the guides when it was asked about) and returns structured data.
  - It receives the product's existing risk details and is told to reuse them.
  - It returns:
    - new risk details (key, label, type, unit, allowed values);
    - rules (outcome, the risk detail plus operator and value or none, states, NAICS, summary, page, quote, confidence);
    - limits (coverage, minimum, maximum);
    - requirements (type, e.g. Deductible, Required form, Binding rule, Inspection, Other, and description).
  - Every item carries the page, a quote and a confidence level.
  - The run is stored in `guide_extractions`: status, proposals, model, prompt version, usage, cost, error.
- **Review screen** (`/extractions/:id`):
  - each proposed item shows its quote, page link and confidence, with a checkbox (all ticked by default; low-confidence items flagged).
  - **Create draft from selected**:
    - adds the ticked new risk details, then the ticked rules to an appetite DRAFT for that product (reusing an open draft, or creating one);
    - adds the ticked limits and requirements to the carrier product;
    - cites the guide on the profile and records an `AI_EXTRACTED` source on every rule, limit and requirement (document, page, quote, confidence);
    - reports anything skipped and why (for example an invalid value).
  - Then on to the draft, where the normal edit, submit and approve flow applies. **Nothing is approved by the AI.**
- **Market Finder:** a risk detail with allowed values shows as a drop-down.
- **Dev reader:** `AI_DRIVER=dev` returns proposals parsed from simple `RULE:` / `LIMIT:` / `REQ:` lines in a test PDF. It refuses to run in production.

## Definition of done
Tests (dev reader):
- proposals are stored;
- applying only the selected items;
- new details are created and reused;
- rules land in a draft, never approved;
- AI sources carry page, quote and confidence;
- invalid items are skipped with a reason;
- limits and requirements are added;
- permissions;
- a failure is logged;
- the Market Finder drop-down for allowed values;
- after approval, the Market Finder gives the guide's outcome.

Plus a browser test: upload, draft, review, apply, approve, Market Finder.

Real AI run checked by hand on the Travelers guide.

## Out of scope
- AI editing existing approved rules in place (a new guide makes a new version).
- Rating, premium, commission.
