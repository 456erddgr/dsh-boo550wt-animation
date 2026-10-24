/**
 * dsh-boo550wt-animation — Host half.
 *
 * A full-screen boot animation plays over the application while the Web UI
 * boots, and the shell is handed over only after it ends (or the viewer skips
 * it). What it shows is fully configurable from the Settings panel:
 *
 *   mode  "video"  play a video file (default: the bundled 550W clip)
 *   mode  "image"  show a picture for a fixed duration
 *   mode  "web"    embed a webpage full-screen
 *   mode  "game"   play a built-in mini game (snake)
 *
 * Routes owned by this plugin (all under /boot-animation):
 *
 *   /config          GET the current settings; PUT save new ones
 *   /media/video     stream the configured video with Range support
 *   /media/image     stream the configured image
 *   /media/web       embed a local webpage file
 *   /game/:id        serve a built-in mini game
 *
 * Two injection mechanisms:
 *
 *   1. `webserver/index-inject` rows (one `style`, one body `script`) that
 *      mount the overlay. The Desktop shell renders these rows in the page
 *      before `__DSH_BOOT_READY__` settles, i.e. before the client module
 *      loader starts, so the overlay is already up when the first application
 *      frame is painted. The script fetches /config at startup so the latest
 *      user settings apply on every boot.
 *   2. A client module (`dsh.client`) that adds a "开机动画" section to the
 *      Settings panel and edits the same /config endpoint.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";

import { BOOT_STYLE, bootScript, previewDocument } from "./inject.js";
import { serveFile, VIDEO_ROUTE, IMAGE_ROUTE, WEB_ROUTE } from "./media.js";
import { serveGame } from "./games.js";
import { handleRemove, handleUpload, listUploads, resolveUpload } from "./upload.js";
import {
  BUNDLED_IMAGE,
  BUNDLED_VIDEO,
  DEFAULTS,
  configPath,
  effectiveMaxSeconds,
  loadSettings,
  saveSettings,
  mediaSpec,
  normalizeConfig,
  publicSettings,
} from "./config.js";

/** Route base owned by this plugin; must stay unique across the profile. */
const BASE = "/boot-animation";

/** Wait for the profile's webserver before claiming the route. */
export const inject = ["webServer"];

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
 * Claim the routes, publish the injection rows, and report readiness.
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx
 * @param {object} [config]
 */
export function apply(ctx, config) {
  const defaults = normalizeConfig(config);
  if (defaults.enabled === false) {
    ctx.logger?.("boot-animation").info?.("disabled by config");
    return;
  }

  const logger = ctx.logger?.("boot-animation");

  /** Answer the plugin's own subpaths; anything else is not ours. */
  const handler = async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;

    if (path === `${BASE}/config`) {
      if (req.method === "GET" || req.method === "HEAD") {
        const settings = await loadSettings();
        sendJson(res, 200, publicSettings(settings));
        return;
      }
      if (req.method === "POST" || req.method === "PUT") {
        let raw;
        try {
          raw = await readJson(req);
        } catch {
          sendJson(res, 400, { error: "invalid JSON body" });
          return;
        }
        const next = normalizeConfig({ ...defaults, ...raw });
        const saved = await saveSettings(next);
        sendJson(res, saved ? 200 : 500, saved ? publicSettings(next) : { error: "could not save settings" });
        return;
      }
      res.writeHead(405, { allow: "GET, HEAD, POST, PUT", "cache-control": "no-store" });
      res.end();
      return;
    }

    const settings = await loadSettings();
    const spec = mediaSpec(settings);

    if (path === `${BASE}${VIDEO_ROUTE}`) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD", "cache-control": "no-store" });
        res.end();
        return;
      }
      const file = spec.kind === "video" ? spec.file : BUNDLED_VIDEO;
      await serveFile(file, req, res);
      return;
    }

    if (path === `${BASE}${IMAGE_ROUTE}`) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD", "cache-control": "no-store" });
        res.end();
        return;
      }
      const file = spec.kind === "image" ? spec.file : BUNDLED_IMAGE;
      await serveFile(file, req, res);
      return;
    }

    if (path === `${BASE}${WEB_ROUTE}`) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD", "cache-control": "no-store" });
        res.end();
        return;
      }
      if (spec.kind !== "web-local") {
        res.writeHead(404, { "cache-control": "no-store" });
        res.end();
        return;
      }
      await serveFile(spec.file, req, res, "text/html; charset=utf-8");
      return;
    }

    if (path === `${BASE}/uploads`) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD", "cache-control": "no-store" });
        res.end();
        return;
      }
      sendJson(res, 200, { uploads: listUploads() });
      return;
    }

    if (path === `${BASE}/upload`) {
      handleUpload(req, res);
      return;
    }

    if (path === `${BASE}/upload-remove`) {
      handleRemove(req, res);
      return;
    }

    if (path.startsWith(`${BASE}/uploads/`)) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD", "cache-control": "no-store" });
        res.end();
        return;
      }
      const name = decodeURIComponent(path.slice(`${BASE}/uploads/`.length));
      const file = resolveUpload(name);
      if (file === null) {
        res.writeHead(404, { "cache-control": "no-store" });
        res.end();
        return;
      }
      const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
      await serveFile(file, req, res, ext === "html" ? "text/html; charset=utf-8" : undefined);
      return;
    }

    if (path === `${BASE}/preview`) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD", "cache-control": "no-store" });
        res.end();
        return;
      }
      // The candidate settings travel in the query so the preview shows exactly
      // what is on screen, without saving it or disturbing the next boot.
      let candidate = null;
      const raw = url.searchParams.get("c");
      if (typeof raw === "string" && raw !== "") {
        try {
          const json = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
          candidate = JSON.parse(json);
        } catch {
          candidate = null;
        }
      }
      const settings = normalizeConfig({ ...defaults, ...(candidate ?? {}) });
      const spec = mediaSpec(settings);
      const html = previewDocument({
        base: BASE,
        mode: settings.mode,
        url: spec.url,
        durationMs: settings.durationMs,
        zIndex: settings.zIndex,
        skipHint: settings.skipHint,
        silentHint: settings.silentHint,
        blockedHint: settings.blockedHint,
        errorHint: settings.errorHint,
        hintDelayMs: settings.hintDelayMs,
        maxSeconds: effectiveMaxSeconds(settings),
        graceMs: 1500,
        fadeMs: settings.fadeMs,
        sound: settings.sound,
        mutedFallback: settings.mutedFallback,
      });
      const body = Buffer.from(html, "utf8");
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(body.length),
        "cache-control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }

    if (path.startsWith(`${BASE}/game/`)) {
      // `/game/<id>` opens the game; anything after it is one of its own files
      // (the 3D scene ships scripts, styles and textures of its own).
      const rest = path.slice(`${BASE}/game/`.length);
      const slash = rest.indexOf("/");
      const game = decodeURIComponent(slash < 0 ? rest : rest.slice(0, slash));
      const sub = slash < 0 ? "" : rest.slice(slash);
      await serveGame(game, req, res, sub);
      return;
    }

    res.writeHead(404, { "cache-control": "no-store" });
    res.end();
  };

  const disposers = [];
  disposers.push(
    ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: BASE, handler }), "boot-animation: routes"),
  );

  ctx.on("webserver/index-inject", (table) => {
    table.push({ kind: "style", text: BOOT_STYLE });
    table.push({
      kind: "script",
      placement: "body",
      text: bootScript({
        base: BASE,
        mode: defaults.mode,
        // The script reads the live settings itself via /config, so the
        // injected row only carries the default mode as a first paint hint.
        url: `${BASE}${VIDEO_ROUTE}`,
        durationMs: defaults.durationMs,
        zIndex: defaults.zIndex,
        skipHint: defaults.skipHint,
        silentHint: defaults.silentHint,
        blockedHint: defaults.blockedHint,
        errorHint: defaults.errorHint,
        hintDelayMs: defaults.hintDelayMs,
        maxSeconds: effectiveMaxSeconds(defaults),
        graceMs: 1500,
        fadeMs: defaults.fadeMs,
        sound: defaults.sound,
        mutedFallback: defaults.mutedFallback,
      }),
    });
  });

  logger?.info?.(
    `boot animation ready (config ${configPath()}; media ${JSON.stringify(mediaSpec(defaults))})`,
  );

  return () => {
    for (const dispose of disposers) dispose();
  };
}

/** Read the request body as JSON. */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}
