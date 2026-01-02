# link-sentry

Automated broken link monitoring for websites.

link-sentry is a work-in-progress SaaS application that scans websites on a recurring basis to detect broken internal and external links. Results are stored and presented through a simple dashboard and email reports.

The focus of this project is to build a reliable, automated system rather than a full SEO analysis tool.

## Motivation

Broken links negatively affect user experience, SEO, and overall site quality. Despite this, many small website owners only discover issues after users report them.

This project aims to make broken link monitoring a background task that runs automatically, with minimal ongoing effort from the user.

## Current Status

🚧 Planning and Early Development
Current Status:

No application code has been written yet.

The repository currently contains project structure, documentation, and setup files.

Initial setup for database configuration and environment variables has been completed.

Database connection tested and confirmed successfully.

Next Steps:

Crawler development: Implement and integrate the crawler functionality.

Database integration: Store scan results in the database, including valid and broken links.

Testing and validation: Ensure proper interaction between the crawler and database.

## Tech Stack (Planned)

- Frontend: Next.js / React
- Backend: Node.js
- Database: PostgreSQL
- Background jobs: Node.js worker
- Payments: Stripe

## Notes

This repository is under active development. Details may change as the project evolves.
