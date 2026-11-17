<!--
What: Checklist shown in every pull request description.
Why: Reminds authors of the gates (tests, fixtures, guardrails, policy approval) before reviewers
    spend time.
If missing or unlinked: PRs open with an empty description; reviewers must chase missing tests and
    approvals manually.
-->

## What and why

## Checklist
- [ ] `npm run check` passes locally (lint, types, tests with coverage thresholds)
- [ ] New/changed rules have positive and negative fixture tests
- [ ] Generated code still follows docs/GUARDRAILS.md (released APIs, authorization, no hard-coded config)
- [ ] No new runtime dependency, or the reason is stated here
- [ ] Policy changes (`policy/`) approved by an architect
