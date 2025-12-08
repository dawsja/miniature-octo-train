# Dawson's Resource Hub

A minimal Bun + SQLite app for sharing download bundles from Dawson's tutorial videos. Viewers get a polished, searchable landing page for Docker Compose files and helper scripts, while the creator can log into `/admin` to curate content.

## Features

- 📦 SQLite-backed storage for videos + unlimited asset links
- 🧑‍💼 Password-protected admin dashboard with CRUD for videos and assets
- 🔐 Forced first-login password rotation for the creator account
- 🧭 Public landing page with search + responsive cards
- 🪄 Automatic sample data (Vaultwarden, Nginx Proxy Manager, Jellyfin) seeded on first boot
- 🔌 JSON feed at `/api/videos` for embedding elsewhere

## Requirements

- [Bun](https://bun.sh) v1.1+
- SQLite (bundled with Bun via `bun:sqlite`)

## Setup

```bash
# install dependencies for TypeScript types
npm install

# start the Bun server (auto-reloads with --watch)
bun run --watch src/server.ts
```

The server listens on `http://localhost:3000` by default. Change `PORT` to override.

## Environment variables

| Name | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port for `Bun.serve` |
| `ADMIN_USERNAME` | `creator` | Admin login username |
| `ADMIN_PASSWORD` | `changeme` | Admin password (change in production) |
| `DATA_DIR` | `./data` | Directory for the SQLite file |
| `DATABASE_FILE` | `downloads.db` | Filename for the SQLite database |
| `SESSION_TTL_DAYS` | `7` | Session lifetime for admin logins |
| `MIN_PASSWORD_LENGTH` | `12` | Minimum characters required for admin password changes |

## Admin workflow

1. Visit `http://localhost:3000/admin`
2. Log in with the configured credentials
3. Use **Add new video pack** to create a card (slug optional, auto-built from the title)
4. Attach any number of download links to each video
5. Update or delete existing packs inline

## Testing

The project currently relies on manual verification:

- Hit `/` to ensure the public gallery renders
- Log into `/admin`, add/update/delete entries, and verify they sync on the public page
- Use `/api/videos` to confirm structured JSON output

Automated tests can be added later (e.g., integration tests with Bun’s test runner).
