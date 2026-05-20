---
title: Unified Task Engine
slug: ute
summary: Single canonical task queue across Mac and VPS. Replaces a small zoo of launchd, cron, systemd, and ad-hoc Python schedulers.
stack: [Python, SQLite, launchd, systemd, tmux]
year: 2026
status: production
links:
  cli: /Users/johncornelius/bin/backlog
---

## What it is

The work queue that lives between every agent, scheduler, and pane on both hosts. Everything recurring or deferred goes through one table; one CLI (`backlog`) reads and writes it; one scheduler arms the next run.

## Executors

A task row picks one of:

- **pane** — dispatched into a named tmux pane (Claude or Codex) via the cross-pane routing layer.
- **http_post** — fires a webhook.
- **launchd** / **systemd** — wraps the existing OS scheduler so a task can be a real LaunchAgent without duplicating config.
- **memory_write** — writes a memory file directly (used for proposal triage).
- **sync_all** — fan-out to multiple targets.
- **approval_gate** — pauses until an operator approval signal arrives.

## Recurring and sunset

`backlog add --schedule <rule>` accepts `hourly`, `daily`, `every <n>[s|m|h|d]`, or `interval:<n>...`. Minimum interval is 10 seconds. Sunset is explicit:

- `--until <ISO8601-UTC>` stops re-arming after the timestamp.
- `--max-runs <n>` stops after N successful runs.

Both sunset flags require `--schedule`. On natural stop the task ends `status="succeeded"` and emits a `task_sunset` audit event with `reason` ∈ `{max_runs, expired}`.

Recurring rows skip the preflight critic gate and land auto-claimable. One-off rows still need a preflight commitment file.

## Reliability stack

- Pause file at `~/.config/overseer-executor.pause` pauses the executor without `launchctl bootout`.
- Hold-email dedup state with a 24-hour window catches retry loops before they spam.
- Email-rate canary and iMessage liveness canary trip Pushover priority-1 if outbound goes silent or spammy.
- A pane-dispatch row that touches production opts in to `payload.manual_claim_only=true` so executor auto-claim cannot bypass approval.

## State

In production on both hosts. Drives the brain's apply path, the morning AI-update digest, league sync, calendar reminder auto-roll, and most other recurring work. Scheduler EMFILE bug from the file-descriptor leak was resolved 2026-05-15.
