---
title: "Overseer — Personal AI ops layer"
slug: "overseer-control-plane"
summary: "Multi-agent runtime across a VPS and a Mac: ten production services over Postgres LISTEN/NOTIFY, a public MCP for Claude and ChatGPT, ~17.5K durable memories, and ~65 proposed actions a week under one-tap approval."
stack: ["Postgres LISTEN/NOTIFY", "MCP", "Claude/Codex", "Cockpit", "systemd", "Tailscale"]
year: "2025 — present"
status: "live"
order: 5
links: { repo: "https://github.com/corn8200/overseer-gateway" }
---

## What it is

Overseer is the personal AI ops layer I built and run across a VPS and a Mac: a Command bus, approval gate, memory path, Cockpit surface, and remote MCP at `mcp.sentryaithermal.com` that Claude and ChatGPT connectors call into.

![Cockpit UI showing calendar, reminders, queue, and actions](/images/cockpit-overseer.png)

Ten production services coordinate over Postgres LISTEN/NOTIFY: a brain that decides, a gateway on `:8768`, a remote MCP, a commitment promoter, and an action executor gated by one-tap approval. It carries ~17.5K durable memories in a vector store and generates ~65 proposed actions a week.

## Three things it does without me asking

- Commitments I make in iMessage or voice become tracked tasks with deadlines; it chases me at the deadline.
- Before any "meeting in 20 minutes" calendar push, it scans iMessage, mail, and recent voice transcripts for a sick-day or reschedule signal; it caught a ghost meeting on a colleague's sick day.
- Every Claude and Codex session writes durable rules to the same store, triaged daily by a smaller model, auto-committed to GitHub every 30 minutes. Sessions on a new host inherit context without me retyping.

## Why it matters

This is the same operating problem as manufacturing AI: the model is only useful when the surrounding workflow makes the output trusted, observable, and reversible. Overseer is my home-system version of that pattern.
