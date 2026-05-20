---
title: Overseer
slug: overseer
summary: Multi-host orchestrator for Claude and Codex panes, with a brain that proposes actions and a public MCP surface for ChatGPT and Claude web.
stack: [Python, Postgres, MCP, systemd, Tailscale, Cloudflare Tunnel, Claude Agent SDK]
year: 2026
status: production
links:
  public_mcp: https://mcp.sentryaithermal.com/mcp
---

## What it is

A single operator's command surface for running multiple LLM panes across a Mac and a VPS, with a remote brain that watches the event stream and proposes actions for human approval.

## How it works

The brain runs as a systemd timer on the VPS, ticking every 60 seconds. Each tick reads recent signals from a Postgres event store, asks Claude to emit zero or more decisions in a structured payload, and writes them back through an apply layer that derives idempotency keys from the `source_signal_id` of whatever triggered the thought. Restart-safe, double-fire-safe.

The MCP surface is split between a stdio server used by local Claude and Codex panes and an OAuth-gated HTTP server at `mcp.sentryaithermal.com` used by ChatGPT and Claude web. Both expose the same tools: `overseer_status`, `overseer_activity`, `overseer_recall`, `overseer_request`, `overseer_conversation`, `overseer_feedback`, `overseer_set_paused`, `overseer_approval_decide`, plus Sentinel mirrors. A persistent stdio bridge on the Mac (`mcp-bridge`, launchd-managed) proxies the HTTP surface so Claude Desktop sees it without re-authing on every reconnect.

## Reliability surface

- A 2-minute watchdog routes a Doctor-style briefing to a named tmux pane if the brain misses its tick window for more than 5 minutes. Dedupes to one briefing per 30 minutes while still stale.
- A sha256 integrity manifest pins every file under `/srv/overseer`. Any unsanctioned edit makes the brain refuse to tick until the operator runs `safe_deploy_finalize.sh` to rebuild and journal the deploy.
- A failstreak counter writes to `/var/lib/overseer/brain_consecutive_failures`; three consecutive parse failures pages a Pushover priority-1 alert with the failing payload preserved for forensics.
- 1Password secrets are prefetched at brain start so `apply_decisions.py` never calls `op` mid-tick.

## State

In production. Brain currently masked behind the OpJune budget gate until the 2026-06-15 cutover. Public MCP connector verified with both ChatGPT and Claude Desktop.
