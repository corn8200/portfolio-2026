---
title: "How I work with AI agents day to day"
slug: "multi-agent-workflow"
summary: "Concrete description of my daily workflow running multiple Claude and Codex agent panes coordinating with an Overseer brain."
year: "2025 — present"
status: "live"
order: 102
hidden: true
links: {}
---

## The setup

A tmux session on a Mac mini and a parallel session on a VPS. Each pane is a long-running Claude Code or OpenAI Codex CLI process scoped to a specific role — chief-of-staff for personal-life surfaces, decision lead for Plaud voice-recording packets, command-router voice front-end, planning panes, build panes. An Overseer brain on the VPS reads events from a Postgres event bus and decides what to dispatch to which pane. Approvals route through a single one-tap channel.

This is not a tech demo. It is the operating layer I run my life on.

## Why this matters for a senior operator role

The same patterns I built into this personal system are the patterns I would build into an industrial AI rollout — clear intake, controlled execution, measurable state, recovery paths when something breaks. The difference is scale and the consequences of failure, not the architecture.

## What runs in production today

- **Brain** — decides which pane gets which job. Reads Postgres NOTIFY events; no polling.
- **Gateway** — FastAPI control plane that fronts everything. One auth boundary, one audit log.
- **Remote MCP server** — exposes the system to Claude Desktop and ChatGPT custom connectors over MCP, with OAuth, so the same tool surface is reachable from any client.
- **Memory** — pgvector store with about 17,500 durable rules and facts, with daily triage by a smaller model and auto-commit of curated memory to a private GitHub repo every 30 minutes so all three hosts share the same context.
- **Commitment promoter** — anything I say in voice or iMessage that sounds like a commitment becomes a tracked task with a deadline. The system chases me at the deadline.
- **Personal chief-of-staff bridge** — cross-checks calendar, iMessage, email, and recent voice transcripts before any "meeting in twenty minutes" push, so a colleague sick-day does not produce a ghost-meeting notification.
- **Proposed-action executor** — anything the brain wants to do that touches production, money, or other people sits in an approval inbox until I tap to approve.
- **Audit tail** — every decision the brain makes is written to an event log that off-host watches mirror, so a single host can be wiped and the audit history survives.

## What it does autonomously

Maintains the task queue. Reminds me at deadlines. Captures voice recordings and converts them into either actions, knowledge, or noise. Suppresses stale calendar pushes. Maintains shared memory across hosts and sessions. Notifies on hazards from a separate weather and ops pipeline. Routes approvals to my phone with a single-tap accept or deny.

## What it does NOT do without approval

Send mail to anyone but me. Spend money. Restart production services. Push to remote git. Rotate credentials. Touch any system outside its own envelope. Every one of those goes through the proposed-action queue.

## Why I built it

The assistant I needed to run my life did not exist. The ones that did were either single-prompt chat windows that lost state at every refresh or commercial agent products that wanted me to live inside their UI. I wanted the agents in my real workflows — iMessage, Pushover, the same terminal panes I already lived in. So I built that layer.

## What I learned from running it

- Event-driven architecture beats polling for everything that involves a human.
- One-tap approval is the only approval pattern that survives daily use.
- Audit logs are not optional; they are the only thing that lets you trust the system after an unattended week.
- A shared memory store with curation discipline is worth more than any single model upgrade.
- Smaller, cheaper models are the right call for triage, classification, and routing; reserve the expensive ones for the decisions that justify the cost.

This is the operating posture I bring to industrial AI. The same architecture works for the same reasons.
