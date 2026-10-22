/**
 * Functional check of the emitted page script and the settings panel against a
 * real Chromium media stack, driven over the DevTools Protocol.
 *
 * It serves the exact injection rows the plugin publishes, in the same order
 * the Desktop shell applies them, then asks the page whether the overlay
 * mounted, whether the clip reached HAVE_CURRENT_DATA through the plugin's
 * Range route, and whether the handover removes the layer. It also flips the
 * settings to every mode (video/image/web/game) and verifies each renders in
 * the overlay.
 *
 * This proves the plugin's own page script and byte service work in a browser.
 * It is not evidence that DSH loaded the plugin.
 *
 * Run: node tools/browser-check.mjs [path-to-chrome]
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { existsSync, mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BOOT_STYLE, bootScript } from "../lib/inject.js";
import { apply } from "../lib/index.js";
import { saveSettings } from "../lib/config.js";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const CHROME =
  process.argv.slice(2).find((arg) => !arg.startsWith("--")) ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
if (!existsSync(CHROME)) throw new Error(`chrome not found at ${CHROME}`);

/** Optional: `--shot=<path>` saves a PNG of the overlay mid-playback. */
const SHOT = process.argv.find((arg) => arg.startsWith("--shot="))?.slice("--shot=".length);

// ---------------------------------------------------------------- settings

// Isolate the settings file for the duration of the test.
const ISOLATE = mkdtempSync(join(tmpdir(), "dsh-boo550wt-browser-"));
process.env.DSH_HOME = ISOLATE;

// ---------------------------------------------------------------- page + rows

const rows = [];
apply(
  {
    webServer: { register: () => () => {} },
    effect: (fn) => fn(),
    on: (_event, handler) => {
      handler(rows);
      return () => {};
    },
    logger: () => ({ info() {} }),
  },
  {},
);
const styleRow = rows.find((row) => row.kind === "style");
const scriptRow = rows.find((row) => row.kind === "script" && row.placement === "body");
assert.ok(styleRow !== undefined && scriptRow !== undefined, "plugin published its rows");

/** The application itself: paints a boot card into #root, then hands over. */
const APP = `
  var root = document.getElementById("root");
  var card = document.createElement("div");
  card.setAttribute("data-dsh-boot", "");
  card.textContent = "Loading plugins…";
  root.appendChild(card);
  globalThis.__DSH_APP_MOUNTED__ = false;
  // The shell settles boot readiness right after it applies the injected rows.
  globalThis.__DSH_BOOT_READY__.resolve();
  globalThis.__DSH_BOOT_READY__.promise.then(function () {
    // Record what the overlay looked like at the moment the app took over.
    globalThis.__DSH_OVERLAY_AT_HANDOVER__ = globalThis.__DSH_BOOT_ANIMATION__ !== undefined;
    root.removeChild(card);
    globalThis.__DSH_APP_MOUNTED__ = true;
  });
`;

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>boot animation check</title>
<script>globalThis.__DSH_BOOT_READY__ = Promise.withResolvers()<\/script>
<style>${styleRow.text}</style>
</head><body><div id="root"></div>
<script>${scriptRow.text}<\/script>
<script>${APP}<\/script>
</body></html>`;

// ---------------------------------------------------------------- dev server

const route = { handler: null };
apply(
  {
    webServer: {
      register: (r) => {
        route.handler = r.handler;
        return () => {};
      },
    },
    effect: (fn) => fn(),
    on: () => () => {},
    logger: () => ({ info() {} }),
  },
  {},
);

const server = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
    return;
  }
  if (path === "/webpage.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><body style="margin:0;background:#102;color:#9fe8ff;display:flex;align-items:center;justify-content:center;height:100vh;font:24px sans-serif">BOOT WEB</body></html>`);
    return;
  }
  if (path.startsWith("/boot-animation")) {
    route.handler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------- chromium

const profile = await fs.mkdtemp(join(tmpdir(), "dsh-boo550wt-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--mute-audio",
    // Electron's default for the DSH shell: no gesture needed to start media.
    "--autoplay-policy=no-user-gesture-required",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,720",
    "about:blank",
  ],
  { stdio: "ignore" },
);

/** Read the port Chromium picked for the DevTools endpoint. */
async function devtoolsPort() {
  const file = join(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const [line] = (await fs.readFile(file, "utf8")).split("\n");
      if (line.trim() !== "") return Number(line.trim());
    } catch {
      /* not written yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("chromium never reported a DevTools port");
}

const port = await devtoolsPort();
let targets = [];
for (let attempt = 0; attempt < 100; attempt += 1) {
  targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  if (targets.some((t) => t.type === "page")) break;
  await new Promise((r) => setTimeout(r, 100));
}
const target = targets.find((t) => t.type === "page");
assert.ok(target !== undefined, "chromium exposed a page target");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await once(socket, "open");

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined && pending.has(message.id)) {
    const { settle, fail } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error !== undefined) fail(new Error(JSON.stringify(message.error)));
    else settle(message.result);
  }
});
/** Send one CDP command and await its result. */
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((settle, fail) => {
    pending.set(id, { settle, fail });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
/** Evaluate an expression in the page and return its value. */
async function evaluate(expression, awaitPromise = false) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.exception?.description ?? "page threw");
  }
  return result.result.value;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url: `${origin}/` });

const failures = [];
let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  FAIL ${name}: ${error.message}`);
  }
}

/** Poll the page until the expression is truthy, or give up. */
async function until(expression, budgetMs = 8000) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if (await evaluate(`Boolean(${expression})`)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

console.log(`chromium ${port} -> ${origin}`);
await check("the overlay is mounted before the application handover", async () => {
  assert.equal(
    await evaluate(`Boolean(document.getElementById("dsh-boo550wt-animation-layer"))`),
    true,
  );
});

const overlayState = await evaluate(`(function () {
  var layer = document.getElementById("dsh-boo550wt-animation-layer");
  var video = layer.querySelector("video");
  return {
    layerOpacity: getComputedStyle(layer).opacity,
    position: getComputedStyle(layer).position,
    inset: [getComputedStyle(layer).top, getComputedStyle(layer).left],
    videoSrc: video ? video.currentSrc : null,
    videoMuted: video ? video.muted : null,
    videoPaused: video ? video.paused : null,
    zIndex: layer.style.zIndex,
    locked: document.documentElement.classList.contains("dsh-boo550wt-animation-locked"),
    appMounted: globalThis.__DSH_APP_MOUNTED__,
    bootCardStillThere: document.querySelector("[data-dsh-boot]") !== null
  };
})()`);

await check("the overlay is a fixed, opaque, top-most layer", () => {
  assert.equal(overlayState.position, "fixed");
  assert.equal(overlayState.layerOpacity, "1");
  assert.equal(overlayState.zIndex, "2147483000");
  assert.deepEqual(overlayState.inset, ["0px", "0px"]);
});
await check("the page background is locked while the clip plays", () => {
  assert.equal(overlayState.locked, true);
});
await check("the video is requested through the plugin route", () => {
  assert.equal(overlayState.videoSrc, `${origin}/boot-animation/media/video`);
});
await check("the overlay was already up when the application took over", async () => {
  assert.equal(await until(`globalThis.__DSH_APP_MOUNTED__ === true`), true);
  assert.equal(
    await evaluate(`globalThis.__DSH_OVERLAY_AT_HANDOVER__`),
    true,
    "the app handover happened with the overlay mounted",
  );
});

const playing = await until(
  `(function () {
     var v = document.querySelector("#dsh-boo550wt-animation-layer video");
     return v !== null && v.readyState >= 2 && v.currentTime > 0.2;
   })()`,
  20000,
);
await check("chromium decodes the video through the Range route", () => {
  assert.equal(playing, true);
});

const media = await evaluate(`(function () {
  var v = document.querySelector("#dsh-boo550wt-animation-layer video");
  return { readyState: v.readyState, duration: v.duration, currentTime: v.currentTime, muted: v.muted, volume: v.volume, error: v.error === null ? null : v.error.code };
})()`);
await check("the media element reports a sane duration", () => {
  assert.equal(media.error, null);
  assert.ok(Math.abs(media.duration - 16.649) < 0.2, `duration ${media.duration}`);
  assert.ok(media.currentTime > 0.2);
});
await check("the clip plays with its own audio, not muted by default", () => {
  assert.equal(media.muted, false, "the video must not be muted: defaulting to muted is how the sound was lost");
  assert.ok(media.volume > 0, `volume ${media.volume}`);
});

// ------------------------------------------------------------ mode switching

async function switchMode(next) {
  await evaluate(
    `(function () {
       var skip = globalThis.__DSH_BOOT_ANIMATION__.skip;
       skip();
     })()`,
  );
  await until(`document.getElementById("dsh-boo550wt-animation-layer") === null`, 6000);
  await fetch(`${origin}/boot-animation/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(next),
  });
  await send("Page.reload", { ignoreCache: true });
  await until(`Boolean(document.getElementById("dsh-boo550wt-animation-layer"))`, 10000);
}

await check("image mode renders an <img> in the overlay", async () => {
  await switchMode({ mode: "image", durationMs: 50000 });
  const ok = await until(
    `(function () {
       var img = document.querySelector("#dsh-boo550wt-animation-layer img");
       return img !== null && img.complete && img.naturalWidth > 0;
     })()`,
    10000,
  );
  assert.equal(ok, true);
});

await check("web mode renders an <iframe> in the overlay", async () => {
  await switchMode({ mode: "web", webUrl: `${origin}/webpage.html` });
  const ok = await until(
    `(function () {
       var f = document.querySelector("#dsh-boo550wt-animation-layer iframe");
       return f !== null && f.getAttribute("src") !== null;
     })()`,
    10000,
  );
  assert.equal(ok, true);
});

await check("game mode renders the snake iframe", async () => {
  await switchMode({ mode: "game", game: "snake" });
  const ok = await until(
    `(function () {
       var f = document.querySelector("#dsh-boo550wt-animation-layer iframe");
       return f !== null && /game\\/snake/.test(f.getAttribute("src") || "");
     })()`,
    10000,
  );
  assert.equal(ok, true);
});

// Back to video mode and verify the skip/teardown flow.
await check("video mode after switching back", async () => {
  await switchMode({ mode: "video" });
  const ok = await until(
    `(function () {
       var v = document.querySelector("#dsh-boo550wt-animation-layer video");
       return v !== null && v.readyState >= 2;
     })()`,
    15000,
  );
  assert.equal(ok, true);
});

if (SHOT !== undefined) {
  await evaluate(
    `(function () {
       var v = document.querySelector("#dsh-boo550wt-animation-layer video");
       var t = Math.min(8, Math.max(0, (v.duration || 8) - 3));
       if (Math.abs(v.currentTime - t) < 0.3) return true;
       return new Promise(function (r) {
         v.addEventListener("seeked", function () { r(true); }, { once: true });
         setTimeout(function () { r(true); }, 4000);
         v.currentTime = t;
       });
     })()`,
    true,
  );
  await evaluate(
    `new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); })`,
    true,
  );
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const bytes = Buffer.from(shot.data, "base64");
  await fs.writeFile(resolve(SHOT), bytes);
  console.log(`  shot ${resolve(SHOT)}  (${(bytes.length / 1024).toFixed(0)} KiB)`);
}

// ---- teardown via the global skip, revealing the app ----
await evaluate(`globalThis.__DSH_BOOT_ANIMATION__.skip()`);
await check("skipping fades the layer out and releases the page", async () => {
  assert.equal(await until(`document.getElementById("dsh-boo550wt-animation-layer") === null`), true);
  assert.equal(await evaluate(`document.documentElement.classList.contains("dsh-boo550wt-animation-locked")`), false);
  assert.equal(await evaluate(`globalThis.__DSH_BOOT_ANIMATION__ === undefined`), true);
});
await check("the application is revealed once the overlay is gone", async () => {
  assert.equal(await until(`globalThis.__DSH_APP_MOUNTED__ === true`), true);
  assert.equal(await evaluate(`document.querySelector("[data-dsh-boot]") === null`), true);
});

// A second page load must mount a fresh overlay (idempotence guard).
await send("Page.navigate", { url: `${origin}/` });
await check("a reload mounts the overlay again", async () => {
  assert.equal(await until(`Boolean(document.getElementById("dsh-boo550wt-animation-layer"))`), true);
});

socket.close();
// Close the whole browser process tree, not just the launcher.
spawn("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
server.close();
await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
await fs.rm(ISOLATE, { recursive: true, force: true }).catch(() => {});

console.log(`\n${passed} checks passed${failures.length > 0 ? `, ${failures.length} failed: ${failures.join(", ")}` : ""}`);
if (failures.length > 0) process.exitCode = 1;
