/**
 * dsh-boo550wt-animation — persisted boot-animation settings.
 *
 * The user can pick what the boot animation shows:
 *
 *   mode  "video"  play a video file (default: the bundled 550W clip)
 *   mode  "image"  show a picture for a fixed duration
 *   mode  "web"    embed a webpage full-screen
 *   mode  "game"   play a built-in mini game (default: snake)
 *
 * Settings live in one JSON file under the DSH home directory so the Host
 * half can read them at boot time, the browser half can read them at page
 * load, and the settings panel can write them at any time. No host service
 * beyond the plugin's own route is involved.
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(MODULE_DIR, "..");

/** Built-in assets shipped inside the package. */
export const BUNDLED_VIDEO = resolve(PACKAGE_ROOT, "assets", "boot.mp4");
export const BUNDLED_IMAGE = resolve(PACKAGE_ROOT, "assets", "poster.png");

/** Where the user-editable settings file lives. */
export function configPath() {
  const home = process.env.DSH_HOME?.trim() || homedir();
  return join(home, "boot-animation-settings.json");
}

/** Defaults for every configurable field. */
export const DEFAULTS = Object.freeze({
  enabled: true,
  /** video | image | web | game */
  mode: "video",
  /** Absolute path to a video; empty means the bundled clip. */
  videoPath: "",
  /** Absolute path to a picture; empty means the bundled poster. */
  imagePath: "",
  /** URL or local file path for mode "web". */
  webUrl: "",
  /** Built-in mini game id for mode "game". */
  game: "snake",
  /** Soft display time (ms) for image / web / game modes. */
  durationMs: 16000,
  /** Hard ceiling (seconds): never trap the window. */
  maxSeconds: 120,
  fadeMs: 380,
  hintDelayMs: 4000,
  zIndex: 2147483000,
  skipHint: "按 Esc 跳过",
  silentHint: "按 Esc 跳过 · 点击开启声音",
  blockedHint: "点击以播放开机动画",
  errorHint: "开机动画不可用",
});

const GAMES = new Set(["snake"]);
export const GAME_IDS = [...GAMES];

/** Coerce a raw config object into a safe settings object. */
export function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === "object" ? raw : {};
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (input[key] === undefined || input[key] === null) continue;
    out[key] = input[key];
  }
  if (typeof out.enabled !== "boolean") out.enabled = DEFAULTS.enabled;
  if (typeof out.mode !== "string" || !["video", "image", "web", "game"].includes(out.mode)) {
    out.mode = DEFAULTS.mode;
  }
  for (const key of ["videoPath", "imagePath", "webUrl", "skipHint", "silentHint", "blockedHint", "errorHint"]) {
    if (typeof out[key] !== "string") out[key] = DEFAULTS[key];
  }
  if (typeof out.game !== "string" || !GAMES.has(out.game)) out.game = DEFAULTS.game;
  for (const key of ["durationMs", "maxSeconds", "fadeMs", "hintDelayMs", "zIndex"]) {
    const n = Number(out[key]);
    out[key] = Number.isFinite(n) ? Math.max(0, n) : DEFAULTS[key];
  }
  out.durationMs = Math.max(1000, Math.min(out.durationMs, 600000));
  out.maxSeconds = Math.max(2, Math.min(out.maxSeconds, 600));
  out.fadeMs = Math.max(0, Math.min(out.fadeMs, 3000));
  return out;
}

/** Absolute path a media setting must resolve to, or null when invalid. */
function resolveMediaPath(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const absolute = isAbsolute(value) ? value : resolve(process.cwd(), value);
  return absolute;
}

/**
 * The media entry the browser half should load for the current settings.
 * Everything the browser asks for is served from this plugin's own route, so
 * file paths never leak into the page.
 */
export function mediaSpec(settings) {
  switch (settings.mode) {
    case "video": {
      const file = resolveMediaPath(settings.videoPath) ?? BUNDLED_VIDEO;
      return { kind: "video", file, url: "/boot-animation/media/video", contentType: "video/mp4" };
    }
    case "image": {
      const file = resolveMediaPath(settings.imagePath) ?? BUNDLED_IMAGE;
      return { kind: "image", file, url: "/boot-animation/media/image", contentType: null };
    }
    case "web": {
      const raw = settings.webUrl;
      if (typeof raw !== "string" || raw.trim() === "") {
        return { kind: "game", game: settings.game, url: `/boot-animation/game/${encodeURIComponent(settings.game)}`, contentType: null };
      }
      const trimmed = raw.trim();
      const local = resolveMediaPath(trimmed);
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
        return { kind: "web", url: trimmed, contentType: null };
      }
      if (local !== null) return { kind: "web-local", file: local, url: `/boot-animation/media/web`, contentType: null };
      return { kind: "game", game: settings.game, url: `/boot-animation/game/${encodeURIComponent(settings.game)}`, contentType: null };
    }
    case "game":
    default:
      return { kind: "game", game: settings.game, url: `/boot-animation/game/${encodeURIComponent(settings.game)}`, contentType: null };
  }
}

/** Read the saved settings, falling back to defaults. */
export async function loadSettings() {
  const file = configPath();
  try {
    const text = await fs.readFile(file, "utf8");
    return normalizeConfig(JSON.parse(text));
  } catch {
    return normalizeConfig(null);
  }
}

/** Persist settings atomically. Returns true on success. */
export async function saveSettings(settings) {
  const file = configPath();
  const payload = JSON.stringify(normalizeConfig(settings), null, 2);
  try {
    await fs.mkdir(dirname(file), { recursive: true });
    const temp = `${file}.tmp-${process.pid}`;
    await fs.writeFile(temp, payload, "utf8");
    await fs.rename(temp, file);
    return true;
  } catch {
    return false;
  }
}

/** Public view of the settings for the /config route and the settings panel. */
export function publicSettings(settings) {
  const spec = mediaSpec(settings);
  return {
    ...settings,
    media: spec,
    configFile: configPath(),
    builtinVideo: BUNDLED_VIDEO,
    builtinImage: BUNDLED_IMAGE,
  };
}
