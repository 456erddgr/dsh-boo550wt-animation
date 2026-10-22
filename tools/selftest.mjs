/**
 * Harness test for the pieces that do not need DSH.
 *
 * It exercises the Host modules directly: config load/save, the injection
 * rows, the byte service (video + image), the game page, and the prefix route
 * that `apply()` claims. This is a test of this package's own code — it is
 * NOT evidence that DSH loaded the plugin, and the browser in the page is not
 * involved.
 *
 * Run: node tools/selftest.mjs
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BOOT_STYLE, bootScript } from "../lib/inject.js";
import { parseRange } from "../lib/media.js";
import { apply } from "../lib/index.js";
import { GAME_IDS, gameTitle, serveGame, snakeGameHtml } from "../lib/games.js";
import {
  BUNDLED_IMAGE,
  BUNDLED_VIDEO,
  DEFAULTS,
  loadSettings,
  normalizeConfig,
  saveSettings,
} from "../lib/config.js";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const VIDEO = BUNDLED_VIDEO;

// Isolate the settings file for the duration of the test.
const TMP = mkdtempSync(join(tmpdir(), "dsh-boo550wt-selftest-"));
process.env.DSH_HOME = TMP;

let passed = 0;
/**
 * Run one check. It MUST await an async check: a dropped promise would let an
 * assertion inside it go unexecuted and still report "ok".
 */
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    console.log(`  FAIL ${name}`);
    throw error;
  }
}

console.log("config");
await check("defaults load when no file exists", async () => {
  const s = await loadSettings();
  assert.equal(s.mode, "video");
  assert.equal(s.game, "snake");
  assert.equal(s.durationMs, 16000);
  assert.equal(s.maxSeconds, 120);
});
await check("normalize clamps dangerous values", () => {
  const s = normalizeConfig({ mode: "nope", maxSeconds: -5, durationMs: 1, zIndex: "x" });
  assert.equal(s.mode, "video");
  assert.equal(s.maxSeconds, 2);
  assert.equal(s.durationMs, 1000);
  assert.equal(s.zIndex, DEFAULTS.zIndex);
});
await check("save then load round-trips", async () => {
  const ok = await saveSettings({ mode: "game", game: "snake", durationMs: 5000 });
  assert.equal(ok, true);
  const s = await loadSettings();
  assert.equal(s.mode, "game");
  assert.equal(s.durationMs, 5000);
});
await check("BUNDLED assets exist", () => {
  assert.equal(existsSync(VIDEO), true, "boot.mp4 missing");
  assert.equal(existsSync(BUNDLED_IMAGE), true, "poster.png missing");
});

console.log("parseRange");
const SIZE = 1000;
await check("absent header is a full response", () => {
  assert.deepEqual(parseRange(undefined, SIZE), { kind: "full" });
});
await check("closed range", () => {
  assert.deepEqual(parseRange("bytes=0-99", SIZE), { kind: "range", start: 0, end: 99 });
});
await check("open-ended range", () => {
  assert.deepEqual(parseRange("bytes=100-", SIZE), { kind: "range", start: 100, end: 999 });
});
await check("suffix range", () => {
  assert.deepEqual(parseRange("bytes=-50", SIZE), { kind: "range", start: 950, end: 999 });
});
await check("end is clipped to the file", () => {
  assert.deepEqual(parseRange("bytes=900-5000", SIZE), { kind: "range", start: 900, end: 999 });
});
await check("start past the end is unsatisfiable", () => {
  assert.deepEqual(parseRange("bytes=1000-", SIZE), { kind: "unsatisfiable" });
});
await check("reversed range is unsatisfiable", () => {
  assert.deepEqual(parseRange("bytes=500-100", SIZE), { kind: "unsatisfiable" });
});
await check("empty suffix is unsatisfiable", () => {
  assert.deepEqual(parseRange("bytes=-", SIZE), { kind: "unsatisfiable" });
});
await check("non-bytes unit is unsatisfiable", () => {
  assert.deepEqual(parseRange("items=0-1", SIZE), { kind: "unsatisfiable" });
});
await check("garbage is unsatisfiable", () => {
  assert.deepEqual(parseRange("bytes=abc", SIZE), { kind: "unsatisfiable" });
});
await check("first leg of a multi-range wins", () => {
  assert.deepEqual(parseRange("bytes=0-9,20-29", SIZE), { kind: "range", start: 0, end: 9 });
});

console.log("injection rows");
await check("stylesheet cannot close its own tag", () => {
  assert.equal(BOOT_STYLE.includes("</style"), false);
  assert.equal(BOOT_STYLE.includes("</"), false);
});
await check("emitted client script parses", () => {
  const text = bootScript({ base: "/boot-animation", mode: "video", url: "/boot-animation/media/video" });
  assert.doesNotThrow(() => new Function(text));
  assert.equal(text.includes("fetchSettings"), true);
});
await check("emitted client script is free of unsafe sequences", () => {
  const text = bootScript({ base: "/boot-animation", mode: "video", url: "/boot-animation/media/video" });
  assert.equal(text.includes("</script"), false);
  assert.equal(text.includes("<!--"), false);
  assert.equal(text.includes("<"), false);
});

console.log("games");
await check("snake page is a full HTML document", () => {
  const html = snakeGameHtml();
  assert.equal(html.includes("<!doctype html>"), true);
  assert.equal(html.includes("</html>"), true);
  assert.equal(html.includes("贪吃蛇"), true);
  assert.equal(html.includes("__bootGameDone"), true);
});
await check("every built-in game renders a complete page with the skip relay", async () => {
  assert.ok(GAME_IDS.length >= 6, `expected at least 6 games, got ${GAME_IDS.length}`);
  // Serve each game over real HTTP: a directory game streams its page, so a
  // hand-made response stub would silently collect nothing.
  const gameServer = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const id = path.split("/")[1];
    serveGame(id, req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  gameServer.listen(0, "127.0.0.1");
  await once(gameServer, "listening");
  const host = `http://127.0.0.1:${gameServer.address().port}`;
  try {
    for (const id of GAME_IDS) {
      const res = await fetch(`${host}/${id}`);
      const body = await res.text();
      assert.equal(res.status, 200, `${id} answered ${res.status}`);
      const lower = body.toLowerCase();
      assert.equal(lower.startsWith("<!doctype html>"), true, `${id} is not a document`);
      assert.equal(lower.includes("</html>"), true, `${id} is truncated`);
      // The relay is what makes Esc and the skip button work inside the frame.
      assert.equal(body.includes("__bootSkip"), true, `${id} cannot relay a skip`);
      assert.equal(body.includes("__bootGameDone"), true, `${id} cannot report completion`);
    }
  } finally {
    gameServer.close();
  }
});
await check("the Wandering Earth entry is the vendored 3D scene with a Chinese walkthrough", () => {
  assert.ok(GAME_IDS.includes("wandering-earth"), "wandering-earth is missing");
  assert.equal(gameTitle("wandering-earth").includes("流浪地球"), true);
  const root = resolve(ROOT, "vendor", "earth-migration");
  for (const rel of [
    "ignite.html",
    "js/app.js",
    "vendor/three/build/three.module.js",
    "vendor/three/examples/jsm/controls/OrbitControls.js",
    "assets/earth/earth_day_4096.jpg",
    "assets/sky/milkyway_4k.jpg",
  ]) {
    assert.equal(existsSync(resolve(root, rel)), true, `missing ${rel}`);
  }
  const html = readFileSync(resolve(root, "ignite.html"), "utf8");
  assert.equal(html.includes("importmap"), true, "no import map: three would not resolve");
  assert.equal(html.includes("em-boot"), true, "the walkthrough overlay is missing");
  // It must narrate in Chinese, chapter by chapter, not ship English copy.
  for (const line of ["太阳的黄昏", "点火", "让地球自转停下", "太空电梯", "木星引力弹弓", "两千年长夜"]) {
    assert.equal(html.includes(line), true, `missing chapter copy: ${line}`);
  }
  // Handing the camera to the viewer is the point of the free-look mode.
  assert.equal(html.includes("btn-explore"), true, "no free-look hand-off");
  assert.equal(html.includes("__bootSkip"), true, "no skip relay");
  assert.equal(/https?:\/\//.test(html), false, "the page must not reach the network");
});
await check("an unknown game id is refused", async () => {
  let status = 0;
  await serveGame("nope", { method: "GET", url: "/" }, {
    writeHead(s) { status = s; },
    end() {},
  });
  assert.equal(status, 404);
});
await check("a directory game refuses path traversal", async () => {
  let status = 0;
  await serveGame("wandering-earth", { method: "GET", url: "/" }, {
    writeHead(s) { status = s; },
    end() {},
  }, "/../../package.json");
  assert.ok(status === 403 || status === 404, `unexpected status ${status}`);
});

/** Build a stand-in plugin context that records what the plugin registers. */
function fakeContext() {
  const routes = [];
  const handlers = [];
  const disposers = [];
  const ctx = {
    webServer: {
      register(route) {
        routes.push(route);
        const dispose = () => {
          const at = routes.indexOf(route);
          if (at >= 0) routes.splice(at, 1);
        };
        disposers.push(dispose);
        return dispose;
      },
    },
    effect(fn) {
      const dispose = fn();
      return () => dispose();
    },
    on(event, handler) {
      assert.equal(event, "webserver/index-inject");
      handlers.push(handler);
      return () => {};
    },
    logger: () => ({ info() {} }),
  };
  return { ctx, routes, handlers, disposers };
}

console.log("apply()");
const fake = fakeContext();
const dispose = apply(fake.ctx, {});
await check("claims exactly one prefix route at the plugin base", () => {
  assert.equal(fake.routes.length, 1);
  assert.equal(fake.routes[0].kind, "prefix");
  assert.equal(fake.routes[0].path, "/boot-animation");
  assert.equal(typeof fake.routes[0].handler, "function");
});
await check("publishes exactly two injection rows", () => {
  assert.equal(fake.handlers.length, 1);
});
const table = [];
fake.handlers[0](table);
await check("row order is stylesheet then body script", () => {
  assert.equal(table.length, 2);
  assert.equal(table[0].kind, "style");
  assert.equal(table[1].kind, "script");
  assert.equal(table[1].placement, "body");
});
await check("the body script is valid JavaScript", () => {
  assert.doesNotThrow(() => new Function(table[1].text));
});
await check("teardown releases the route", () => {
  assert.equal(typeof dispose, "function");
  dispose();
  assert.equal(fake.routes.length, 0);
});

console.log("route over HTTP");
const served = fakeContext();
apply(served.ctx, {});
const handler = served.routes[0].handler;

const server = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path.startsWith("/boot-animation")) {
    handler(req, res).catch(() => {
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
const base = `http://127.0.0.1:${server.address().port}/boot-animation`;

const full = await fetch(`${base}/media/video`);
const fullBody = new Uint8Array(await full.arrayBuffer());
await check("full video GET is 200 video/mp4", () => {
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "video/mp4");
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(fullBody.byteLength, 12130517);
});

const ranged = await fetch(`${base}/media/video`, { headers: { range: "bytes=0-1023" } });
const rangedBody = new Uint8Array(await ranged.arrayBuffer());
await check("Range video GET is 206 with content-range", () => {
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), "bytes 0-1023/12130517");
  assert.equal(rangedBody.byteLength, 1024);
});

const img = await fetch(`${base}/media/image`);
const imgBody = new Uint8Array(await img.arrayBuffer());
await check("image GET is 200 image/png", () => {
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.ok(imgBody.length > 1000, `image too small ${imgBody.length}`);
});

const game = await fetch(`${base}/game/snake`);
const gameBody = await game.text();
await check("snake game page is served", () => {
  assert.equal(game.status, 200);
  assert.equal(game.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(gameBody.includes("贪吃蛇"), true);
});

// ---- uploads ----
console.log("uploads");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const upRes = await fetch(`${base}/upload?title=my-poster`, {
  method: "POST",
  headers: { "content-type": "image/png" },
  body: png,
});
const upBody = await upRes.json();
await check("upload stores an image and reports its kind", () => {
  assert.equal(upRes.status, 200);
  assert.equal(upBody.kind, "image");
  assert.equal(upBody.title, "my-poster");
  assert.match(upBody.name, /^up-[a-z0-9-]+\.png$/u);
  assert.ok(upBody.bytes > 0);
});

const upList = await (await fetch(`${base}/uploads`)).json();
await check("the upload appears in the list", () => {
  assert.equal(upList.uploads.length, 1);
  assert.equal(upList.uploads[0].title, "my-poster");
  assert.equal(upList.uploads[0].kind, "image");
});

const dupRes = await fetch(`${base}/upload?title=again`, {
  method: "POST",
  headers: { "content-type": "image/png" },
  body: png,
});
const dupBody = await dupRes.json();
await check("identical bytes deduplicate to the existing entry", () => {
  assert.equal(dupRes.status, 200);
  assert.equal(dupBody.duplicate, true);
  assert.equal(dupBody.name, upBody.name);
});

const origin = `http://127.0.0.1:${server.address().port}`;
const servedUpload = await fetch(`${origin}${upBody.url}`);
await check("an uploaded asset streams from its own route", () => {
  assert.equal(servedUpload.status, 200);
  assert.equal(servedUpload.headers.get("content-type"), "image/png");
});

const badType = await fetch(`${base}/upload`, {
  method: "POST",
  headers: { "content-type": "application/zip" },
  body: Buffer.from("nope"),
});
await check("an unsupported type is refused with 415", () => {
  assert.equal(badType.status, 415);
});

// Select the upload and confirm the config points at it.
await fetch(`${base}/config`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ mode: "image", imageUpload: upBody.name }),
});
const picked = await (await fetch(`${base}/config`)).json();
await check("config can select an uploaded asset", () => {
  assert.equal(picked.imageUpload, upBody.name);
  assert.equal(picked.media.kind, "image");
  assert.equal(picked.media.url, upBody.url);
});

const removeRes = await fetch(`${base}/upload-remove`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: upBody.name }),
});
const removeBody = await removeRes.json();
await check("removing an upload deletes it", async () => {
  assert.equal(removeRes.status, 200);
  assert.equal(removeBody.ok, true);
  const after = await (await fetch(`${base}/uploads`)).json();
  assert.equal(after.uploads.length, 0);
});

const traversal = await fetch(`${base}/upload-remove`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "../../package.json" }),
});
await check("path traversal is refused", () => {
  assert.equal(traversal.status, 404);
});

const cfg = await fetch(`${base}/config`);
const cfgBody = await cfg.json();
await check("config GET returns the live settings", () => {
  assert.equal(cfg.status, 200);
  assert.equal(cfgBody.media.kind, "image");
});

const put = await fetch(`${base}/config`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ mode: "image", durationMs: 7000 }),
});
const putBody = await put.json();
await check("config PUT saves and returns the new settings", () => {
  assert.equal(put.status, 200);
  assert.equal(putBody.mode, "image");
  assert.equal(putBody.durationMs, 7000);
});

const state = await fetch(`${base}/config`);
const stateBody = await state.json();
await check("saved config survives a second read", () => {
  assert.equal(stateBody.mode, "image");
});

const missing = await fetch(`${base}/nope`);
await check("unknown subpath is 404", () => {
  assert.equal(missing.status, 404);
});

const post = await fetch(`${base}/media/video`, { method: "POST" });
await check("wrong method is 405", () => {
  assert.equal(post.status, 405);
});

server.close();
rmSync(TMP, { recursive: true, force: true });

console.log(`\n${passed} checks passed; clip at ${VIDEO}`);
