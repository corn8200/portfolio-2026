---
title: ChatGPT Codex Bridge
slug: codex-bridge
summary: HTTP MCP bridge that lets ChatGPT and Claude web call into a private Codex and Overseer surface without exposing path tokens.
stack: [Python, MCP, OAuth, Cloudflare Tunnel, Tailscale, 1Password]
year: 2026
status: production
---

## What it is

A single MCP server that answers from two trust zones. ChatGPT (or Claude web) hits the public URL behind an OAuth flow; the local Codex pane hits the same surface over a private Tailscale lane with a non-secret path. Same tools, two auth shapes.

## Architecture

- Source repo: `~/Projects/chatgpt-codex-bridge-mcp`. VPS deploy: `/srv/apps/chatgpt-codex-bridge-mcp`.
- Public surface: `mcp.sentryaithermal.com/mcp`, OAuth-gated. The owner-consent password lives only in 1Password (`MachineAutoBiz/ChatGPT Codex Bridge OAuth`) and is never logged or echoed into env files.
- Private surface: Tailscale lane on a non-secret path `/codex-share/codex-local`. Used by local panes and tooling.
- The `print-bridge-urls.sh` helper knows the difference between "public" and "local" so I never paste the wrong URL into ChatGPT.

## What it talks to

The bridge proxies the Overseer brain MCP plus Sentinel mirror tools. Persistent stdio proxy on the Mac (`mcp-bridge`, launchd-managed at `net.jcornelius.mcp-bridge`) gives Claude Desktop a stable local endpoint at `127.0.0.1:8769/mcp` so reconnects do not re-auth every time.

## Operational notes

- Cloudflare aliases `cp.jcornelius.net/mcp/overseer` and `app.jcornelius.net/mcp/overseer` point at the same VPS `overseer-remote-mcp.service` on `127.0.0.1:8769`. Canonical URL is the `mcp.sentryaithermal.com` one.
- ChatGPT and Claude web caches are sticky — when a tool list goes stale, the right move is to clear the connector cache and reconnect, not to add a duplicate URL.
- Authenticated `list_tools` smoke test verifies post-deploy.

## State

In production. Used daily from ChatGPT and Claude Desktop. Surface currently exposes ten tools: five read-only plus five write/delete, including the Sentinel mirrors.
