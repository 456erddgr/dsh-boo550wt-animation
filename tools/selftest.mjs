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
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    console.log(`  FAIL ${name}`);
    throw error;
  }
}

console.log("config");
check("defaults load when no file exists", async () => {
  const s = await loadSettings();
  assert.equal(s.mode, "video");
  assert.equal(s.game, "snake");
  assert.equal(s.durationMs, 16000);
  assert.equal(s.maxSeconds, 120);
});
check("normalize clamps dangerous values", () => {
  const s = normalizeConfig({ mode: "nope", maxSeconds: -5, durationMs: 1, zIndex: "x" });
  assert.equal(s.mode, "video");
  assert.equal(s.maxSeconds, 2);
  assert.equal(s.durationMs, 1000);
  assert.equal(s.zIndex, DEFAULTS.zIndex);
});
check("save then load round-trips", async () => {
  const ok = await saveSettings({ mode: "game", game: "snake", durationMs: 5000 });
  assert.equal(ok, true);
  const s = await loadSettings();
  assert.equal(s.mode, "game");
  assert.equal(s.durationMs, 5000);
});
check("BUNDLED assets exist", () => {
  assert.equal(existsSync(VIDEO), true, "boot.mp4 missing");
  assert.equal(existsSync(BUNDLED_IMAGE), true, "poster.png missing");
});

console.log("parseRange");
const SIZE = 1000;
check("absent header is a full response", () => {
  assert.deepEqual(parseRange(undefined, SIZE), { kind: "full" });
});
check("closed range", () => {
  assert.deepEqual(parseRange("bytes=0-99", SIZE), { kind: "range", start: 0, end: 99 });
});
check("open-ended range", () => {
  assert.deepEqual(parseRange("bytes=100-", SIZE), { kind: "range", start: 100, end: 999 });
});
check("suffix range", () => {
  assert.deepEqual(parseRange("bytes=-50", SIZE), { kind: "range", start: 950, end: 999 });
});
check("end is clipped to the file", () => {
  assert.deepEqual(parseRange("bytes=900-5000", SIZE), { kind: "range", start: 900, end: 999 });
});
check("start past the end is unsatisfiable", () => {
  assert.deepEqual(parseRange("bytes=1000-", SIZE), { kind: "unsatisfiable" });
});
check("reversed range is unsatisfiable", () => {
  assert.deepEqual(parseRange("bytes=500-100", SIZE), { kind: "unsatisfiable" });
});
check("empty suffix is unsatisfiable", () => {
  assert.deepEqual(parseRange("bytes=-", SIZE), { kind: "unsatisfiable" });
});
check("non-bytes unit is unsatisfiable", () => {
  assert.deepEqual(parseRange("items=0-1", SIZE), { kind: "unsatisfiable" });
});
check("garbage is unsatisfiable", () => {
  assert.deepEqual(parseRange("bytes=abc", SIZE), { kind: "unsatisfiable" });
});
check("first leg of a multi-range wins", () => {
  assert.deepEqual(parseRange("bytes=0-9,20-29", SIZE), { kind: "range", start: 0, end: 9 });
});

console.log("injection rows");
check("stylesheet cannot close its own tag", () => {
  assert.equal(BOOT_STYLE.includes("</style"), false);
  assert.equal(BOOT_STYLE.includes("</"), false);
});
check("emitted client script parses", () => {
  const text = bootScript({ base: "/boot-animation", mode: "video", url: "/boot-animation/media/video" });
  assert.doesNotThrow(() => new Function(text));
  assert.equal(text.includes("fetchSettings"), true);
});
check("emitted client script is free of unsafe sequences", () => {
  const text = bootScript({ base: "/boot-animation", mode: "video", url: "/boot-animation/media/video" });
  assert.equal(text.includes("</script"), false);
  assert.equal(text.includes("<!--"), false);
  assert.equal(text.includes("<"), false);
});

console.log("games");
check("snake page is a full HTML document", () => {
  const html = snakeGameHtml();
  assert.equal(html.includes("<!doctype html>"), true);
  assert.equal(html.includes("</html>"), true);
  assert.equal(html.includes("贪吃蛇"), true);
  assert.equal(html.includes("__bootGameDone"), true);
});
check("every built-in game renders a complete page with the skip relay", () => {
  assert.ok(GAME_IDS.length >= 6, `expected at least 6 games, got ${GAME_IDS.length}`);
  for (const id of GAME_IDS) {
    let body = "";
    const res = {
      writeHead() {},
      end(chunk) { body = chunk ? chunk.toString() : ""; },
    };
    assert.equal(serveGame(id, { method: "GET", url: "/" }, res), true, `${id} did not serve`);
    assert.equal(body.startsWith("<!doctype html>"), true, `${id} is not a document`);
    assert.equal(body.includes("</html>"), true, `${id} is truncated`);
    // The relay is what makes Esc and the skip button work inside the frame.
    assert.equal(body.includes("__bootSkip"), true, `${id} cannot relay a skip`);
    assert.equal(body.includes("__bootGameDone"), true, `${id} cannot report completion`);
  }
});
check("the Wandering Earth game exists and is themed", () => {
  assert.ok(GAME_IDS.includes("wandering-earth"), "wandering-earth is missing");
  assert.equal(gameTitle("wandering-earth").includes("行星发动机"), true);
  let body = "";
  serveGame("wandering-earth", { method: "GET", url: "/" }, { writeHead() {}, end(c) { body = c.toString(); } });
  assert.equal(body.includes("地球"), true);
});
check("an unknown game id is refused", () => {
  let status = 0;
  serveGame("nope", { method: "GET", url: "/" }, {
    writeHead(s) { status = s; },
    end() {},
  });
  assert.equal(status, 404);
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
check("claims exactly one prefix route at the plugin base", () => {
  assert.equal(fake.routes.length, 1);
  assert.equal(fake.routes[0].kind, "prefix");
  assert.equal(fake.routes[0].path, "/boot-animation");
  assert.equal(typeof fake.routes[0].handler, "function");
});
check("publishes exactly two injection rows", () => {
  assert.equal(fake.handlers.length, 1);
});
const table = [];
fake.handlers[0](table);
check("row order is stylesheet then body script", () => {
  assert.equal(table.length, 2);
  assert.equal(table[0].kind, "style");
  assert.equal(table[1].kind, "script");
  assert.equal(table[1].placement, "body");
});
check("the body script is valid JavaScript", () => {
  assert.doesNotThrow(() => new Function(table[1].text));
});
check("teardown releases the route", () => {
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
check("full video GET is 200 video/mp4", () => {
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "video/mp4");
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(fullBody.byteLength, 12130517);
});

const ranged = await fetch(`${base}/media/video`, { headers: { range: "bytes=0-1023" } });
const rangedBody = new Uint8Array(await ranged.arrayBuffer());
check("Range video GET is 206 with content-range", () => {
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), "bytes 0-1023/12130517");
  assert.equal(rangedBody.byteLength, 1024);
});

const img = await fetch(`${base}/media/image`);
const imgBody = new Uint8Array(await img.arrayBuffer());
check("image GET is 200 image/png", () => {
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.ok(imgBody.length > 1000, `image too small ${imgBody.length}`);
});

const game = await fetch(`${base}/game/snake`);
const gameBody = await game.text();
check("snake game page is served", () => {
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
check("upload stores an image and reports its kind", () => {
  assert.equal(upRes.status, 200);
  assert.equal(upBody.kind, "image");
  assert.equal(upBody.title, "my-poster");
  assert.match(upBody.name, /^up-[a-z0-9-]+\.png$/u);
  assert.ok(upBody.bytes > 0);
});

const upList = await (await fetch(`${base}/uploads`)).json();
check("the upload appears in the list", () => {
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
check("identical bytes deduplicate to the existing entry", () => {
  assert.equal(dupRes.status, 200);
  assert.equal(dupBody.duplicate, true);
  assert.equal(dupBody.name, upBody.name);
});

const origin = `http://127.0.0.1:${server.address().port}`;
const servedUpload = await fetch(`${origin}${upBody.url}`);
check("an uploaded asset streams from its own route", () => {
  assert.equal(servedUpload.status, 200);
  assert.equal(servedUpload.headers.get("content-type"), "image/png");
});

const badType = await fetch(`${base}/upload`, {
  method: "POST",
  headers: { "content-type": "application/zip" },
  body: Buffer.from("nope"),
});
check("an unsupported type is refused with 415", () => {
  assert.equal(badType.status, 415);
});

// Select the upload and confirm the config points at it.
await fetch(`${base}/config`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ mode: "image", imageUpload: upBody.name }),
});
const picked = await (await fetch(`${base}/config`)).json();
check("config can select an uploaded asset", () => {
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
check("removing an upload deletes it", async () => {
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
check("path traversal is refused", () => {
  assert.equal(traversal.status, 404);
});

const cfg = await fetch(`${base}/config`);
const cfgBody = await cfg.json();
check("config GET returns the live settings", () => {
  assert.equal(cfg.status, 200);
  assert.equal(cfgBody.media.kind, "image");
});

const put = await fetch(`${base}/config`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ mode: "image", durationMs: 7000 }),
});
const putBody = await put.json();
check("config PUT saves and returns the new settings", () => {
  assert.equal(put.status, 200);
  assert.equal(putBody.mode, "image");
  assert.equal(putBody.durationMs, 7000);
});

const state = await fetch(`${base}/config`);
const stateBody = await state.json();
check("saved config survives a second read", () => {
  assert.equal(stateBody.mode, "image");
});

const missing = await fetch(`${base}/nope`);
check("unknown subpath is 404", () => {
  assert.equal(missing.status, 404);
});

const post = await fetch(`${base}/media/video`, { method: "POST" });
check("wrong method is 405", () => {
  assert.equal(post.status, 405);
});

server.close();
rmSync(TMP, { recursive: true, force: true });

console.log(`\n${passed} checks passed; clip at ${VIDEO}`);
