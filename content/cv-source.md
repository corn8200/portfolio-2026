<!--
Positioning defense: John's pattern across the last year is shipping
multi-component systems where the interesting work lives between
the components — message bus, memory layer, approval gates, orchestration.
"Operator" is closer to the truth than "engineer" or "founder", but the
work is hands-on enough that "systems builder" carries it. Headline lands on
"builds operator-grade systems" because every project here exists to give
one human leverage over many concurrent agents and processes.
-->

# John Cornelius

## Builds operator-grade systems for one human and many agents

I design and ship the orchestration, memory, and approval layers that let a single operator run a fleet of LLM-driven agents without losing the thread.

## About

Most of what I build sits between things. A brain that reads signals from email, iMessage, calendars, and a dozen telemetry streams, then proposes actions for a human to approve. A task engine that holds the canonical queue across hosts so cron, launchd, and systemd stop fighting. A pgvector-backed memory pipeline that keeps a Mac, a VPS, and a phone in agreement about what was decided last week. A bridge that lets ChatGPT talk to my private MCP surface over an OAuth flow without leaking the path token into logs.

The work is mostly Python and TypeScript, mostly on a Mac talking to a Linux VPS over Tailscale and SSH, mostly with Claude and GPT-5 panes running in tmux as co-builders. I default to parallel sub-agents on the planning surface and reserve persistent panes for cross-host or named-identity work. I run builds to completion rather than into phased waterfalls, gate the things that actually need gating, and verify at the user-observable layer instead of the SMTP-250 layer.

I prefer to install the missing tool instead of writing the caveat. I delete legacy on sight instead of grandfathering it. I name architectural gaps in the same message I file the manual fix, because a manual fix without a follow-up is just a slow leak.

The day job is operations: training and enablement, federal-eligible vet background, real money moved at Tamko. The night work is everything below.

## Projects

### Overseer

A multi-host orchestrator for Claude and Codex panes, with a brain that proposes actions and a public MCP surface for ChatGPT and Claude web.

- VPS-hosted "brain" ticks every 60 seconds, reads signals out of a Postgres event store, and emits proposals that I approve or deny by MCP call. Idempotency keys are derived from `source_signal_id` so a brain restart cannot double-fire.
- Liveness watchdog plus integrity manifest: a sha256 manifest pinned to `/srv/overseer` plus a 2-minute watchdog that routes a Doctor-style briefing to a named tmux pane if the brain misses its tick window.
- Public connector at `mcp.sentryaithermal.com/mcp` running an OAuth-gated MCP server with ten tools (status, recall, request, conversation, approval, plus Sentinel mirrors). Persistent stdio bridge so Claude Desktop can talk to it without re-auth.
- Gateway + web split (`overseer-gateway`, `overseer-web`) with stripped-portal mode for production and an Atlas dashboard behind a flag.

State: in production, with the brain currently masked behind the OpJune budget gate until the 2026-06-15 cutover.

### OpJune

A budget gate, raw-caller deny shim, and capability layer that lets me hand the brain real money without losing the kill switch.

- Seven PRs shipped on `/srv/overseer` between PR1 and PR8: budget ledger, raw-call CI scanner, cache shape and session resume, subagent and filesystem agents, AskUserQuestion plus defer queue, brain canary in shadow mode, and a billing canary with Batch API wrapper.
- 365 cumulative tests across the eight PRs. Scanner catches wrapper imports, not just literal raw call patterns.
- Egress chokepoint via nftables plus a Unix-domain-socket broker, with the operator UID explicitly allowlisted so Mac and VPS panes can hit Anthropic but rogue processes cannot.
- Self-serve operator commands for enforce flip, rollback with ledger preservation, and deploy-finalize that rebuilds the integrity manifest.

State: build complete 2026-05-14. Brain still masked, enforce flag fail-closed. Cutover runbook ready for 2026-06-15.

### Unified Task Engine (UTE)

A single canonical task queue across Mac and VPS. Replaces a small zoo of launchd, cron, systemd, and ad-hoc Python schedulers.

- One SQLite-backed task table with executors for tmux panes, HTTP POST, launchd jobs, systemd units, memory writes, and approval gates.
- Recurring tasks via `--schedule`, with sunset via `--until` and `--max-runs`, ten-second minimum interval, audit events on natural stop.
- Preflight critic gate on one-off rows; recurring rows skip preflight and land auto-claimable. Pane-dispatch rows that touch production opt in to manual claim so they cannot bypass approval.
- Orphan reset recipe and an executor reliability stack (rate canary, iMessage liveness canary, pause file) shaped by a real outage.

State: live. Drives the brain's apply path, the morning AI-update digest, the league sync, and most other recurring work on both hosts.

### ChatGPT Codex Bridge

An HTTP MCP bridge that lets ChatGPT (or Claude) call into my private Codex and Overseer surface without exposing path tokens.

- Public OAuth-gated bridge at `mcp.sentryaithermal.com` resolves credentials at request time from a 1Password service account, never echoing path tokens into env files or logs.
- Private Tailscale lane uses a non-secret path for the local Codex pane while the public lane is fully token-gated, so the same MCP surface answers from two trust zones with different auth shapes.
- Deployed on the VPS at `/srv/apps/chatgpt-codex-bridge-mcp` with a printer helper that knows the difference between "public URL" and "local URL" so I never copy the wrong one into ChatGPT.

State: live. Used daily from ChatGPT and Claude Desktop.

### Memory Pipeline v2

A two-hook capture layer and pgvector store that gives every Claude session durable memory and cross-host recall.

- Stop and SessionEnd hooks both fire `claude-session-receipt.py` and `knowledge-harvester.py`. Harvester widens its regex past "remember/never/always" into imperative voice ("stop doing X", "X is broken", "use X not Y"). Hit rate moved from ~2% to ~38% on real sessions.
- VPS Postgres table `overseer.memory_embeddings` holds vectors from `text-embedding-3-small` with an HNSW cosine index. `overseer_recall` MCP tool serves the search surface; falls back to lexical ILIKE when an OpenAI key is missing from the calling service env.
- Two LaunchAgents close the loop: `memory-triage` runs Anthropic Haiku once a day to promote, archive, or reject proposals in `_proposed/`; `memory-autocommit` pushes the memory directory to GitHub every thirty minutes for Mac/VPS/phone convergence.

State: live. Around 2,800 rows growing ~50/day.

### Atlas

A live registry and graph of every component, host, schedule, queue, and data store I own.

- Components, hosts, services, and freshness collectors live in a Postgres `atlasdb`, with a loader on a systemd timer that ingests YAML registries from `/Users/johncornelius/atlas/`.
- Gateway endpoints expose hosts, services, graph, and freshness as JSON. Last live test: 4 hosts, 113 services, 117 nodes, 177 edges, 9 collectors.
- Mac-side hourly snapshot pushes via a LaunchAgent that pulls the gateway bearer from 1Password at runtime so the token is never on disk.
- An `LLM_ENTRYPOINT.md` is the first thing any agent reads when asked "what owns this?" or "what depends on this?"

State: live. The visual frontend is gated behind a portal flag pending UI polish.

### JOB-SNIPER

An on-command autonomous job-application system, planned out of a four-round Claude-vs-Codex debate.

- Discovery off Greenhouse, Lever, Ashby, SmartRecruiters public JSON plus USAJobs; LinkedIn limited to single-URL lead-hops because the ToS risk on Easy Apply automation is worse than the marginal volume gained.
- Persona lanes bound headline and emphasis, but dates, employers, certifications, clearance, degrees, and metrics are locked under a deterministic `claim_diff` gate. Resume tailoring does not get to invent facts.
- Build split is explicit: Opus 4.7 does orchestration and selection prompts, GPT-5 Codex does CLI scaffold, ATS adapters, Playwright submitter, and golden fixtures. Sixty-plus historical tailored resumes become regression cases.
- `DRY_RUN` defaults true; daily cap of five lifts to ten only after two clean cycles, and only after I sign off on the comp floor and answers.yaml.

State: blueprint shipped 2026-05-16 at `~/Projects/job-sniper/BLUEPRINT.md`. Build crew is staged; Phase 1 will run continuous-to-completion across both panes.

### Sentinel and sentryaithermal

`sentryaithermal.com` is the business surface; Sentinel is the scraping and automation toolkit underneath.

- Sentinel is CLI plus Python library plus Claude Code skill. Three verbs: `pull` for read-only scrape, `act` for form submission and multi-step automation, `watch` for explicit "did this change since last run" diffs. No continuous daemon by design.
- Operator owns the recipe, the data, the cost ledger, and the LLM logic. Commodity proxy and captcha pools, no vendor lock-in.
- Outbound mail for `info@sentryaithermal.com` runs through Resend (not Gmail SMTP) with a non-default `User-Agent` to clear Cloudflare's default-`Python-urllib` block. The communication skill abstracts the transport.

State: Sentinel rewrite is mid-build to retire the old sentinel-daemon. Sentryaithermal email and approval-queue paths are live.

## Stack

- **Languages:** Python (3.11+), TypeScript, Bash, SQL.
- **Runtimes and frameworks:** Claude Agent SDK, MCP (stdio and HTTP), Next.js, FastAPI, Playwright, AppleScript and EventKit for Mac OS integration.
- **Infra and ops:** Tailscale, systemd, launchd, nftables, Cloudflare Tunnel, 1Password service accounts for headless secret access, GitHub Actions.
- **AI surface:** Anthropic API (Sonnet, Opus, Haiku 4-5), OpenAI embeddings, GPT-5 via Codex, prompt caching, Files API, Batch API, custom subagents and skills.
- **Data:** Postgres with pgvector, SQLite, JSONL event logs, redacted session receipts.
- **Frontend (when it matters):** Next.js App Router, server components, minimal client JS.

## Operating principles

- Parallel agents by default. Independent subparts get one message with multiple Agent calls, not a sequential chain pretending to be a chain.
- Verify end-to-end at the user-observable layer. SMTP 250 is not delivery. HTTP 200 is not a side effect. Exit 0 is not correct output. Read it back from the resource.
- Install the missing tool instead of shipping the caveat. A docs note that says "X is not installed" teaches the next agent to pick the wrong path.
- No backwards-compatibility shims when changing the callers is cheaper. Comments are opt-in, not default — write the why, never the what.
- Surface architectural gaps in the same message as the manual fix. A SQL reset without a follow-up is a slow leak.
- Run to completion, not phases. "Day 1, Day 2, Day 3" is a waterfall in disguise. The shape is parallel streams that converge at explicit gates.
- Quality over completeness. A half-shipped feature with a real test surface beats four feature stubs.
- Approval holds are explicit and small: destructive ops, prod deploys, credential rotation, real spending, third-party outbound. Everything else moves.

## Currently into

May 2026: shipping the OpJune cutover for 2026-06-15 (brain unmask under budget gate, raw-caller deny, billing canary live). Building JOB-SNIPER continuous-to-completion across two panes. Maturing the voice and calendar automation layer so iMessage and Apple Calendar stop being a punt for any agent that touches them.

## Contact

- Email: corn82@icloud.com
- GitHub: [corn8200](https://github.com/corn8200)
- Business surface: sentryaithermal.com
