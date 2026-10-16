/**
 * dsh-boot-animation — Host half.
 *
 * A full-screen video plays over the application while the Web UI boots, and
 * the shell is handed over only after the clip ends (or the viewer skips it).
 *
 * Two mechanisms, both owned by this file:
 *
 *   1. `webserver/index-inject` rows (one `style`, one body `script`) that
 *      mount the overlay. The Desktop shell renders these rows in the page
 *      before `__DSH_BOOT_READY__` settles, i.e. before the client module
 *      loader starts, so the overlay is already up when the first application
 *      frame is painted.
 *   2. A same-origin `prefix` route that streams the clip with `Range`
 *      support, so the browser's own media stack does the decoding.
 *
 * The Host half is the whole plugin: no client module, no build step.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BOOT_STYLE, bootScript } from "./inject.js";
import { serveVideo, STATE_ROUTE, VIDEO_ROUTE } from "./media.js";

/** Route base owned by this plugin; must stay unique across the profile. */
const BASE = "/boot-animation";

/** Wait for the profile's webserver before claiming the route. */
export const inject = ["webServer"];

/** Directory holding this module, used to locate the bundled clip. */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** The clip shipped inside the package. */
const BUNDLED_VIDEO = resolve(MODULE_DIR, "..", "assets", "boot.mp4");

/** Defaults for every configurable field. */
const DEFAULTS = Object.freeze({
  enabled: true,
  videoPath: "",
  zIndex: 2147483000,
  maxSeconds: 120,
  graceMs: 1500,
  fadeMs: 380,
  hintDelayMs: 4000,
  skipHint: "按 Esc 跳过",
  silentHint: "按 Esc 跳过 · 点击开启声音",
  blockedHint: "点击以播放开机动画",
  errorHint: "开机动画不可用",
});

/** Merge user config onto the defaults, rejecting unusable values. */
function resolveConfig(config) {
  const input = config !== null && typeof config === "object" ? config : {};
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (input[key] === undefined || input[key] === null) continue;
    out[key] = key === "enabled" ? input[key] === true : input[key];
  }
  if (typeof out.videoPath !== "string") out.videoPath = DEFAULTS.videoPath;
  if (!Number.isFinite(out.zIndex)) out.zIndex = DEFAULTS.zIndex;
  return out;
}

/** Standard JSON response. */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(payload)),
    "cache-control": "no-store",
  });
  res.end(payload);
}

/**
 * Claim the route, publish the injection rows, and report readiness.
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx
 * @param {object} [config]
 */
export function apply(ctx, config) {
  const settings = resolveConfig(config);
  if (!settings.enabled) {
    ctx.logger?.("boot-animation").info?.("disabled by config");
    return;
  }

  const video = settings.videoPath === "" ? BUNDLED_VIDEO : resolve(settings.videoPath);
  const logger = ctx.logger?.("boot-animation");

  /** Answer the plugin's own subpaths; anything else is not ours. */
  const handler = async (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === `${BASE}${VIDEO_ROUTE}`) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD", "cache-control": "no-store" });
        res.end();
        return;
      }
      await serveVideo(video, req, res);
      return;
    }
    if (path === `${BASE}${STATE_ROUTE}` && (req.method === "GET" || req.method === "HEAD")) {
      let stat = null;
      try {
        const { promises: fs } = await import("node:fs");
        stat = await fs.stat(video);
      } catch {
        stat = null;
      }
      sendJson(res, 200, {
        plugin: "dsh-boot-animation",
        base: BASE,
        video,
        videoAvailable: stat !== null && stat.isFile(),
        videoBytes: stat !== null && stat.isFile() ? stat.size : null,
        settings,
      });
      return;
    }
    res.writeHead(404, { "cache-control": "no-store" });
    res.end();
  };

  const disposers = [];
  disposers.push(ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: BASE, handler }), "boot-animation: clip route"));

  ctx.on("webserver/index-inject", (table) => {
    table.push({ kind: "style", text: BOOT_STYLE });
    table.push({
      kind: "script",
      placement: "body",
      text: bootScript({
        src: `${BASE}${VIDEO_ROUTE}`,
        zIndex: settings.zIndex,
        skipHint: settings.skipHint,
        silentHint: settings.silentHint,
        blockedHint: settings.blockedHint,
        errorHint: settings.errorHint,
        hintDelayMs: settings.hintDelayMs,
        maxSeconds: settings.maxSeconds,
        graceMs: settings.graceMs,
        fadeMs: settings.fadeMs,
      }),
    });
  });

  logger?.info?.(`playing ${video} over the boot screen at ${BASE}${VIDEO_ROUTE}`);

  return () => {
    for (const dispose of disposers) dispose();
  };
}
