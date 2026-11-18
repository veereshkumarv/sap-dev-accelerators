<!--
What: First architecture decision record: the decision to keep ADRs, with the template to
    follow.
Why: Architecture decisions must be traceable over time, not buried in chat or tickets.
If missing or unlinked: There is no agreed place or format for decisions; later ADRs are
    inconsistent or never written.
-->

# 1. Record architecture decisions

- Status: accepted
- Deciders: sales-orders team

## Context

Decisions about this service (data model, integration, security, deployment) must remain
traceable for reviewers, operators and future team members.

## Decision

We record every architecturally significant decision as a numbered Markdown file in
`docs/adr/` using this structure: *Status, Context, Decision, Consequences*.
Superseded ADRs are kept and marked `superseded by NNNN`.

## Consequences

- Decisions are reviewed in pull requests like code.
- New team members can read why the service looks the way it does.
