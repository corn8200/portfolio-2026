---
title: "Stack opinions and taste"
slug: "stack-and-taste"
summary: "What I reach for, what I avoid, and why. Anti-hype, choose-boring-where-it-counts."
year: "2025"
status: "live"
order: 103
hidden: true
links: {}
---

## Default stack for new work

- **Python** for anything ops-adjacent, scripts, glue, ingestion, controllers. Type hints when the surface is wide enough to need them. FastAPI when an HTTP surface is needed.
- **Postgres** as the default state store. Schema discipline, real foreign keys, NOTIFY/LISTEN for event bus duties, pgvector for embeddings. SQLite for single-process, single-writer cases only.
- **Cloudflare Workers + Pages** for anything customer-facing or edge-relevant. The free tier is generous, the cold start is irrelevant, the deploy story is two minutes.
- **Astro** for content sites that need both SSR and static. **Next.js** for operator consoles where the team already knows React.
- **TypeScript** at the edges; Python at the core.
- **Anthropic Claude** for reasoning-heavy work; **OpenAI** for embeddings, voice, and where the cost curve favors it. The choice is per-call, not per-system.
- **MCP** as the integration surface for anything that needs to be reachable from Claude Desktop or ChatGPT connectors.

## What I avoid

- Frameworks that hide the request/response cycle. If I cannot describe what happens on a request without reading framework source, I do not want to operate it.
- "AI platforms" with proprietary prompt syntaxes, vendor-locked agent frameworks, or anything that tries to be the layer between me and the model. The model is the value; the abstraction is rent.
- Container orchestrators for systems that fit on one host. Kubernetes is a great answer to a question I do not have.
- Code generators with a maintenance burden bigger than the code they generate.
- Anything that requires a Discord server to learn.

## Where I will pay for boring

State stores. Auth. Observability. Backup. Drift detection. The unsexy infrastructure where failure is silent and recovery is hard.

## Where I will spend on the new thing

Reasoning models for hard problems. Voice and realtime APIs for human-facing channels. Edge compute where latency to humans actually matters.

## My version of "AI native"

The plant operator can ask the system a question in plain language and get an answer that cites the SCADA tag, the work order, the standard operating procedure, and the last three shift logs. The system is "AI native" because the operator does not have to know what's underneath. That is the bar. Everything else is for the team building the system, not the operator running the line.

## Anti-hype priors

I am skeptical of:

- Any framing where "the agent" is the deliverable. The deliverable is the work the agent does for someone.
- Demos that need a human in the prompt to look good.
- Benchmarks chosen after the model was selected.
- Vendor pitches that lead with the model name and the customer logo, not the operational outcome.
- "Multi-agent" as a marketing term divorced from the operational coordination problem it is supposed to solve.

I am bullish on:

- Boring infrastructure with one well-chosen model in the loop.
- Operator-facing systems where the AI is invisible to the user.
- Tight evaluation loops with a real human signing off on regressions.
- Cheaper, smaller models for routing and triage so the expensive ones get reserved for the calls that justify them.
- The Anthropic and OpenAI APIs both improving fast enough that today's stack will change again in twelve months.
