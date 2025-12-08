# Dawson's Resource Hub

A minimal Bun + SQLite app for sharing download bundles from Dawson's tutorial videos. Viewers get a polished, searchable landing page for Docker Compose files and helper scripts, while the creator can log into `/admin` to curate content.

## Features

- 📦 SQLite-backed storage for videos + unlimited asset links
- 🧑‍💼 Password-protected admin dashboard with CRUD for videos and assets
- 🔐 Forced first-login password rotation for the creator account
- 🧭 Public landing page with search + responsive cards
- 🪄 Automatic sample data (Vaultwarden, Nginx Proxy Manager, Jellyfin) seeded on first boot
- 🔌 JSON feed at `/api/videos` for embedding elsewhere
- 🐳 Docker + Compose workflow for turnkey self-hosting
- 🎨 Runtime branding overrides via `resource-hub.config.json`

## Requirements

- [Bun](https://bun.sh) v1.1+
- SQLite (bundled with Bun via `bun:sqlite`)

## Quick start (Docker Compose)

1. Copy the sample configuration and create persistent volumes:
   ```bash
   cp .env.example .env
   mkdir -p config data
   cp resource-hub.config.example.json config/resource-hub.config.json
   ```
2. Adjust `.env` and `config/resource-hub.config.json` to match your branding or credentials.
3. Launch the stack:
   ```bash
   docker compose up -d --build
   ```
4. Visit `http://localhost:3000` (public) or `http://localhost:3000/admin` to log in with the seeded credentials, then rotate the password on first access.

`docker-compose.yml` mounts `./data` (SQLite) and `./config` (branding copy) so upgrades are as simple as pulling the repo and re-running `docker compose up -d --build`.

## Manual setup (Bun)

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
| `ADMIN_USERNAME` | `creator` | Username for the seeded admin account |
| `ADMIN_PASSWORD` | `changeme` | Initial password (forces a change on first login) |
| `RESOURCE_HUB_CONFIG_PATH` | `./resource-hub.config.json` | Optional path to the branding/UX config JSON |

Set `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env` or your Compose file to control the seeded account. The server still warns when defaults are in use and forces a rotation on first login. Point `RESOURCE_HUB_CONFIG_PATH` at a JSON file (see below) to override every headline, hero description, footer, and login/admin prompt without touching the templates.

## Customizing text & branding

1. Copy the sample config and make it your own:
   ```bash
   cp resource-hub.config.example.json resource-hub.config.json
   ```
2. Edit the JSON to match your wording (site name, hero copy, CTA label, footer text, etc.).
3. Set `RESOURCE_HUB_CONFIG_PATH` (or mount `resource-hub.config.json` inside Docker) so the server can load it on boot.

Every string in the JSON mirrors a section of the UI. For example:

```json
{
  "branding": {
    "siteName": "Acme Download Hub",
    "public": {
      "heroTitle": "Infrastructure playbooks in one place.",
      "footerText": "© {{year}} {{siteName}} • DIY or die."
    }
  }
}
```

The footer (and other strings) can use `{{siteName}}` and `{{year}}` tokens for lightweight templating. Missing fields automatically fall back to the stock Dawson wording, so you only need to override what changes between deployments.

## Production deployment

If you're using Docker/Compose, deployments are as simple as `docker compose pull && docker compose up -d --build`. For bare-metal Bun installs, follow the steps below.

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
