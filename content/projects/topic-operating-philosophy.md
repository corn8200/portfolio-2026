---
title: "Operating philosophy"
slug: "operating-philosophy"
summary: "How I think about deploying AI into operational environments — the cockpit-to-plant-floor principle in long form."
year: "2025"
status: "live"
order: 100
hidden: true
links: {}
---

## The principle

Standardize the work. Train the standard. Evaluate against the standard. Then improve the standard. Continuously. Everything else is decoration.

I learned this in Army aviation — flying rotary-wing platforms across multiple theaters with a Standardization Instructor Pilot qualification, which is the rating where your signature puts other pilots in the air. It transferred directly to manufacturing. The vocabulary changed; the discipline did not.

## Why it works in industrial AI

Most industrial AI failures are not model failures. They are integration failures, adoption failures, or evaluation failures. The model converges; the rollout doesn't.

The pattern that wins:

- **Instrument the process first.** You cannot improve what you cannot see. Real-time data on the variables that actually matter, sampled fast enough to catch the drift before the operator does.
- **Train the model on representative state.** Synthetic data and steady-state samples are how you ship a system that fails the first time the line behaves abnormally.
- **Put the operator in the loop, not next to it.** A model that produces a recommendation an operator has to translate into a setpoint change is two systems pretending to be one. Either close the loop or admit you have a dashboard, not an AI rollout.
- **Run the evaluation continuously.** Drift detection isn't a quarterly review item. It is a service that runs every shift and pages someone when the model's behavior diverges from what got it approved.
- **Standardize the human procedure that surrounds the model.** Hand-off scripts, escalation paths, override rules. The model is one of the inputs; the standardized procedure is the system.

## What I am not interested in

Pilot projects that do not ship. Bench demos. Notebooks. Models with no operator in the loop. Vendor pitches that solve a problem no one in the plant has named. "AI strategy" decks. Any rollout where the success metric was selected after the model converged.

## What I bring to the conversation

Twenty years of running operational systems in environments where the standard is "the next person who flies this aircraft has to trust the work you did." A few years now of taking that into manufacturing AI, where the analogous standard is "the operator on the night shift has to trust the system you deployed."

If you are deploying AI in a regulated, safety-relevant, or operationally constrained environment, that is the conversation I want to have.
