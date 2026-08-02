# Architecture

`repository-steward` is split into two executable entrypoints and several package-style internal modules.

## v0.1 pilot

- `apps/scheduler-runner`
  - central inspection loop
  - dry-run only for source repositories
  - writes audit state and workflow artifacts
- `apps/probot-server`
  - GitHub App webhook ingestion
  - installation and review event logging
  - future home for user authorization and review-console routing

## Core packages

- `github-client`
- `repository-discovery`
- `policy-engine`
- `drift-detectors`
- `repair-planner`
- `risk-classifier`
- `evidence-generator`
- `audit-store`
- `notification-service`
- `reusable-workflow-client`

## Current limitations

- no source-repository PR creation yet
- no custom approval console
- no queue service
- no automatic dispatch to reusable validation workflows
