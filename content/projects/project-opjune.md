---
title: OpJune
slug: opjune
summary: Budget gate, raw-caller deny shim, and capability layer that lets the Overseer brain hold real money without losing the kill switch.
stack: [Python, nftables, systemd, Anthropic API, Batch API, Claude Agent SDK]
year: 2026
status: build-complete
links:
  runbook: claude-config/docs/OpJune-Jun15-Runbook.md
---

## What it is

The protection layer wrapped around the Overseer brain so I can hand it API credit on 2026-06-15 without giving it the ability to torch my account. Budget ledger, egress chokepoint, raw-call deny, plus the capability uplift (subagents, citations, Files API, Batch API wrapper) that the brain actually wants.

## What shipped

Seven PRs landed on `/srv/overseer` between PR1 and PR8 (PR3 retired into PR1):

- **PR1** — budget gate, raw caller deny, egress chokepoint, dashboard CLI, ledger schema migration, rollback script.
- **PR2** — raw-call CI scanner and feature plumbing. Scanner catches wrapper imports (`core.mac_sdk.query`), not just literal raw patterns.
- **PR4** — cache shape, session resume, transcript archive.
- **PR5** — subagent and filesystem agents.
- **PR6** — Notification, AskUserQuestion, defer queue.
- **PR7** — event-driven brain canary in shadow mode.
- **PR8** — drills, bounded billing canary, Batch API wrapper, Jun-15 runbook.

365 cumulative tests across the eight PRs. No real Anthropic calls were made at any point in the build phase.

## Architecture

The egress chokepoint is the load-bearing piece. A Unix-domain-socket broker plus nftables rules ensure that nothing reaches `api.anthropic.com` except through `claude_call()`, which writes to the ledger before the network call. The scanner runs in CI and locally to catch any code path that tries to bypass the broker — including wrapper imports that resolve to raw calls deeper in the stack.

Enforce flag is currently fail-closed (`enforce=false` until 2026-06-15) because the VPS broker has no clean Max-OAuth auth path for pre-cutover validation. Post-cutover the broker uses an API key against the credit pool — clean model.

## Self-serve commands

```
sudo /srv/overseer/bin/opjune-enable-enforce
sudo /srv/overseer/bin/opjune-disable-enforce
sudo /srv/overseer/bin/opjune-pr1-rollback-safe --preserve-ledger --keep-brain-masked
```

## State

Build complete 2026-05-14. Brain still masked, enforce flag fail-closed, all canary units present-but-disabled. Cutover runbook ready: 8 steps from pre-flight to gated brain unmask, with a dress-rehearsal dry-run that verifies all referenced artifacts exist.
