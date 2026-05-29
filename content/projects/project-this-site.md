---
title: "Operator AI System — Overseer Stack"
slug: "operator-ai-system"
summary: "A personal command system that routes voice and iMessage requests, dispatches Mac/VPS agents, tracks approvals, and keeps an audit trail."
stack: ["Voice + iMessage intake", "Task queue", "MCP bridges", "Agent dispatch", "Audit trail"]
year: "2026"
status: "live"
order: 4
links: {}
---

## The operating problem

AI work gets fragile when it lives in one chat window. Real operations need intake, routing, state, approvals, logs, and a way to hand work between people and agents without losing the thread.

That is what the Overseer stack is for.

## What it does today

- Accepts trusted voice and iMessage requests, turns them into command-center jobs, and records a receipt.
- Dispatches work to Claude and Codex panes on the Mac or VPS, then watches for completion, failure, or pending approvals.
- Keeps shared task, memory, health, heartbeat, and audit context available to the next agent instead of burying it in a chat transcript.
- Separates operator approval from execution so the system can move quickly without sending messages, spending money, or touching production by accident.

## Architecture at a glance

```text
voice / iMessage / web request
        |
        v
Overseer intake -> command jobs -> approvals -> Mac + VPS agent panes
        |               |              |
        v               v              v
memory + task state   receipts       health / audit trail
```

## Why it belongs on a CV

The same failure modes show up in manufacturing AI: unclear handoffs, no audit trail, weak approval gates, and tooling that works only while the builder is watching it. This system is a small, personal version of the operating layer I like building around AI: clear intake, controlled execution, measurable state, and recovery paths when something breaks.
