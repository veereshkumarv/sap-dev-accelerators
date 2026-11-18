{{!
What: Template for docs/adr/0001-record-architecture-decisions.md - the first ADR and the ADR
    format.
Why: Projects start recording decisions immediately in a consistent format.
If missing or unlinked: create-cap-app stops with "template not found"; generated projects would
    have no ADR convention.
}}
# 1. Record architecture decisions

- Status: accepted
- Deciders: {{projectName}} team

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
