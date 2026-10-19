/**
 * Grab presentation frames out of the bundled clip with a real Chromium media
 * stack, over the DevTools Protocol — no ffmpeg on this machine, so the browser
 * that actually plays the clip is the one that renders the stills.
 *
 * Two modes:
 *   node tools/stills.mjs <outDir> frames <t1> <t2> ...   one PNG per timestamp
 *   node tools/stills.mjs <outDir> sheet [cols] [rows]    one contact sheet
 *
 * <outDir> must be an existing directory. Timestamps are seconds.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { existsSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serveVideo } from "../lib/media.js";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const CLIP = resolve(ROOT, "assets", "boot.mp4");
const CHROME = process.env.DSH_CHROME ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const outDir = resolve(process.argv[2] ?? ".");
const mode = process.argv[3] ?? "frames";
if (!existsSync(CLIP)) throw new Error(`clip not found at ${CLIP}`);
if (!existsSync(CHROME)) throw new Error(`chrome not found at ${CHROME}`);
await fs.mkdir(outDir, { recursive: true });

const cols = mode === "sheet" ? Number(process.argv[4] ?? 2) : 1;
const rows = mode === "sheet" ? Number(process.argv[5] ?? 2) : 1;
const times =
  mode === "frames"
    ? process.argv.slice(4).map(Number)
    : Array.from({ length: cols * rows }, (_, i) => Number(process.argv[6 + i] ?? 0));
if (times.some((t) => !Number.isFinite(t))) throw new Error("timestamps must be numbers");

const VIEW_W = Number(process.env.DSH_STILLS_W ?? 1280);
const VIEW_H = Number(process.env.DSH_STILLS_H ?? 720);

// ------------------------------------------------------------------- server

const clips = new Map();
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
    return;
  }
  if (path === "/video.mp4") {
    await serveVideo(CLIP, req, res);
    return;
  }
  res.writeHead(404);
  res.end();
});

const cellOf = (t, i) => `<figure data-i="${i}">
      <video class="clip" muted playsinline preload="auto" src="/video.mp4?cell=${i}"></video>
      ${mode === "sheet" ? `<figcaption>${t.toFixed(1)}s</figcaption>` : ""}
    </figure>`;

const cells =
  mode === "sheet"
    ? times.map(cellOf).join("\n")
    : cellOf(times[0] ?? 0, 0);

const PAGE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>stills</title>
<style>
  html,body{margin:0;padding:0;background:#000;overflow:hidden}
  body{display:grid;grid-template-columns:repeat(${cols},1fr);
       grid-template-rows:repeat(${rows},1fr);width:${VIEW_W}px;height:${VIEW_H}px}
  figure{position:relative;margin:0;overflow:hidden;background:#000}
  video{display:block;width:100%;height:100%;object-fit:contain;background:#000}
  figcaption{position:absolute;left:10px;bottom:8px;margin:0;
    font:600 13px/1.4 ui-monospace,Consolas,monospace;color:#9fe8ff;
    background:rgba(0,0,0,.55);padding:2px 7px;border-radius:4px}
</style></head><body>
${cells}
</body></html>`;

server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;

// ----------------------------------------------------------------- chromium

const profile = await fs.mkdtemp(join(tmpdir(), "dsh-boo550wt-stills-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--mute-audio",
    "--autoplay-policy=no-user-gesture-required",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    `--window-size=${VIEW_W},${VIEW_H}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

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
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((settle, fail) => {
    pending.set(id, { settle, fail });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
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
  width: VIEW_W,
  height: VIEW_H,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url: `${origin}/` });

// Wait until every cell has metadata, then seek each one and settle on a frame.
const ready = await evaluate(
  `Promise.all(Array.from(document.querySelectorAll("video")).map(function (v) {
     return v.readyState >= 1
       ? Promise.resolve(true)
       : new Promise(function (r) { v.addEventListener("loadedmetadata", function () { r(true); }, { once: true });
                                   setTimeout(function () { r(v.readyState >= 1); }, 15000); });
   })).then(function (all) { return all.every(Boolean); })`,
  true,
);
assert.equal(ready, true, "every cell loaded metadata");

/** Seek cell `i` to `t` seconds and wait until the browser has presented it. */
async function seek(i, t) {
  const settled = await evaluate(
    `(function (i, t) {
       var v = document.querySelectorAll("video")[i];
       return new Promise(function (done) {
         var finish = function () {
           requestAnimationFrame(function () {
             requestAnimationFrame(function () { done({ t: v.currentTime, rs: v.readyState }); });
           });
         };
         if (Math.abs(v.currentTime - t) < 0.02 && v.readyState >= 2) { finish(); return; }
         v.addEventListener("seeked", finish, { once: true });
         setTimeout(finish, 8000);
         v.currentTime = t;
       });
     })(${i}, ${t})`,
    true,
  );
  console.log(`  cell ${i}  target ${t.toFixed(3)}s  actual ${settled.t.toFixed(3)}s  readyState ${settled.rs}`);
  assert.ok(Math.abs(settled.t - t) < 0.35, `cell ${i} settled at ${settled.t}`);
  // Two frames of paint so the capture cannot observe the previous one.
  await evaluate(
    `new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); })`,
    true,
  );
  return settled;
}

/** Capture the viewport and write it out. */
async function shoot(name) {
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const bytes = Buffer.from(shot.data, "base64");
  const out = join(outDir, name);
  await fs.writeFile(out, bytes);
  console.log(`  wrote ${out}  (${(bytes.length / 1024).toFixed(0)} KiB)`);
  return out;
}

if (mode === "sheet") {
  for (const [i, t] of times.entries()) await seek(i, t);
  await shoot("boot-sheet.png");
} else {
  for (const [n, t] of times.entries()) {
    await seek(0, t);
    await shoot(`frame-${String(n).padStart(2, "0")}-${t.toFixed(1).replace(".", "_")}s.png`);
  }
}

socket.close();
spawn("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 400));
server.close();
await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
