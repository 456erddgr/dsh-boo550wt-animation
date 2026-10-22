/**
 * Render one screenshot per built-in game and write them to a directory.
 *
 * Each shot gets its own browser: the string-generated games tolerate a shared
 * session, but the 3D scene needs a clean WebGL context — after a few pages in
 * one session it draws nothing and the capture comes out blank.
 *
 * The server here splits paths exactly like the plugin's real route
 * (`/boot-animation/game/<id>/<rest>`); getting that wrong serves the entry
 * HTML for `js/app.js` and the scene silently never boots.
 *
 * Run: node tools/screenshots.mjs docs
 */
/**
 * One screenshot per game, each captured in a FRESH browser.
 *
 * A single browsing session works for the string-generated games, but the 3D
 * scene needs a clean WebGL context: after a few pages have come and gone in
 * one session the renderer draws nothing and the capture is blank. One browser
 * per shot removes that coupling entirely.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const g = await import("file:///" + process.argv[2].replace(/\\/g, "/"));
const outDir = process.argv[3];
mkdirSync(outDir, { recursive: true });

// Same path split as the plugin's real route: strip the plugin base, then the
// game id, and hand the remainder to the game.
const BASE = "/boot-animation/game/";
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const rest = path.startsWith(BASE) ? path.slice(BASE.length) : path.slice(1);
  const slash = rest.indexOf("/");
  const id = slash < 0 ? rest : rest.slice(0, slash);
  const sub = slash < 0 ? "" : rest.slice(slash);
  try { await g.serveGame(id, req, res, sub); }
  catch (e) { if (!res.headersSent) res.writeHead(500); res.end(String(e)); }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;

const PLAN = [
  { id: "snake",           wait: 1600,  keys: ["ArrowRight", "ArrowDown"] },
  { id: "2048",            wait: 1000,  keys: ["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"] },
  { id: "breakout",        wait: 1400,  keys: ["ArrowRight", "ArrowLeft"] },
  // Memory needs clicks, not keys: open a handful of cards so the board shows
  // faces and a matched pair instead of twelve blank backs.
  { id: "memory",          wait: 1000,  clicks: 8 },
  // Typing needs a real keystroke to show a partially typed word.
  { id: "typing",          wait: 900,   typeText: "HARN" },
  { id: "wandering-earth", wait: 17000, keys: ["ArrowRight", "d", "ArrowUp"] },
];

async function capture(step) {
  const profile = mkdtempSync(join(tmpdir(), "shot-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--mute-audio",
    "--enable-gpu", "--use-gl=angle", "--use-angle=swiftshader-webgl",
    "--enable-unsafe-swiftshader",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check",
    "--window-size=1280,780", "about:blank",
  ], { stdio: "ignore" });

  const pf = join(profile, "DevToolsActivePort");
  let port = null;
  for (let i = 0; i < 200 && !port; i++) {
    try { port = Number(readFileSync(pf, "utf8").split("\n")[0].trim()); } catch {}
    if (!port) await new Promise(r => setTimeout(r, 100));
  }
  let targets = [];
  for (let i = 0; i < 120; i++) {
    targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    if (targets.some(t => t.type === "page")) break;
    await new Promise(r => setTimeout(r, 50));
  }
  const target = targets.find(t => t.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await once(ws, "open");

  let id = 1; const pending = new Map();
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(res => { pending.set(id, res); ws.send(JSON.stringify({ id: id++, method, params })); });
  const evalp = async (ex, aw = false) => {
    const r = await send("Runtime.evaluate", { expression: ex, awaitPromise: aw, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split("\n")[0]);
    return r.result?.result?.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 780, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${origin}/boot-animation/game/${step.id}/` });

  // Poll for real content rather than trusting the clock: a page is "drawn"
  // when the canvas has a buffer with at least one non-black pixel, or when a
  // plain game has finished building its DOM.
  const deadline = Date.now() + step.wait + 12000;
  let drawn = false;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));
    drawn = await evalp(`(function () {
      var c = document.querySelector("canvas");
      if (c !== null && c.width > 100 && c.height > 100) return true;
      var body = document.body ? document.body.textContent || "" : "";
      return body.length > 40;
    })()`);
    if (drawn && step.id !== "wandering-earth") break;
    if (drawn && step.id === "wandering-earth" && !!await evalp(`!!window.__emReady`)) break;
  }
  await new Promise(r => setTimeout(r, step.clicks ? 120 : step.wait));
  if (Array.isArray(step.keys)) {
    for (const key of step.keys) {
      await evalp(`document.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true }))`);
      await new Promise(r => setTimeout(r, 320));
    }
  }
  if (step.clicks) {
    // Open a card, capture it immediately: the game closes a mismatched pair
    // after 700 ms, so any wait longer than that photographs blank backs.
    for (let n = 0; n < step.clicks; n++) {
      await evalp(`(function () {
        var cards = document.querySelectorAll(".card");
        var el = cards[${n}];
        if (el) el.click();
      })()`);
      await new Promise(r => setTimeout(r, 120));
    }
    // Leave the last card face-up; no extra settle before the capture.
  }
  if (step.typeText) {
    await evalp(`(function (text) {
      var input = document.querySelector("input");
      if (!input) return;
      input.focus();
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })(${JSON.stringify(step.typeText)})`);
    await new Promise(r => setTimeout(r, 400));
  }
  await evalp(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`, true);

  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const bytes = Buffer.from(shot.result.data, "base64");
  writeFileSync(join(outDir, `${step.id}.png`), bytes);
  ws.close();
  spawn("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
  return bytes.length;
}

for (const step of PLAN) {
  const n = await capture(step);
  console.log(`${step.id.padEnd(18)} ${(n / 1024).toFixed(0)} KiB`);
}
server.close();




