# TIG Carrier Intelligence — Claude Code Handoff

This is a **development blueprint**, not a completed application. It is scoped exclusively to P&C insurance and related specialty/surety markets. Life, health, employee benefits, disability and LTC are excluded.

## Files
- `CLAUDE.md`: instructions Claude Code should follow automatically when opened at project root.
- `PRD.md`: business scope, screens, user roles, workflows and priorities.
- `DATA_MODEL.md`: relational schema design, constraints, relationships and data handling.
- `IMPLEMENTATION_PLAN.md`: ordered milestones, API baseline, project structure.
- `ACCEPTANCE_TESTS.md`: testable definition of done.

## Use with Claude Code
1. Unzip this folder into a new project directory.
2. Open a terminal in that directory and run `claude` (with Claude Code installed and authenticated).
3. Paste: `Read CLAUDE.md and all referenced specification files. Start with Milestone 0 and Milestone 1 only. First show your implementation plan and any blocking questions. Do not fabricate TIG data. After implementation, run migrations and tests and report results.`
4. Review the proposed architecture and open decisions before authorizing production integrations or real data imports.

## Caveats
The stack and targets are recommendations, not verified TIG infrastructure decisions. Appointments, commission agreements, regulatory obligations, AMS integration, identity provider, hosting, data retention and data migration need stakeholder confirmation. No actual carrier data is included.
