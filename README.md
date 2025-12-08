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

For any environment (including local development) Bun automatically loads variables from a `.env` file located in the project root. Copy `.env.example` to `.env` and adjust values before running the server.

## Environment variables

| Name | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port for `Bun.serve` |
| `DATA_DIR` | `./data` | Directory for the SQLite file |
| `DATABASE_FILE` | `downloads.db` | Filename for the SQLite database |
| `SESSION_TTL_DAYS` | `7` | Session lifetime for admin logins |
| `MIN_PASSWORD_LENGTH` | `12` | Minimum characters required for admin password changes |

The admin console always boots with the default credentials `creator` / `changeme`. They are stored in SQLite and every first login is forced to rotate the password, so no `.env` changes are required for authentication.

## Production deployment

1. Install Bun (v1.1+) and PM2 (globally via `npm install -g pm2`) on the target host.
2. Copy `.env.example` to `.env` and adjust the networking/storage values (`HOST`, `PORT`, `DATA_DIR`, etc.).
3. Ensure `DATA_DIR` points to a persistent directory (for example `/var/lib/download-hub`) and create it with the correct ownership before starting the service.
4. Install dependencies: `bun install --production`.
5. Start the service under PM2:
   ```bash
   pm2 start ecosystem.config.js --env production
   pm2 save
   ```
6. Log into `/admin` with `creator` / `changeme`, then follow the forced password rotation flow to store a unique password in SQLite.
7. (Optional) Configure PM2 to launch on boot: `pm2 startup systemd`.

### Runtime management

- Check process health: `pm2 status download-hub`
- Tail application logs: `pm2 logs download-hub`
- Reload without downtime after deploying changes: `pm2 reload download-hub`

### Reverse proxy notes

- Bind the app to localhost when sitting behind Nginx/Traefik/Caddy by setting `HOST=127.0.0.1`.
- TLS termination happens at the proxy; the app automatically sets the `Secure` cookie attribute whenever `NODE_ENV=production`, so keep the proxy-to-client hop on HTTPS.
- Use the `/healthz` endpoint for load balancer checks (returns `200 ok`).

### Backups

- The SQLite database lives at `${DATA_DIR}/${DATABASE_FILE}`. Back up this file regularly.
- Sessions and admin password rotation data are also stored in SQLite, so include them in your backup strategy.

## Admin workflow

1. Visit `http://localhost:3000/admin`
2. Log in with `creator` / `changeme` (you'll be forced to set a new password on first access)
3. Use **Add new video pack** to create a card (slug optional, auto-built from the title)
4. Attach any number of download links to each video
5. Update or delete existing packs inline

## Testing

The project currently relies on manual verification:

- Hit `/` to ensure the public gallery renders
- Log into `/admin`, add/update/delete entries, and verify they sync on the public page
- Use `/api/videos` to confirm structured JSON output

Automated tests can be added later (e.g., integration tests with Bun’s test runner).
