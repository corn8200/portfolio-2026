---
title: "What kills AI rollouts in industry"
slug: "ai-rollout-failure-modes"
summary: "The recurring failure modes I see in industrial AI projects, and what I do about each."
year: "2025"
status: "live"
order: 101
hidden: true
links: {}
---

## Failure mode 1 — The dashboard that became the deliverable

A team instruments the process, builds a beautiful dashboard, and ships. Six months later nobody looks at it. The dashboard never closed a loop. It informed; it did not act.

What I do: every deliverable has to either change a setpoint, change a procedure, or change an alarm. If it only changes a screen, it is a research artifact, not an operations rollout.

## Failure mode 2 — The model that works at the bench

The model converges on cleaned historical data. It then fails the first time the line is in a real abnormal state — startup, shutdown, raw material variation, a sensor drift the team did not anticipate. Trust evaporates and the rollout is dead.

What I do: deliberately mine the historical data for abnormal regimes and require the model to behave acceptably across all of them before any plant trial. Pair every model with a guard that detects out-of-distribution input and falls back to the operator-known-good control profile.

## Failure mode 3 — The recommendation that nobody acts on

The model produces an output. The operator has to interpret it, decide whether to trust it, and translate it into a setpoint change. The operator is already running the line; the cognitive load is too high. The recommendations get ignored.

What I do: close the loop wherever the regulatory and safety envelope allows. Make the model's output a setpoint, not a suggestion. Where closure is not yet possible, redesign the operator's display so the action is a single click with the rationale already attached.

## Failure mode 4 — The rollout that worked in plant A and died in plant B

The pattern was real but the implementation was specific. The team copies the model; the data pipeline, the operator procedures, the alarm thresholds — those are different at the next plant. The rollout looks like a flop.

What I do: ship a playbook, not a deliverable. The playbook says: this is the instrumentation, this is the operator procedure, this is the control envelope, this is the drift metric, this is the escalation path. The model is the easy part.

## Failure mode 5 — Drift detection that wasn't

The model was deployed. Nobody put a watcher on its behavior. It drifts. By the time someone notices, the operators have already stopped trusting it and are running the line manually again. You can never get that trust back without a credible reset.

What I do: drift detection runs as a service from day one. When it triggers, somebody gets paged the same shift, not the next quarterly review.

## Failure mode 6 — The "AI strategy" that wasn't operational

Leadership commits to an AI roadmap that is a list of model classes, vendor evaluations, and platform decisions. The roadmap has no plant in it. Two years pass. There is nothing in production.

What I do: every strategy conversation has to come back to one plant, one process, one named operator who is going to use the thing. If we cannot draw that line, we are not ready to spend money on AI yet.

## Why this matters for hiring me

I am not interested in being the head of an AI lab. I am interested in being the operator who makes AI work where it has not worked before. The failure modes above are most of what stands between "we deployed AI" and "AI is actually running this process."
