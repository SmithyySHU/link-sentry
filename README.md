````md
# Link-Sentry

Automated broken-link monitoring for websites.

Link-Sentry is a work-in-progress SaaS-style app that scans websites to detect broken/blocked links (internal + external), stores results, and presents them in a dashboard. The goal is **reliable monitoring** and a clean workflow—not a full SEO suite.

---

## Why this exists

Broken links hurt user experience, trust, and SEO. Many site owners only notice once users complain.

Link-Sentry aims to make link monitoring a background task that runs automatically and surfaces clear, actionable results.

---

## What it does today

### ✅ Scanning + classification

- Crawls a site from a start URL
- Extracts and normalises links
- Validates links with timeouts + custom User-Agent
- Classifies results into:
  - `ok`
  - `broken` (e.g. 404)
  - `blocked` (e.g. 403 / forbidden)
  - timeout / fetch-failed scenarios (recorded as “failed to fetch” / “no response”)

### ✅ Storage (PostgreSQL)

- Core tables:
  - `sites`
  - `scan_runs`
- **Deduplicated link results**:
  - `scan_links` (unique link per scan run + aggregated status + occurrence count)
  - `scan_link_occurrences` (where each link appeared / “found on these pages” drill-down)
- Ignore rules support (exclude specific URLs/patterns from results)

### ✅ API + dashboard

- API endpoints for:
  - listing scan runs
  - fetching results with pagination + totals
  - filtering by classification/status
- schedule controls to auto-scan sites (daily/weekly, UTC)
- email notifications with deltas (optional, SMTP-backed)
- Web dashboard (WIP but usable):
  - browse sites + scan runs
  - view broken/blocked results
  - expandable drill-down to see occurrences
  - responsive layout + dark/light theme toggle

### ✅ Developer workflow

- Monorepo with npm workspaces
- Local runs:
  - run a scan
  - view results via API/UI

---

## Project structure

```txt
apps/
  api/        # REST API + event endpoints
  worker/     # queue worker + scheduler tick
  web/        # Dashboard UI
packages/
  crawler/    # crawling + validation + classification
  db/         # SQL migrations + query layer
```
````

---

## Local development

### 1) Requirements

- Node.js (see `.nvmrc` if present)
- PostgreSQL
- `DATABASE_URL` set (API + scripts use it)
- Email (optional):
  - `EMAIL_ENABLED=true`
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
  - `EMAIL_FROM` (optional)
  - `EMAIL_TEST_TO` (optional override for test emails)

### 2) Install

```bash
npm ci
```

### 3) Run migrations

```bash
# Example (adjust to your repo’s migration command if different)
psql "$DATABASE_URL" -f packages/db/migrations/001_add_dedup_tables.sql
psql "$DATABASE_URL" -f packages/db/migrations/002_<your_next_migration>.sql
psql "$DATABASE_URL" -f packages/db/migrations/003_add_ignore_rules.sql
```

### 4) Start the apps

```bash
# Example (adjust to your scripts if different)
npm -w apps/api run dev
npm -w apps/web run dev
npm -w apps/worker run dev
```

---

## CI

GitHub Actions runs on pushes + PRs:

- install (`npm ci`)
- typecheck / lint / build across workspaces
- formatting check (Prettier) to fail PRs with unformatted code

Note: `npm --workspaces run build` may print a Vite CJS deprecation warning; the build still completes successfully.

---

## Roadmap (near-term)

- Better scan progress reporting (UI progress indicator + streaming updates)
- More filters (status-code groups, timeouts, ignored)
- Export (CSV), copy actions, bulk ignore, retry scan
- Authentication + user accounts (UI placeholders already planned)
- Scheduling / recurring scans + notifications (email)

---

## Notes

This repository is under active development and will change as the MVP gets hardened.

```

```
