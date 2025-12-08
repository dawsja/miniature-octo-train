import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

type VideoRecord = {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  video_url: string | null;
  tags: string | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
};

export type AssetRecord = {
  id: number;
  video_id: number;
  label: string;
  url: string;
  sort_order: number;
};

export type SessionRecord = {
  id: string;
  created_at: string;
  expires_at: string;
  ip_address: string | null;
  user_agent: string | null;
};

export type AdminUserRecord = {
  username: string;
  password_hash: string;
  salt: string;
  must_change_password: number;
  updated_at: string;
};

const dataDir = Bun.env.DATA_DIR ?? join(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });
const dbPath = join(dataDir, Bun.env.DATABASE_FILE ?? "downloads.db");

export const db = new Database(dbPath, { create: true });

db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  video_url TEXT,
  tags TEXT,
  thumbnail_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS admin_users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

type SeedAsset = Pick<AssetRecord, "label" | "url">;
type SeedVideo = {
  title: string;
  slug: string;
  description: string;
  video_url: string;
  thumbnail_url: string;
  tags: string[];
  assets: SeedAsset[];
};

const defaultSeed: SeedVideo[] = [
  {
    title: "Vaultwarden Self-Host Guide",
    slug: "vaultwarden",
    description:
      "Step-by-step deployment of Vaultwarden (Bitwarden) with Docker Compose.",
    video_url: "https://youtu.be/vaultwarden-demo",
    thumbnail_url: "https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?w=800",
    tags: ["passwords", "security", "docker"],
    assets: [
      {
        label: "docker-compose.yml",
        url: "https://example.com/vaultwarden/docker-compose.yml"
      },
      {
        label: ".env sample",
        url: "https://example.com/vaultwarden/.env"
      }
    ]
  },
  {
    title: "Nginx Proxy Manager Setup",
    slug: "npm",
    description: "Reverse proxy everything on your homelab in under 15 minutes.",
    video_url: "https://youtu.be/nginx-proxy-demo",
    thumbnail_url: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800",
    tags: ["reverse-proxy", "ssl", "docker"],
    assets: [
      {
        label: "docker-compose.yml",
        url: "https://example.com/nginxproxymanager/docker-compose.yml"
      },
      {
        label: "acl.conf",
        url: "https://example.com/nginxproxymanager/acl.conf"
      }
    ]
  },
  {
    title: "Jellyfin Media Server",
    slug: "jellyfin",
    description: "Host your own streaming service powered by Jellyfin.",
    video_url: "https://youtu.be/jellyfin-demo",
    thumbnail_url: "https://images.unsplash.com/photo-1489515217757-5fd1be406fef?w=800",
    tags: ["media", "docker", "streaming"],
    assets: [
      {
        label: "docker-compose.yml",
        url: "https://example.com/jellyfin/docker-compose.yml"
      },
      {
        label: "traefik.yml",
        url: "https://example.com/jellyfin/traefik.yml"
      }
    ]
  }
];

export function seedIfEmpty() {
  const row = db.query("SELECT COUNT(*) as count FROM videos").get() as { count: number };
  if (row.count > 0) {
    return;
  }

  const insertVideo = db.prepare(`
    INSERT INTO videos (title, slug, description, video_url, thumbnail_url, tags)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertAsset = db.prepare(`
    INSERT INTO assets (video_id, label, url, sort_order)
    VALUES (?, ?, ?, ?)
  `);

  for (const video of defaultSeed) {
    const info = insertVideo.run(
      video.title,
      video.slug,
      video.description,
      video.video_url,
      video.thumbnail_url,
      JSON.stringify(video.tags)
    );
    const videoId = Number(info.lastInsertRowid);

    video.assets.forEach((asset, index) => {
      insertAsset.run(videoId, asset.label, asset.url, index);
    });
  }
}

export type VideoWithAssets = Omit<VideoRecord, "tags"> & {
  tags: string[];
  assets: AssetRecord[];
};

function parseTags(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed.filter((t) => typeof t === "string") as string[]) : [];
  } catch {
    return value.split(",").map((t) => t.trim()).filter(Boolean);
  }
}

export function listVideosWithAssets(): VideoWithAssets[] {
  const videos = db.query("SELECT * FROM videos ORDER BY created_at DESC").all() as VideoRecord[];

  const assets = db
    .query("SELECT * FROM assets ORDER BY sort_order ASC, id ASC")
    .all() as AssetRecord[];

  return videos.map((video) => ({
    ...video,
    tags: parseTags(video.tags),
    assets: assets.filter((asset) => asset.video_id === video.id)
  }));
}

export function createVideo(data: {
  title: string;
  slug: string;
  description?: string;
  video_url?: string;
  thumbnail_url?: string;
  tags?: string[];
}): number {
  const info = db
    .prepare(`
      INSERT INTO videos (title, slug, description, video_url, thumbnail_url, tags)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      data.title,
      data.slug,
      data.description ?? null,
      data.video_url ?? null,
      data.thumbnail_url ?? null,
      data.tags ? JSON.stringify(data.tags) : null
    );
  return Number(info.lastInsertRowid);
}

export function updateVideo(id: number, data: {
  title: string;
  description?: string;
  video_url?: string;
  thumbnail_url?: string;
  tags?: string[];
}) {
  db.prepare(`
      UPDATE videos
         SET title = ?,
             description = ?,
             video_url = ?,
             thumbnail_url = ?,
             tags = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `)
    .run(
      data.title,
      data.description ?? null,
      data.video_url ?? null,
      data.thumbnail_url ?? null,
      data.tags ? JSON.stringify(data.tags) : null,
      id
    );
}

export function deleteVideo(id: number) {
  db.prepare("DELETE FROM videos WHERE id = ?").run(id);
}

export function createAsset(videoId: number, asset: { label: string; url: string; sort_order?: number }) {
  db.prepare(`
      INSERT INTO assets (video_id, label, url, sort_order)
      VALUES (?, ?, ?, COALESCE(?, 0))
    `)
    .run(videoId, asset.label, asset.url, asset.sort_order ?? 0);
}

export function deleteAsset(id: number) {
  db.prepare("DELETE FROM assets WHERE id = ?").run(id);
}

export function listAssetsByVideo(videoId: number): AssetRecord[] {
  return db
    .prepare("SELECT * FROM assets WHERE video_id = ? ORDER BY sort_order ASC")
    .all(videoId) as AssetRecord[];
}

export function createSession(data: { id: string; expiresAt: string; ip?: string; userAgent?: string }) {
  db.prepare(`
      INSERT INTO sessions (id, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?)
    `)
    .run(data.id, data.expiresAt, data.ip ?? null, data.userAgent ?? null);
}

export function findSession(id: string): SessionRecord | null {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRecord | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    deleteSession(id);
    return null;
  }
  return row;
}

export function deleteSession(id: string) {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function pruneSessions() {
  db.exec("DELETE FROM sessions WHERE expires_at < datetime('now')");
}

export function getAdminUser(username: string): AdminUserRecord | null {
  const row = db.prepare("SELECT * FROM admin_users WHERE username = ?").get(username) as AdminUserRecord | undefined;
  return row ?? null;
}

export function ensureAdminUser(username: string, passwordHash: string, salt: string) {
  const existing = getAdminUser(username);
  if (existing) {
    return;
  }

  db.prepare(
    `
    INSERT INTO admin_users (username, password_hash, salt, must_change_password)
    VALUES (?, ?, ?, 1)
  `
  ).run(username, passwordHash, salt);
}

export function updateAdminPassword(username: string, passwordHash: string, salt: string, forceRotate = false) {
  db.prepare(
    `
    INSERT INTO admin_users (username, password_hash, salt, must_change_password, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(username) DO UPDATE SET
      password_hash = excluded.password_hash,
      salt = excluded.salt,
      must_change_password = excluded.must_change_password,
      updated_at = CURRENT_TIMESTAMP
  `
  ).run(username, passwordHash, salt, forceRotate ? 1 : 0);
}
