---
title: "Overseer — Personal AI ops layer"
slug: "overseer-control-plane"
summary: "Multi-agent runtime across a VPS and a Mac: 10 production systemd services over Postgres LISTEN/NOTIFY, a public MCP for Claude and ChatGPT, ~17.5K durable memories, and ~65 proposed actions a week under one-tap approval."
year: "2025 — present"
status: "live"
order: 5
links: { repo: "https://github.com/corn8200/overseer-gateway" }
---

## What it is

Overseer is the personal AI ops layer I built and run across a VPS and a Mac: a Command bus, approval gate, memory path, Cockpit surface, and remote MCP at `mcp.sentryaithermal.com` that Claude and ChatGPT connectors call into.

![Cockpit UI showing calendar, reminders, queue, and actions](/images/cockpit-overseer.png)

Ten production systemd services coordinate over Postgres LISTEN/NOTIFY: a brain that decides, a gateway on `:8768`, a remote MCP, a commitment promoter, and an action executor gated by one-tap approval. It carries ~17.5K durable memories in `overseer.memory_embeddings` (pgvector) and generated ~65 proposed actions in the last 7 days.

## Three things it does without me asking

- Commitments I make in iMessage or voice become tracked tasks with deadlines; it chases me at the deadline.
- Before any meeting-in-N-minutes push, it cross-checks iMessage, mail, and recent voice transcripts for a sick-day or reschedule signal; it caught a stale meeting on a colleague sick-day last week.
- Every Claude and Codex session writes durable rules to the same store, triaged daily by a smaller model, auto-committed to GitHub every 30 minutes. Sessions on a new host inherit context without me retyping.
