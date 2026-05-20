---
title: JOB-SNIPER
slug: job-sniper
summary: On-command autonomous job-application system with deterministic claim-diff gates and persona-locked tailoring.
stack: [Python, SQLite, Playwright, Claude Agent SDK, GPT-5 Codex]
year: 2026
status: blueprint
---

## What it is

A system that takes a discovery target and produces a real, submitted application — tailored resume, cover narrative, ATS answers, the lot — with a deterministic gate that refuses to ship anything that lies about dates, employers, certifications, clearance, degrees, or metrics. Designed out of a four-round Claude-vs-Codex debate on 2026-05-16.

## Discovery surface

- Greenhouse, Lever, Ashby, SmartRecruiters public JSON.
- USAJobs (federal-eligible vet preference applies).
- LinkedIn limited to single-URL lead-hops. **Not** building Easy Apply automation — ToS risk to the account is worse than the marginal volume.

## Claim-diff gate

Persona lanes (ops_leader, training_enablement, ai_data_ops, federal_ops) bound headline, summary, and emphasis. Everything underneath — dates, employers, certs, clearance, degrees, metrics — is locked. The CLI enforces this deterministically via `claim_diff`, not Claude judgment. Sixty-plus historical tailored resumes from the `Resume/` archive become golden regression fixtures.

## Build split

- **VS Code Claude (Mac, Opus 4.7)** — orchestration, selection prompts, cover narrative, outcome tagging.
- **Codex (Mac, GPT-5)** — CLI scaffold, migrations, ATS adapters, Playwright submitter, claim-diff gate, golden fixtures.
- VPS Claude — planning only; not on the build crew.

The build runs continuous-to-completion across both panes (no "Day 1 / Day 2" waterfall), with explicit human gates at the dangerous transitions.

## Safety posture

- `DRY_RUN` defaults true. Daily cap of 5 lifts to 10 after two clean cycles.
- Blocklist enforced at the source: Tamko, Owens Corning, GAF, CertainTeed, IKO, Malarkey, Atlas Roofing, BMI Group, Carlisle.
- Verification standard: HTTP 200 is not "submitted." Real-submit requires a screenshot or confirmation receipt before the row flips to `submitted`.
- Open consent items must be answered before Day 7 real-submit: comp floor, answers.yaml (clearance, salary, relocation, sponsorship, veteran), LinkedIn storageState, ATS storageStates, DRY_RUN→FALSE confirmation, blocklist additions.

## State

Blueprint shipped to `~/Projects/job-sniper/BLUEPRINT.md`. Build crew staged; Phase 1 will run continuous when activated.
