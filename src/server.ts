import {
  createAsset,
  createSession,
  createVideo,
  db,
  deleteAdminUser,
  deleteAsset,
  deleteSession,
  deleteVideo,
  ensureAdminUser,
  findSession,
  getAdminUser,
  listAdminUsers,
  listVideosWithAssets,
  pruneSessions,
  seedIfEmpty,
  updateAdminPassword,
  updateVideo
} from "./db";
import { Buffer } from "node:buffer";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const HOST = Bun.env.HOST ?? "0.0.0.0";
const PORT = Number(Bun.env.PORT ?? 3000);
const DEFAULT_ADMIN_USERNAME = "creator";
const DEFAULT_ADMIN_PASSWORD = "changeme";
const ADMIN_USERNAME = DEFAULT_ADMIN_USERNAME;
const SESSION_COOKIE = "sid";
const SESSION_TTL_DAYS = Number(Bun.env.SESSION_TTL_DAYS ?? 7);
const SESSION_MAX_AGE = SESSION_TTL_DAYS * 24 * 60 * 60; // seconds
const PASSWORD_KEYLEN = 64;
const PASSWORD_ITERATIONS = 120_000;
const PASSWORD_DIGEST = "sha512";
const MIN_PASSWORD_LENGTH = Number(Bun.env.MIN_PASSWORD_LENGTH ?? 12);

ensureProductionConfig();

seedIfEmpty();
initializeAdminUser();

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || `video-${Date.now()}`;
}

function tagsToString(tags: string[]) {
  return tags.join(", ");
}

function parseTags(input: FormDataEntryValue | null): string[] {
  if (!input) return [];
  return input
    .toString()
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("cookie");
  if (!header) return {};
  return header.split(";").reduce<Record<string, string>>((acc, part) => {
    const [name, ...rest] = part.split("=");
    if (!name) return acc;
    acc[name.trim()] = decodeURIComponent(rest.join("=").trim());
    return acc;
  }, {});
}

function derivePasswordHash(password: string, salt?: string) {
  const actualSalt = salt ?? randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, actualSalt, PASSWORD_ITERATIONS, PASSWORD_KEYLEN, PASSWORD_DIGEST).toString("hex");
  return { hash, salt: actualSalt };
}

function passwordsMatch(password: string, hash: string, salt: string) {
  try {
    const candidate = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEYLEN, PASSWORD_DIGEST).toString("hex");
    const candidateBuffer = Buffer.from(candidate, "hex");
    const storedBuffer = Buffer.from(hash, "hex");
    if (candidateBuffer.length !== storedBuffer.length) {
      return false;
    }
    return timingSafeEqual(candidateBuffer, storedBuffer);
  } catch (error) {
    console.error("Failed to verify password", error);
    return false;
  }
}

function redirect(location: string, cookie?: string) {
  const headers: HeadersInit = {
    Location: location
  };
  if (cookie) {
    headers["Set-Cookie"] = cookie;
  }
  return new Response(null, { status: 302, headers });
}

function isProduction() {
  return (Bun.env.NODE_ENV ?? "").toLowerCase() === "production";
}

function isUsingDefaultCredentials() {
  const admin = getAdminUser(ADMIN_USERNAME);
  if (!admin) {
    return true;
  }
  return passwordsMatch(DEFAULT_ADMIN_PASSWORD, admin.password_hash, admin.salt);
}

function ensureProductionConfig() {
  if (Number.isNaN(PORT) || PORT <= 0) {
    console.error("PORT must be a positive integer.");
    process.exit(1);
  }

  if (Number.isNaN(SESSION_TTL_DAYS) || SESSION_TTL_DAYS <= 0) {
    console.error("SESSION_TTL_DAYS must be a positive integer.");
    process.exit(1);
  }

  if (Number.isNaN(MIN_PASSWORD_LENGTH) || MIN_PASSWORD_LENGTH < 8) {
    console.error("MIN_PASSWORD_LENGTH must be at least 8 characters.");
    process.exit(1);
  }

  if (isUsingDefaultCredentials()) {
    console.warn(
      "⚠️  Using default admin credentials (creator/changeme). You will be required to change your password on first login."
    );
  }
}

function authCookie(sessionId: string, maxAgeSeconds: number) {
  const secure = isProduction() ? "; Secure" : "";
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function clearAuthCookie() {
  const secure = isProduction() ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

function initializeAdminUser() {
  // Clean up any admin users with different usernames (legacy env-based installs)
  const allAdmins = listAdminUsers();
  for (const oldAdmin of allAdmins) {
    if (oldAdmin.username !== ADMIN_USERNAME) {
      console.log(`Removing stale admin user "${oldAdmin.username}" (resetting to default "${ADMIN_USERNAME}")`);
      deleteAdminUser(oldAdmin.username);
    }
  }

  const admin = getAdminUser(ADMIN_USERNAME);

  if (!admin) {
    const { hash, salt } = derivePasswordHash(DEFAULT_ADMIN_PASSWORD);
    console.log(`Creating admin user "${ADMIN_USERNAME}" with default credentials`);
    ensureAdminUser(ADMIN_USERNAME, hash, salt, true);
    return;
  }

  const usingDefaultPassword = passwordsMatch(DEFAULT_ADMIN_PASSWORD, admin.password_hash, admin.salt);

  if (usingDefaultPassword && !admin.must_change_password) {
    console.log(`Enforcing password rotation for "${ADMIN_USERNAME}"`);
    updateAdminPassword(ADMIN_USERNAME, admin.password_hash, admin.salt, true);
  }
}

function adminMustChangePassword() {
  const admin = getAdminUser(ADMIN_USERNAME);
  return Boolean(admin?.must_change_password);
}

function isAuthenticated(request: Request) {
  const cookies = parseCookies(request);
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) return false;
  const session = findSessionSafe(sessionId);
  return Boolean(session);
}

function findSessionSafe(id: string) {
  try {
    return findSession(id);
  } catch (error) {
    console.error("Failed to lookup session", error);
    return null;
  }
}

async function handleLogin(request: Request) {
  const form = await request.formData();
  const username = form.get("username")?.toString().trim();
  const password = form.get("password")?.toString();

  if (!username || !password) {
    return redirect("/admin?error=Missing+credentials");
  }

  if (username !== ADMIN_USERNAME) {
    await Bun.sleep(150);
    return redirect("/admin?error=Invalid+credentials");
  }

  const admin = getAdminUser(ADMIN_USERNAME);
  if (!admin || !passwordsMatch(password, admin.password_hash, admin.salt)) {
    await Bun.sleep(150);
    return redirect("/admin?error=Invalid+credentials");
  }

  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
  createSession({
    id: sessionId,
    expiresAt,
    ip: request.headers.get("x-forwarded-for") ?? undefined,
    userAgent: request.headers.get("user-agent") ?? undefined
  });

  const destination = admin.must_change_password ? "/admin/password" : "/admin";
  return redirect(destination, authCookie(sessionId, SESSION_MAX_AGE));
}

async function handleLogout(request: Request) {
  const cookies = parseCookies(request);
  const sessionId = cookies[SESSION_COOKIE];
  if (sessionId) {
    deleteSession(sessionId);
  }
  return redirect("/admin", clearAuthCookie());
}

function renderLayout({
  title,
  body,
  description,
  includeAdminNav
}: {
  title: string;
  body: string;
  description: string;
  includeAdminNav?: boolean;
}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: dark;
      --bg: #1f1f1f;
      --card: #262626;
      --text: #fefdfb;
      --accent: #fc93ad;
      --accent-strong: #ffb1c5;
      --muted: rgba(254,253,251,0.7);
      --border: rgba(254,253,251,0.12);
      --error: #ff7a95;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont;
      background: var(--bg);
      color: var(--text);
    }
    a { color: var(--accent-strong); }
    header {
      padding: 3rem 1.5rem 1.25rem;
      text-align: center;
    }
    header.hero {
      padding-top: 1.5rem;
    }
    .hero-title { font-size: clamp(2.4rem, 4vw, 3.75rem); margin-bottom: 0.5rem; }
    .hero-desc { max-width: 720px; margin: 0 auto; color: var(--muted); font-size: 1.15rem; }
    main { padding: 0 1.5rem 3rem; max-width: 1100px; margin: 0 auto; }
    .search-bar { width: 100%; padding: 0.95rem 1.1rem; border-radius: 999px; border: 1px solid var(--border); background: rgba(254,253,251,0.04); color: var(--text); font-size: 1rem; margin-bottom: 1.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 1.25rem; padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; box-shadow: 0 10px 35px rgba(0,0,0,0.45); }
    .card img { width: 100%; height: 180px; object-fit: cover; border-radius: 0.95rem; border: 1px solid var(--border); }
    .card h2 { margin: 0; font-size: 1.35rem; }
    .tags { display: flex; flex-wrap: wrap; gap: 0.45rem; }
    .tag { padding: 0.2rem 0.65rem; border-radius: 999px; background: rgba(252,147,173,0.15); color: var(--accent); font-size: 0.8rem; }
    .downloads { display: flex; flex-direction: column; gap: 0.45rem; }
    .download-link { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.7rem 1rem; border-radius: 0.75rem; background: rgba(254,253,251,0.03); border: 1px solid transparent; text-decoration: none; color: var(--text); transition: border 0.2s, background 0.2s; }
    .download-link:hover { border-color: var(--accent); background: rgba(252,147,173,0.12); }
    .cta { margin-top: 1rem; }
    .cta a { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.8rem 1.2rem; background: var(--accent-strong); color: var(--bg); border-radius: 0.75rem; font-weight: 600; text-decoration: none; }
    footer { padding: 2rem 1.5rem; text-align: center; color: var(--muted); border-top: 1px solid var(--border); }
    .admin-nav { border-bottom: 1px solid var(--border); padding: 0.85rem 1.5rem; display: flex; justify-content: space-between; align-items: center; }
    button.primary { background: var(--accent-strong); color: var(--bg); border: none; border-radius: 0.65rem; padding: 0.75rem 1.25rem; font-weight: 600; cursor: pointer; }
    button.danger { background: rgba(255,122,149,0.12); color: var(--error); border: 1px solid rgba(255,122,149,0.4); border-radius: 0.5rem; padding: 0.45rem 0.8rem; cursor: pointer; }
    .form-card { background: var(--card); border: 1px solid var(--border); border-radius: 1rem; padding: 1.5rem; margin-bottom: 1.5rem; }
    label { display: block; font-size: 0.9rem; color: var(--muted); margin-bottom: 0.25rem; }
    input[type="text"], input[type="url"], textarea, input[type="password"] {
      width: 100%;
      background: rgba(254,253,251,0.03);
      border: 1px solid var(--border);
      border-radius: 0.65rem;
      padding: 0.7rem 0.9rem;
      color: var(--text);
      margin-bottom: 1rem;
    }
    textarea { min-height: 110px; resize: vertical; }
    .flex { display: flex; flex-wrap: wrap; gap: 1rem; }
    .flex > div { flex: 1; min-width: 200px; }
    .asset-list { list-style: none; padding: 0; margin: 0.5rem 0 0; display: flex; flex-direction: column; gap: 0.4rem; }
    .asset-list li { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; padding: 0.65rem 0.5rem; border-bottom: 1px solid rgba(254,253,251,0.08); }
    .flash { background: rgba(252,147,173,0.12); border: 1px solid rgba(252,147,173,0.45); color: var(--accent); padding: 0.9rem 1rem; border-radius: 0.75rem; margin-bottom: 1rem; }
    .error { background: rgba(255,122,149,0.12); border: 1px solid rgba(255,122,149,0.4); color: var(--error); padding: 0.9rem 1rem; border-radius: 0.75rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  ${includeAdminNav ? `<div class="admin-nav"><strong>Dawson's Resource Hub</strong><form method="post" action="/admin/logout"><button class="danger" type="submit">Logout</button></form></div>` : ""}
  ${body}
  <script>
    const searchInput = document.getElementById('search');
    if (searchInput) {
      searchInput.addEventListener('input', event => {
        const query = event.target.value.toLowerCase();
        document.querySelectorAll('[data-filterable]')?.forEach(card => {
          const text = card.getAttribute('data-filterable');
          if (!text) return;
          card.style.display = text.includes(query) ? 'flex' : 'none';
        });
      });
    }
  </script>
</body>
</html>`;
}

function renderPublic(videos = listVideosWithAssets()) {
  const cards = videos
    .map((video) => {
      const tags = video.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
      const downloads = video.assets
        .map(
          (asset) => `<a class="download-link" href="${escapeHtml(asset.url)}" target="_blank" rel="noopener">
            <span>⬇</span>
            <span>${escapeHtml(asset.label)}</span>
          </a>`
        )
        .join("");

      return `<article class="card" data-filterable="${escapeHtml(
        `${video.title} ${video.description ?? ""} ${video.tags.join(" ")}`.toLowerCase()
      )}">
        ${video.thumbnail_url ? `<img src="${escapeHtml(video.thumbnail_url)}" alt="${escapeHtml(video.title)} thumbnail">` : ""}
        <div>
          <h2>${escapeHtml(video.title)}</h2>
          <p>${escapeHtml(video.description ?? "")}</p>
        </div>
        <div class="tags">${tags}</div>
        <div class="downloads">${downloads}</div>
        ${video.video_url ? `<div class="cta"><a href="${escapeHtml(video.video_url)}" target="_blank" rel="noopener">Watch Tutorial →</a></div>` : ""}
      </article>`;
    })
    .join("");
  const gridContent =
    cards ||
    `<div class="card" style="grid-column: 1 / -1; text-align:center;">
        <p style="margin:0;">No download packs yet. Check back soon!</p>
      </div>`;

  const body = `
    <header class="hero">
      <h1 class="hero-title">Download packs for every tutorial.</h1>
      <p class="hero-desc">Every docker-compose, env template, and helper file from the channel in one place. Search, download, and plug the resources into any deployment workflow.</p>
    </header>
    <main>
      <input class="search-bar" id="search" type="text" placeholder="Search guides, tags, services..." />
      <section class="grid">
        ${gridContent}
      </section>
    </main>
    <footer>© ${new Date().getFullYear()} Dawson's Resource Hub • Crafted with Bun + SQLite</footer>
  `;

  return renderLayout({
    title: "Dawson's Resource Hub",
    description: "Centralized download links for docker compose files from the channel.",
    body,
    includeAdminNav: false
  });
}

function renderLogin(message?: string) {
  const isDefaultCreds = isUsingDefaultCredentials();
  const defaultCredsHint = isDefaultCreds
    ? `<div class="flash" style="text-align:left;">
        <strong>First time setup:</strong> Use default credentials to log in, then you'll set your own password.<br>
        <span style="font-size:0.9rem;">Username: <code style="background:rgba(254,253,251,0.08);padding:0.1rem 0.35rem;border-radius:0.25rem;">${escapeHtml(
          DEFAULT_ADMIN_USERNAME
        )}</code> &nbsp; Password: <code style="background:rgba(254,253,251,0.08);padding:0.1rem 0.35rem;border-radius:0.25rem;">${escapeHtml(
          DEFAULT_ADMIN_PASSWORD
        )}</code></span>
      </div>`
    : "";

  const body = `
    <header>
      <h1 class="hero-title">Dawson's Resource Hub</h1>
      <p class="hero-desc">Sign in to curate download packs and keep files in sync with every Dawson tutorial.</p>
    </header>
    <main style="max-width:420px;">
      ${message ? `<div class="error">${escapeHtml(message)}</div>` : ""}
      ${defaultCredsHint}
      <form class="form-card" method="post" action="/admin/login">
        <label for="username">Username</label>
        <input id="username" name="username" type="text" placeholder="${isDefaultCreds ? DEFAULT_ADMIN_USERNAME : "username"}" required />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" placeholder="••••••••" required />
        <button class="primary" style="width:100%;" type="submit">Sign in</button>
      </form>
    </main>
  `;

  return renderLayout({
    title: "Dawson's Resource Hub",
    description: "Manage downloadable assets for channel tutorials.",
    body,
    includeAdminNav: false
  });
}

function renderPasswordChange({
  error,
  flash,
  requireChange
}: {
  error?: string;
  flash?: string;
  requireChange: boolean;
}) {
  const isDefaultCreds = isUsingDefaultCredentials();
  const currentPasswordHint = requireChange && isDefaultCreds
    ? `<p style="margin:0 0 0.5rem;color:var(--muted);font-size:0.85rem;">Current password is: <code style="background:rgba(254,253,251,0.08);padding:0.15rem 0.4rem;border-radius:0.25rem;">${
        escapeHtml(DEFAULT_ADMIN_PASSWORD)
      }</code></p>`
    : "";

  const body = `
    <header>
      <h1 class="hero-title">${requireChange ? "Set up your password" : "Change password"}</h1>
      <p class="hero-desc">${
        requireChange
          ? "Welcome! Before you can manage resources, please set a secure password for your admin account."
          : "Use a strong password to protect the resource hub."
      }</p>
    </header>
    <main style="max-width:480px;">
      ${flash ? `<div class="flash">${escapeHtml(flash)}</div>` : ""}
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
      <form class="form-card" method="post" action="/admin/password">
        <label for="current_password">Current password</label>
        ${currentPasswordHint}
        <input id="current_password" name="current_password" type="password" placeholder="••••••••" required />
        <label for="new_password">New password</label>
        <input id="new_password" name="new_password" type="password" placeholder="Use at least ${MIN_PASSWORD_LENGTH} characters" required />
        <label for="confirm_password">Confirm new password</label>
        <input id="confirm_password" name="confirm_password" type="password" placeholder="Repeat new password" required />
        <p style="margin:0 0 1rem;color:var(--muted);font-size:0.85rem;">Minimum ${MIN_PASSWORD_LENGTH} characters. Use a phrase you'll only use here.</p>
        <button class="primary" style="width:100%;" type="submit">Save new password</button>
      </form>
    </main>
  `;

  return renderLayout({
    title: requireChange ? "Set up admin password" : "Change admin password",
    description: "Secure Dawson's Resource Hub with a unique password.",
    body,
    includeAdminNav: false
  });
}

function renderAdmin(videos = listVideosWithAssets(), flash?: string) {
  const videoForms = videos
    .map((video) => {
      const assets = video.assets
        .map(
          (asset) => `<li>
            <span>${escapeHtml(asset.label)}</span>
            <form method="post" action="/admin/assets/${asset.id}/delete">
              <button class="danger" type="submit">Remove</button>
            </form>
          </li>`
        )
        .join("");

      return `<section class="form-card">
        <header style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
          <div>
            <h2 style="margin:0;">${escapeHtml(video.title)}</h2>
            <p style="margin:0;color:var(--muted);">Slug: ${escapeHtml(video.slug)}</p>
          </div>
          <form method="post" action="/admin/videos/${video.id}/delete" onsubmit="return confirm('Delete ${escapeHtml(video.title)}?');">
            <button class="danger" type="submit">Delete</button>
          </form>
        </header>
        <form method="post" action="/admin/videos/${video.id}" style="margin-top:1rem;">
          <label>Title</label>
          <input type="text" name="title" value="${escapeHtml(video.title)}" required />
          <label>Description</label>
          <textarea name="description">${escapeHtml(video.description ?? "")}</textarea>
          <div class="flex">
            <div>
              <label>Video URL</label>
              <input type="url" name="video_url" value="${escapeHtml(video.video_url ?? "" )}" />
            </div>
            <div>
              <label>Thumbnail URL</label>
              <input type="url" name="thumbnail_url" value="${escapeHtml(video.thumbnail_url ?? "" )}" />
            </div>
          </div>
          <label>Tags (comma separated)</label>
          <input type="text" name="tags" value="${escapeHtml(tagsToString(video.tags))}" />
          <button class="primary" type="submit">Save changes</button>
        </form>
        <div style="margin-top:1.5rem;">
          <h3 style="margin-top:0.25rem;">Assets</h3>
          <ul class="asset-list">${assets || '<li style="justify-content:flex-start;color:var(--muted);">No assets yet</li>'}</ul>
          <form method="post" action="/admin/videos/${video.id}/assets" style="margin-top:1rem;">
            <div class="flex">
              <div>
                <label>Label</label>
                <input type="text" name="label" placeholder="docker-compose.yml" required />
              </div>
              <div>
                <label>URL</label>
                <input type="url" name="url" placeholder="https://..." required />
              </div>
            </div>
            <button class="primary" type="submit">Add asset</button>
          </form>
        </div>
      </section>`;
    })
    .join("");

  const body = `
    <header>
      <h1 class="hero-title">Keep your download hub fresh.</h1>
      <p class="hero-desc">Update docker-compose files and resources the moment your videos drop.</p>
    </header>
    <main>
      ${flash ? `<div class="flash">${escapeHtml(flash)}</div>` : ""}
      <section class="form-card">
        <h2 style="margin-top:0;">Add new video pack</h2>
        <form method="post" action="/admin/videos">
          <label>Title</label>
          <input type="text" name="title" placeholder="Immich photo server" required />
          <label>Slug (optional)</label>
          <input type="text" name="slug" placeholder="immich" />
          <label>Description</label>
          <textarea name="description" placeholder="Short blurb that shows up on the public page"></textarea>
          <div class="flex">
            <div>
              <label>Video URL</label>
              <input type="url" name="video_url" placeholder="https://youtube.com/watch?v=..." />
            </div>
            <div>
              <label>Thumbnail URL</label>
              <input type="url" name="thumbnail_url" placeholder="https://...jpg" />
            </div>
          </div>
          <label>Tags (comma separated)</label>
          <input type="text" name="tags" placeholder="docker, media, cloud" />
          <button class="primary" type="submit">Create pack</button>
        </form>
      </section>
      ${videoForms}
    </main>
  `;

  return renderLayout({
    title: "Admin • Download hub",
    description: "Manage downloadable resources.",
    body,
    includeAdminNav: true
  });
}

function servePasswordChange(url: URL) {
  const error = url.searchParams.get("error") ?? undefined;
  const flash = url.searchParams.get("flash") ?? undefined;
  const html = renderPasswordChange({
    error,
    flash,
    requireChange: adminMustChangePassword()
  });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function handlePasswordChange(request: Request) {
  const form = await request.formData();
  const current = form.get("current_password")?.toString() ?? "";
  const next = form.get("new_password")?.toString() ?? "";
  const confirm = form.get("confirm_password")?.toString() ?? "";

  if (!current || !next || !confirm) {
    return redirect("/admin/password?error=All+fields+are+required");
  }

  if (next !== confirm) {
    return redirect("/admin/password?error=Passwords+do+not+match");
  }

  if (next.length < MIN_PASSWORD_LENGTH) {
    return redirect(`/admin/password?error=Password+must+be+at+least+${MIN_PASSWORD_LENGTH}+characters`);
  }

  const admin = getAdminUser(ADMIN_USERNAME);
  if (!admin || !passwordsMatch(current, admin.password_hash, admin.salt)) {
    await Bun.sleep(150);
    return redirect("/admin/password?error=Current+password+is+incorrect");
  }

  const { hash, salt } = derivePasswordHash(next);
  updateAdminPassword(ADMIN_USERNAME, hash, salt);

  return redirect("/admin?flash=Password+updated");
}

function jsonResponse(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
}

async function handleCreateVideo(request: Request) {
  const form = await request.formData();
  const title = form.get("title")?.toString().trim();
  if (!title) {
    return redirect("/admin?error=Title+is+required");
  }
  const slugInput = form.get("slug")?.toString().trim();
  const slug = slugInput || slugify(title);
  try {
    createVideo({
      title,
      slug,
      description: form.get("description")?.toString().trim() || undefined,
      video_url: form.get("video_url")?.toString().trim() || undefined,
      thumbnail_url: form.get("thumbnail_url")?.toString().trim() || undefined,
      tags: parseTags(form.get("tags"))
    });
    return redirect("/admin?flash=Video+pack+created");
  } catch (error) {
    console.error("Create video failed", error);
    return redirect("/admin?error=Failed+to+create+video");
  }
}

async function handleUpdateVideo(request: Request, videoId: number) {
  const form = await request.formData();
  const title = form.get("title")?.toString().trim();
  if (!title) {
    return redirect("/admin?error=Title+is+required");
  }
  try {
    updateVideo(videoId, {
      title,
      description: form.get("description")?.toString().trim() || undefined,
      video_url: form.get("video_url")?.toString().trim() || undefined,
      thumbnail_url: form.get("thumbnail_url")?.toString().trim() || undefined,
      tags: parseTags(form.get("tags"))
    });
    return redirect("/admin?flash=Changes+saved");
  } catch (error) {
    console.error("Update video failed", error);
    return redirect("/admin?error=Update+failed");
  }
}

async function handleDeleteVideo(videoId: number) {
  try {
    deleteVideo(videoId);
    return redirect("/admin?flash=Video+deleted");
  } catch (error) {
    console.error("Delete video failed", error);
    return redirect("/admin?error=Delete+failed");
  }
}

async function handleCreateAsset(request: Request, videoId: number) {
  const form = await request.formData();
  const label = form.get("label")?.toString().trim();
  const url = form.get("url")?.toString().trim();
  if (!label || !url) {
    return redirect("/admin?error=Asset+fields+required");
  }
  try {
    createAsset(videoId, { label, url });
    return redirect("/admin?flash=Asset+added");
  } catch (error) {
    console.error("Asset creation failed", error);
    return redirect("/admin?error=Could+not+add+asset");
  }
}

async function handleDeleteAsset(assetId: number) {
  try {
    deleteAsset(assetId);
    return redirect("/admin?flash=Asset+removed");
  } catch (error) {
    console.error("Asset deletion failed", error);
    return redirect("/admin?error=Could+not+remove+asset");
  }
}

function withAuth(
  request: Request,
  handler: () => Promise<Response> | Response,
  options?: { allowDuringPasswordReset?: boolean }
) {
  if (!isAuthenticated(request)) {
    return redirect("/admin?error=Please+login");
  }
  if (adminMustChangePassword() && !options?.allowDuringPasswordReset) {
    return redirect("/admin/password");
  }
  return handler();
}

function serveAdmin(request: Request, url: URL) {
  const error = url.searchParams.get("error") ?? undefined;
  const flash = url.searchParams.get("flash") ?? undefined;
  if (!isAuthenticated(request)) {
    return new Response(renderLogin(error ?? undefined), {
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }
  if (adminMustChangePassword()) {
    return redirect("/admin/password");
  }
  const html = renderAdmin(listVideosWithAssets(), flash ?? undefined);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function servePublic() {
  const html = renderPublic();
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function serveApi() {
  return jsonResponse({ videos: listVideosWithAssets() });
}

function notFound() {
  return new Response("Not Found", { status: 404 });
}

function pruneSessionsSafely() {
  try {
    pruneSessions();
  } catch (error) {
    console.error("Failed to prune sessions", error);
  }
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  fetch: async (request) => {
    pruneSessionsSafely();
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/" && request.method === "GET") {
      return servePublic();
    }

    if (pathname === "/api/videos" && request.method === "GET") {
      return serveApi();
    }

    if (pathname === "/admin" && request.method === "GET") {
      return serveAdmin(request, url);
    }

    if (pathname === "/admin/login" && request.method === "POST") {
      return handleLogin(request);
    }

    if (pathname === "/admin/password" && request.method === "GET") {
      return withAuth(
        request,
        () => servePasswordChange(url),
        { allowDuringPasswordReset: true }
      );
    }

    if (pathname === "/admin/password" && request.method === "POST") {
      return withAuth(
        request,
        () => handlePasswordChange(request),
        { allowDuringPasswordReset: true }
      );
    }

    if (pathname === "/admin/logout" && request.method === "POST") {
      return withAuth(
        request,
        () => handleLogout(request),
        { allowDuringPasswordReset: true }
      );
    }

    if (pathname === "/healthz") {
      return new Response("ok");
    }

    const videoUpdateMatch = pathname.match(/^\/admin\/videos\/(\d+)$/);
    if (videoUpdateMatch && request.method === "POST") {
      const videoId = Number(videoUpdateMatch[1]);
      return withAuth(request, () => handleUpdateVideo(request, videoId));
    }

    const videoDeleteMatch = pathname.match(/^\/admin\/videos\/(\d+)\/delete$/);
    if (videoDeleteMatch && request.method === "POST") {
      const videoId = Number(videoDeleteMatch[1]);
      return withAuth(request, () => handleDeleteVideo(videoId));
    }

    const videoAssetMatch = pathname.match(/^\/admin\/videos\/(\d+)\/assets$/);
    if (videoAssetMatch && request.method === "POST") {
      const videoId = Number(videoAssetMatch[1]);
      return withAuth(request, () => handleCreateAsset(request, videoId));
    }

    const assetDeleteMatch = pathname.match(/^\/admin\/assets\/(\d+)\/delete$/);
    if (assetDeleteMatch && request.method === "POST") {
      const assetId = Number(assetDeleteMatch[1]);
      return withAuth(request, () => handleDeleteAsset(assetId));
    }

    if (pathname === "/admin/videos" && request.method === "POST") {
      return withAuth(request, () => handleCreateVideo(request));
    }

    return notFound();
  },
  error(error: Error) {
    console.error("Unhandled server error", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});

registerGracefulShutdown(server);

console.log(`▶ Download hub ready on http://${HOST}:${PORT} (env: ${Bun.env.NODE_ENV ?? "development"})`);

function registerGracefulShutdown(server: ReturnType<typeof Bun.serve>) {
  const shutdown = (signal: string) => {
    console.log(`Received ${signal}. Shutting down gracefully...`);
    try {
      server.stop(true);
    } catch (error) {
      console.error("Failed to stop server", error);
    }
    try {
      db.close();
    } catch (error) {
      console.error("Failed to close database connection", error);
    }
    process.exit(0);
  };

  ["SIGINT", "SIGTERM"].forEach((signal) => {
    process.on(signal, () => shutdown(signal));
  });
}
