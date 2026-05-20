---
title: Atlas
slug: atlas
summary: Live registry and graph of every component, host, service, schedule, queue, and data store across the stack.
stack: [Python, Postgres, YAML, systemd, LaunchAgents, Next.js]
year: 2026
status: backend-live
---

## What it is

The "what owns this and what depends on it" map for the whole environment. Components, hosts, services, freshness collectors, and topology edges live as YAML in `/Users/johncornelius/atlas/`, get loaded into Postgres, and surface through gateway endpoints and a visual graph.

## Schema and ingest

- `atlasdb` on the VPS Postgres holds the canonical state.
- `atlas_loader.py` runs on `atlas-loader.service` + `atlas-loader.timer` (hourly), reads the YAML registries, and upserts to Postgres.
- Mac-side `com.john.atlas-local-refresh` LaunchAgent refreshes the local inventory and pushes a snapshot to the gateway's ingest endpoint. The wrapper pulls `ATLAS_INGEST_TOKEN` from 1Password at runtime via the service-account token, so the bearer is never on disk.

## API surface

Gateway endpoints under `/api/infra/atlas/`:

- `hosts` — 4 hosts, last live test.
- `services` — 113 services.
- `graph` — 117 nodes, 177 edges with `class=fs` (filesystem tree) and `class=flow` (architecture / topology) layers.
- `freshness` — 9 collectors with last-run timestamps.

## Entry point

Every agent that touches infrastructure reads `/Users/johncornelius/atlas/LLM_ENTRYPOINT.md` first. It documents the fast-triage paths ("what is broken" → `state/CURRENT.md`, `docs/DIAGNOSTICS.md`; "refactor X" → `docs/REFACTOR_MAP.md`, `registries/components.yaml`) and lists the known roots.

## State

Backend live since 2026-05-12. The visual frontend is gated behind a portal flag pending UI polish. Mac→VPS push wiring was finalized 2026-05-14 after a stale bearer token caused a week of silent 401s on the ingest path.
