import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type BrandingConfig = {
  siteName: string;
  metaDescription: string;
  public: {
    heroTitle: string;
    heroDescription: string;
    searchPlaceholder: string;
    emptyStateMessage: string;
    cardCtaLabel: string;
    footerText: string;
  };
  login: {
    heroTitle: string;
    heroDescription: string;
    defaultCredentialsHeading: string;
    defaultCredentialsHelper: string;
  };
  admin: {
    navLabel: string;
    heroTitle: string;
    heroDescription: string;
    newPackTitle: string;
    newPackDescription: string;
  };
  password: {
    setupTitle: string;
    setupDescription: string;
    changeTitle: string;
    changeDescription: string;
    helperText: string;
  };
};

export type AdminDefaults = {
  defaultUsername: string;
  defaultPassword: string;
};

export type AppConfig = {
  admin: AdminDefaults;
  branding: BrandingConfig;
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const defaultConfig: AppConfig = {
  admin: {
    defaultUsername: "creator",
    defaultPassword: "changeme"
  },
  branding: {
    siteName: "Dawson's Resource Hub",
    metaDescription: "Centralized download links for docker compose files from the channel.",
    public: {
      heroTitle: "Download packs for every tutorial.",
      heroDescription:
        "Every docker-compose, env template, and helper file from the channel in one place. Search, download, and plug the resources into any deployment workflow.",
      searchPlaceholder: "Search guides, tags, services...",
      emptyStateMessage: "No download packs yet. Check back soon!",
      cardCtaLabel: "Watch Tutorial →",
      footerText: "© {{year}} Dawson's Resource Hub • Crafted with Bun + SQLite"
    },
    login: {
      heroTitle: "Dawson's Resource Hub",
      heroDescription:
        "Sign in to curate download packs and keep files in sync with every Dawson tutorial.",
      defaultCredentialsHeading: "First time setup",
      defaultCredentialsHelper:
        "Use default credentials to log in, then you'll set your own password."
    },
    admin: {
      navLabel: "Dawson's Resource Hub",
      heroTitle: "Keep your download hub fresh.",
      heroDescription: "Update docker-compose files and resources the moment your videos drop.",
      newPackTitle: "Add new video pack",
      newPackDescription:
        "Paste the tutorial details, then attach inline snippets or external download links."
    },
    password: {
      setupTitle: "Set up your password",
      setupDescription:
        "Welcome! Before you can manage resources, please set a secure password for your admin account.",
      changeTitle: "Change password",
      changeDescription: "Use a strong password to protect the resource hub.",
      helperText: "Use a phrase you'll only use here."
    }
  }
};

function loadUserConfig(): DeepPartial<AppConfig> | null {
  const explicitPath = Bun.env.RESOURCE_HUB_CONFIG_PATH?.trim();
  if (explicitPath) {
    const resolved = resolvePath(explicitPath);
    if (!existsSync(resolved)) {
      console.warn(`RESOURCE_HUB_CONFIG_PATH set to ${resolved}, but file not found.`);
      return null;
    }
    return parseConfig(resolved);
  }

  const fallback = resolve(process.cwd(), "resource-hub.config.json");
  if (!existsSync(fallback)) {
    return null;
  }
  return parseConfig(fallback);
}

function resolvePath(target: string) {
  return isAbsolute(target) ? target : resolve(process.cwd(), target);
}

function parseConfig(path: string): DeepPartial<AppConfig> | null {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as DeepPartial<AppConfig>;
    console.log(`Loaded resource hub customization from ${path}`);
    return parsed;
  } catch (error) {
    console.error(`Failed to parse config at ${path}:`, error);
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeConfig(base: AppConfig, overrides: DeepPartial<AppConfig> | null): AppConfig {
  if (!overrides) {
    return base;
  }
  const clone = JSON.parse(JSON.stringify(base)) as AppConfig;
  applyOverrides(clone, overrides);
  return clone;
}

function applyOverrides(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const current = target[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      applyOverrides(current, value);
      continue;
    }
    target[key] = value;
  }
}

const merged = mergeConfig(defaultConfig, loadUserConfig());

const envUsername = Bun.env.ADMIN_USERNAME?.trim();
const envPassword = Bun.env.ADMIN_PASSWORD?.trim();

export const appConfig: AppConfig = {
  ...merged,
  admin: {
    defaultUsername: envUsername && envUsername.length > 0 ? envUsername : merged.admin.defaultUsername,
    defaultPassword: envPassword && envPassword.length > 0 ? envPassword : merged.admin.defaultPassword
  }
};

export const branding = appConfig.branding;
export const adminDefaults = appConfig.admin;

export function formatBrandingText(input: string, tokens: Record<string, string> = {}) {
  const appliedTokens = {
    siteName: branding.siteName,
    year: String(new Date().getFullYear()),
    ...tokens
  };

  return Object.entries(appliedTokens).reduce((acc, [key, value]) => {
    const pattern = new RegExp(`{{\\s*${key}\\s*}}`, "gi");
    return acc.replace(pattern, value);
  }, input);
}
