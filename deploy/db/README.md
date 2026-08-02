# Database

Production deployments should use PostgreSQL.

Local development and dry runs can use SQLite via:

```bash
DATABASE_URL=sqlite://.data/repository-steward.db
```
