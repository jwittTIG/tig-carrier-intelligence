# Milestone 8: Ask the guides (AI reads carrier guides; P2, part 1)

Status: started 2026-11-08. Josh: "Adding an appetite is too complicated. I want to be able to upload the PDF of the underwriting guidelines/appetite guide, and have AI read it and understand it. Then I want to be able to have a place to ask questions like 'Will Travelers write a home with a wood shake roof?'" He confirmed D12 (Claude API), one carrier at a time, and AI-drafted appetite rules later.

## Build
- **Guides**: PDFs filed under a carrier with type Appetite guide or Underwriting guidelines (Documents tab, Sources upload, or the Inbox). The current version of each is used. Non-PDF files are listed as "can't be read yet".
- **Ask the guides** page (`/ask`):
  - a question box and a carrier picker; the carrier is detected from the question when its name appears in it ("Will Travelers…").
  - The app sends that carrier's guides (at most 5) and the question to Claude Opus 5.5 with page citations on.
  - Each guide file is uploaded to Anthropic once (Files API) and reused.
- **Answer**:
  - a verdict: Yes / No / Refer to underwriter / Not addressed / Unclear;
  - a short explanation;
  - each supporting quote with its guide, version and page, linking to the PDF at that page;
  - the guides used, with their upload dates;
  - the disclaimer: "AI reading of the carrier's guide, not a coverage commitment or approved appetite; confirm with the underwriter".
  - "Not addressed" is never shown as yes.
- **Log**: every question is stored with:
  - who asked, the carrier and the question;
  - the guide versions used;
  - the model and prompt version;
  - the raw answer, the citations, token usage and the estimated cost;
  - the status (answered, refused, failed).
  - Recent questions are listed on the page.
- **Safety**:
  - the guide text is data, not instructions (system prompt);
  - permission `guides.ask` plus `document.read`;
  - restricted documents are never sent.
- **No key, no AI**: without `ANTHROPIC_API_KEY` the page says AI isn't set up. `AI_DRIVER=dev` is a labeled fake reader for tests, and it refuses to run in production.

## Definition of done
Tests cover (with the dev reader):
- carrier detection;
- guide selection (PDF only, current version, active, not restricted);
- the verdict is parsed and "not addressed" is never yes;
- citations are mapped to the right guide and page;
- the log row and its audit entry;
- permissions;
- refusals and failures are logged;
- no key means a clear message.

Plus a browser test. Real Claude calls are not part of the automated tests (they cost money). The first real run is checked by hand with Josh's key.

## Out of scope (later)
- AI-drafted appetite rules for approval (feeds the Market Finder).
- Questions across all carriers.
- OCR outside Claude (Claude reads scanned pages itself).
