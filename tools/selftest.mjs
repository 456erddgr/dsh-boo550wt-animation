/**
 * Harness test for the pieces that do not need DSH.
 *
 * It exercises the Host modules directly: the injection rows, the Range byte
 * service, and the prefix route that `apply()` claims. This is a test of this
 * package's own code — it is NOT evidence that DSH loaded the plugin, and the
 * browser in the page is not involved.
 *
 * Run: node tools/selftest.mjs
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BOOT_STYLE, bootScript } from "../lib/inject.js";
import { parseRange, STATE_ROUTE, VIDEO_ROUTE } from "../lib/media.js";
import { apply } from "../lib/index.js";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const VIDEO = resolve(ROOT, "assets", "boot.mp4");

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
  const text = bootScript({ src: "/boot-animation/video.mp4" });
  assert.doesNotThrow(() => new Function(text));
  assert.equal(text.includes('"/boot-animation/video.mp4"'), true);
});
check("emitted client script calls a named function", () => {
  assert.equal(/^\(function bootClient\(CONFIG\) \{/u.test(bootScript({ src: "x" })), true);
});
check("emitted client script cannot break out of its own tag", () => {
  // The row is inserted verbatim between <script> and </script>, both by the
  // server renderer and by the Desktop page, so the HTML end-tag sequence and
  // the legacy comment opener must never appear.
  const text = bootScript({ src: "/boot-animation/video.mp4" });
  assert.equal(text.includes("</script"), false);
  assert.equal(text.includes("<!--"), false);
  assert.equal(text.includes("<"), false);
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
check("the body script mounts the documented element id", () => {
  assert.equal(table[1].text.includes("dsh-boo550wt-animation-layer"), true);
});
check("teardown releases the route", () => {
  assert.equal(typeof dispose, "function");
  dispose();
  assert.equal(fake.routes.length, 0);
});
check("disabled by config claims no route", () => {
  const off = fakeContext();
  apply(off.ctx, { enabled: false });
  assert.equal(off.routes.length, 0);
  assert.equal(off.handlers.length, 0);
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

const full = await fetch(`${base}${VIDEO_ROUTE}`);
const fullBody = new Uint8Array(await full.arrayBuffer());
check("full GET is 200 video/mp4", () => {
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "video/mp4");
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(fullBody.byteLength, 12130517);
});
check("bytes look like an MP4 with a tail moov", () => {
  const ascii = (at) => String.fromCharCode(...fullBody.subarray(at, at + 4));
  assert.equal(ascii(4), "ftyp");
  assert.equal(ascii(fullBody.byteLength - 19631 + 4), "moov");
});

const ranged = await fetch(`${base}${VIDEO_ROUTE}`, { headers: { range: "bytes=0-1023" } });
const rangedBody = new Uint8Array(await ranged.arrayBuffer());
check("Range GET is 206 with content-range", () => {
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), "bytes 0-1023/12130517");
  assert.equal(rangedBody.byteLength, 1024);
});
check("the ranged bytes match the full read", () => {
  assert.deepEqual([...rangedBody], [...fullBody.subarray(0, 1024)]);
});

const tail = await fetch(`${base}${VIDEO_ROUTE}`, { headers: { range: "bytes=-64" } });
check("suffix range returns the last bytes", () => {
  assert.equal(tail.status, 206);
  assert.equal(tail.headers.get("content-range"), "bytes 12130453-12130516/12130517");
});

const head = await fetch(`${base}${VIDEO_ROUTE}`, { method: "HEAD" });
check("HEAD reports the length without a body", () => {
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "12130517");
});

const bad = await fetch(`${base}${VIDEO_ROUTE}`, { headers: { range: "bytes=99999999-" } });
check("out-of-range request is 416", () => {
  assert.equal(bad.status, 416);
  assert.equal(bad.headers.get("content-range"), "bytes */12130517");
});

const state = await fetch(`${base}${STATE_ROUTE}`);
const stateBody = await state.json();
check("state reports the clip as available", () => {
  assert.equal(state.status, 200);
  assert.equal(stateBody.videoAvailable, true);
  assert.equal(stateBody.videoBytes, 12130517);
});

const missing = await fetch(`${base}/nope`);
check("unknown subpath is 404", () => {
  assert.equal(missing.status, 404);
});

const post = await fetch(`${base}${VIDEO_ROUTE}`, { method: "POST" });
check("wrong method is 405", () => {
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
});

server.close();
console.log(`\n${passed} checks passed; clip at ${VIDEO}`);
