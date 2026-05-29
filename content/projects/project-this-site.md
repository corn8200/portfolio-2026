---
title: "Overseer Personal Ops Control Plane"
slug: "overseer-control-plane"
summary: "A Mac/VPS command bus for Claude, Codex, Cockpit, memory, approvals, and live operator data. It turns agent work into inspected, gated, receipted operations."
stack: ["FastAPI", "Next.js", "SQLite/Postgres", "MCP", "tmux", "Tailscale"]
year: "2026"
status: "live"
order: 5
links: { repo: "https://github.com/corn8200/overseer-gateway" }
---

## What it is

Overseer is the personal operations layer I run every day: a command bus, approval gate, memory path, and Cockpit surface for coordinating Claude, Codex, local tools, and live personal data across a Mac and a VPS.

![Cockpit UI showing calendar, reminders, queue, and actions](/images/cockpit-overseer.png)

## Architecture sketch

Operator -> Cockpit -> Command bus -> Overseer gateway -> Claude/Codex panes -> critic/receipt -> memory.

The important part is not that agents can do work. The important part is that the work is routed, reviewed, gated, and receipted. A restart, deploy, outbound message, or secret mutation takes a different path than a read-only inspection or repo patch.

## What it does autonomously today

- Converts operator requests into bounded execution packets with owner, scope, acceptance criteria, and verification requirements.
- Routes blockers through Overseer first, keeping John out of routine approval loops while still holding production actions behind explicit gates.
- Captures compact receipts into memory so future agents inherit the result, not a raw transcript dump.
- Keeps Cockpit current with calendar, reminders, queue state, messages, health, and action buttons from live personal data.

## Why it matters

This is the same operating problem as manufacturing AI: the model is only useful when the surrounding workflow makes the output trusted, observable, and reversible. Overseer is my home-system version of that pattern.
