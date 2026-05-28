---
title: "Overseer — Personal AI ops layer"
slug: "operator-ai-system"
summary: "Multi-agent runtime I run across a Mac and a VPS. Ten production services, ~17.5K durable memories, ~65 proposed actions a week under one-tap approval."
year: "2025 — present"
status: "live"
order: 4
links: {}
---

Multi-agent runtime I built and run across a VPS and a Mac. Ten production services coordinating over Postgres LISTEN/NOTIFY: a brain that decides, a gateway on `:8768`, a remote MCP at `mcp.sentryaithermal.com` that Claude and ChatGPT connectors call into, a commitment promoter, an action executor gated by one-tap approval. ~17,500 durable memories in a vector store. ~65 proposed actions a week.

## Three things it does without me asking

- Commitments I make in iMessage or voice become tracked tasks with deadlines; the system chases me at the deadline.
- Before any "meeting in 20 minutes" calendar push, it scans iMessage, mail, and recent voice transcripts for a sick-day or reschedule signal — caught a stale meeting on a colleague sick-day last week.
- Every Claude and Codex session writes durable rules to the same store, triaged daily by a smaller model, auto-committed to GitHub every 30 minutes. Sessions on a new host inherit context without me retyping.

## How it is built

Postgres for shared state and event bus. FastAPI gateway. A Next.js operator console at `cp.jcornelius.net`. A remote MCP server that Claude Desktop and ChatGPT custom connectors authenticate against. Approvals are one-tap from Pushover, the operator console, or a connector call. Nothing in the proposed-action queue executes without that gate.
