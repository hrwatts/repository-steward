# Threat Model

## Primary threats

- accidental repository mutation during a dry pilot
- approval drift after PR head SHA changes
- misuse of user identity for bot-authored commits
- execution of untrusted repository code with a write-capable token present
- replay of future review-console approval requests
- webhook spoofing or replay

## v0.1 mitigations

- source-repository mutations disabled by default
- dashboard updates limited to steward repository issue writes
- GitHub App installation tokens are isolated from any future user tokens
- no user-attributed review submission path yet
- webhook secret required for Probot server startup
- audit certificates are hashed and persisted

## Deferred mitigations for v0.3+

- CSRF and single-use nonce on approval console
- encrypted refresh token storage
- replay cache for approval events
- explicit SHA-bound review submission on behalf of users
