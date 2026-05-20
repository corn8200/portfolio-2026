---
title: Memory Pipeline v2
slug: memory-pipeline
summary: Two-hook capture layer plus a pgvector store that gives every Claude session durable memory and cross-host recall.
stack: [Python, Postgres, pgvector, OpenAI embeddings, Anthropic Haiku, LaunchAgents, SSH]
year: 2026
status: production
---

## What it is

The piece that makes "remember that" actually stick across Claude sessions, Codex panes, ChatGPT connectors, and a phone — without me having to write to a memory file by hand.

## Write path

Stop and SessionEnd hooks both fire two scripts. `claude-session-receipt.py` appends a compact redacted receipt to `memory/reference_claude_ops_memory.md` and `memory/claude_activity_journal.md`, filtering `tool_result` rows out of "user prompt" extraction so the journal doesn't drown in tool noise. `knowledge-harvester.py` matches against two regexes:

- **DURABLE_RE** — explicit memory verbs: remember, from now on, always, never, preference, prefer, correction, actually, prime directive, standing rule.
- **OPERATIVE_RE** — imperative voice: stop doing X, don't ever Y, going forward, the rule is, canonical, use X not Y, fix X, why is X, X is broken, X never works.

Hit rate went from ~2% to ~38% on real sessions after the OPERATIVE_RE widening.

The harvester pipes JSONL to the VPS over SSH and lands in Postgres table `overseer.memory_embeddings` with vectors from `text-embedding-3-small` and an HNSW cosine index. Around 2,800 rows live, growing ~50/day.

## Read path

`overseer_recall` MCP tool queries pgvector via `memory_embeddings.search()`. Lexical-ILIKE fallback when the calling service env is missing an `OPENAI_API_KEY` (the public MCP server runs without one). The built-in `MEMORY.md` auto-load surface stays the highest-trust layer for rules; pgvector is for "I know there's a memory about X but I don't remember which file."

## Autonomy

Two LaunchAgents close the loop:

- **`com.john.memory-triage`** — daily 09:00. Reads `memory/_proposed/` items older than 24h. Calls Anthropic Haiku (`claude-haiku-4-5-20251001`) via curl with the service-account API key from 1Password. Promotes, archives, or rejects via `git mv` + `MEMORY.md` updates. Hard caps: 5 reviewed, 3 promoted per run.
- **`com.john.memory-autocommit`** — every 30 min. Scope-locked to `memory/` only: `git fetch && add memory/ && commit && pull --rebase && push`. Leaves other dirty files alone. Mac, VPS, and phone converge on the same memory state through GitHub.

Every hook run audit-logs to `~/Library/Logs/claude-memory-hooks.jsonl`. Cursors at `~/.claude/logs/.claude-session-receipt-cursor.json` and `~/.claude/state/harvester-cursor.<session>.txt` prevent double-capture.

## State

Live. Drives durable memory for every Claude session and Codex pane across Mac and VPS. Cross-host sync via GitHub auto-push runs every 30 minutes.
