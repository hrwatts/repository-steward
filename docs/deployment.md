# Deployment

## v0.1

Required services:

- one `probot-server` container
- one PostgreSQL database in deployed environments
- one scheduled workflow in the steward repository

Optional local mode:

- local SQLite audit store
- manual `npm run inspect:pilot`

## Environment

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_INSTALLATION_ID` for scheduler runs that use app auth
- `DATABASE_URL`
- `DASHBOARD_ISSUE_REPO`
- `DASHBOARD_ISSUE_NUMBER`

## Notes

- `GITHUB_TOKEN` is adequate for steward-repo issue updates but not for cross-repository source writes.
- Scheduled workflows should remain centralized to avoid dormant public-repo auto-disable behavior.
