/**
 * dsh-boo550wt-animation — the index-injection rows.
 *
 * Two rows are produced inside the Host half and pushed onto the
 * `webserver/index-inject` table that every page boot consumes:
 *
 *   - `style`  -> rendered into <head> on both the server and the Desktop path.
 *   - `script` -> rendered into <body>. On the Desktop path the page appends it
 *                 while `__DSH_BOOT_READY__` is still pending, i.e. before the
 *                 client module loader runs, so the overlay is on screen before
 *                 any application UI exists.
 *
 * The client script is emitted by stringifying a real function, so the emitted
 * text is valid JavaScript by construction. It supports four boot modes:
 *
 *   video  play a video file (default: the bundled 550W clip)
 *   image  show a picture for a fixed duration
 *   web    embed a webpage full-screen
 *   game   play a built-in mini game (snake)
 */

/** Overlay stylesheet. Must not contain a literal "</style" sequence. */
export const BOOT_STYLE = [
  "#dsh-boo550wt-animation-layer{position:fixed;inset:0;margin:0;padding:0;border:0;",
  "display:flex;align-items:center;justify-content:center;background:#000;",
  "opacity:1;transition:opacity .38s ease;-webkit-user-select:none;user-select:none}",
  "#dsh-boo550wt-animation-layer.dsh-boo550wt-animation-out{opacity:0}",
  ".dsh-boo550wt-animation-media{display:block;width:100%;height:100%;padding:0;margin:0;",
  "object-fit:contain;background:#000}",
  ".dsh-boo550wt-animation-frame{width:100%;height:100%;border:0;background:#000}",
  // The skip affordance is a real button: it stays clickable above an iframe,
  // which is the only way to leave a game or a web page.
  ".dsh-boo550wt-animation-hint{position:absolute;right:20px;bottom:16px;margin:0;",
  'font:12px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;',
  "color:rgba(255,255,255,.55);letter-spacing:.05em;opacity:0;",
  "transition:opacity .6s ease;white-space:pre;cursor:pointer;",
  "background:rgba(20,20,20,.72);border:1px solid rgba(255,255,255,.18);",
  "border-radius:8px;padding:6px 12px;pointer-events:auto;z-index:1}",
  ".dsh-boo550wt-animation-hint:hover{color:#fff;background:rgba(40,40,40,.9);",
  "border-color:rgba(255,255,255,.35)}",
  ".dsh-boo550wt-animation-hint.dsh-boo550wt-animation-hint-on{opacity:1}",
  "html.dsh-boo550wt-animation-locked,html.dsh-boo550wt-animation-locked body{",
  "background:#000 !important;overflow:hidden !important}",
].join("");

/** Build the body script row text: `(<real function source>)(<config>)`. */
export function bootScript(config) {
  return `(${bootClient.toString()})(${JSON.stringify(config)});`;
}

/**
 * The document used by the Settings panel's preview.
 *
 * It is the same overlay the real boot uses — the same stylesheet row, the same
 * script — mounted on its own page instead of over the application, and forced
 * to use the settings currently on screen instead of the saved ones. That is
 * the only way a preview can be trusted: a hand-written imitation in the panel
 * would prove nothing about what actually boots.
 *
 * @param {object} config the overlay config, with `preview: true`
 */
export function previewDocument(config) {
  return [
    "<!doctype html>",
    '<html lang="zh"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>开机动画预览</title>',
    `<style>${BOOT_STYLE}</style>`,
    "</head><body>",
    `<script>${bootScript({ ...config, preview: true })}</script>`,
    "</body></html>",
  ].join("");
}

/**
 * Runs in the page. Kept as an ordinary function so its source is parsed and
 * linted here, then stringified into the injected row.
 *
 * The injected script carries only first-paint defaults; it fetches the live
 * settings from /config before mounting, so the user's latest choices apply on
 * every boot without re-injecting anything.
 *
 * @param {{
 *   base: string, mode: string, url: string, durationMs: number,
 *   zIndex: number, skipHint: string, silentHint: string,
 *   blockedHint: string, errorHint: string, hintDelayMs: number,
 *   maxSeconds: number, graceMs: number, fadeMs: number
 * }} CONFIG
 */
function bootClient(CONFIG) {
  var doc = document;
  var ID = "dsh-boo550wt-animation-layer";
  var existing = doc.getElementById(ID);
  if (existing !== null && existing.parentNode !== null) return; // already mounted

  var layer = doc.createElement("div");
  layer.id = ID;
  layer.className = "dsh-boo550wt-animation-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("data-dsh-boo550wt-animation", "playing");
  layer.style.zIndex = String(CONFIG.zIndex);

  var hint = doc.createElement("button");
  hint.type = "button";
  hint.className = "dsh-boo550wt-animation-hint";
  hint.textContent = CONFIG.skipHint;
  // A real click target: an iframe swallows every key, so this is the only
  // reliable way out of a game or a web page.
  hint.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    finish();
  });

  layer.appendChild(hint);
  (doc.body !== null ? doc.body : doc.documentElement).appendChild(layer);
  doc.documentElement.classList.add("dsh-boo550wt-animation-locked");

  var finished = false;
  var started = false;
  var guard = null;
  var fade = null;
  var hintTimer = null;
  var gestureArmed = false;
  var media = null;

  // ---- live settings ---------------------------------------------------

  function resolveUrl(spec) {
    var raw = spec.url;
    if (typeof raw !== "string") return "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw; // absolute URL
    if (raw.startsWith("/")) return raw;
    return CONFIG.base + "/" + raw.replace(/^\//, "");
  }

  function settingsFor(spec, base) {
    var out = {};
    for (var k in base) out[k] = base[k];
    out.mode = spec.kind || base.mode;
    out.url = resolveUrl(spec);
    return out;
  }

  function fetchSettings() {
    // In preview mode the page was built from the settings currently on screen,
    // so there is nothing to fetch: reading /config here would show the *saved*
    // animation instead of the one being previewed.
    if (CONFIG.preview === true) { start(CONFIG); return; }
    var req = new XMLHttpRequest();
    req.open("GET", CONFIG.base + "/config", true);
    req.onreadystatechange = function () {
      if (req.readyState !== 4) return;
      if (req.status === 200) {
        try {
          var data = JSON.parse(req.responseText);
          var spec = data.media || {};
          var merged = settingsFor(spec, CONFIG);
          merged.skipHint = data.skipHint || CONFIG.skipHint;
          merged.silentHint = data.silentHint || CONFIG.silentHint;
          merged.blockedHint = data.blockedHint || CONFIG.blockedHint;
          merged.errorHint = data.errorHint || CONFIG.errorHint;
          merged.hintDelayMs = data.hintDelayMs || CONFIG.hintDelayMs;
          // The ceiling the Host computed: never shorter than the film itself.
          merged.maxSeconds = data.effectiveMaxSeconds || data.maxSeconds || CONFIG.maxSeconds;
          merged.fadeMs = data.fadeMs || CONFIG.fadeMs;
          merged.durationMs = data.durationMs || CONFIG.durationMs;
          merged.zIndex = data.zIndex || CONFIG.zIndex;
          merged.sound = data.sound !== false;
          merged.mutedFallback = data.mutedFallback !== false;
          start(merged);
        } catch (e) {
          start(CONFIG);
        }
      } else {
        start(CONFIG);
      }
    };
    req.onerror = function () { start(CONFIG); };
    req.send();
  }

  // ---- control flow ----------------------------------------------------

  function noop() {}

  function onKeyDown(event) {
    if (event.key === "Escape" || event.key === "Esc" || event.keyCode === 27) {
      event.preventDefault();
      event.stopPropagation();
      finish();
    }
  }

  function onGestureStart() {
    disarmGesture();
    if (media !== null && typeof media.play === "function") {
      var attempt = media.play();
      if (attempt !== undefined && typeof attempt.catch === "function") attempt.catch(noop);
    }
  }

  function armGesture() {
    if (gestureArmed || finished) return;
    gestureArmed = true;
    window.addEventListener("pointerdown", onGestureStart, true);
    window.addEventListener("keydown", onGestureStart, true);
  }

  function disarmGesture() {
    if (!gestureArmed) return;
    gestureArmed = false;
    window.removeEventListener("pointerdown", onGestureStart, true);
    window.removeEventListener("keydown", onGestureStart, true);
  }

  function showHint(text) {
    hint.textContent = text;
    hint.classList.add("dsh-boo550wt-animation-hint-on");
  }

  function finish() {
    if (finished) return;
    finished = true;
    if (guard !== null) clearTimeout(guard);
    if (hintTimer !== null) clearTimeout(hintTimer);
    guard = null;
    hintTimer = null;
    disarmGesture();
    window.removeEventListener("keydown", onKeyDown, true);
    if (media !== null) {
      media.removeEventListener("ended", finish);
      media.removeEventListener("loadedmetadata", onMetadata);
      media.removeEventListener("error", onMediaError);
      if (typeof media.pause === "function") { try { media.pause(); } catch (ignored) { /* ignore */ } }
    }
    window.removeEventListener("message", onGameMessage);
    layer.setAttribute("data-dsh-boo550wt-animation", "done");
    layer.classList.add("dsh-boo550wt-animation-out");
    fade = setTimeout(unmount, CONFIG.fadeMs);
  }

  function unmount() {
    if (fade !== null) clearTimeout(fade);
    fade = null;
    doc.documentElement.classList.remove("dsh-boo550wt-animation-locked");
    if (layer.parentNode !== null) layer.parentNode.removeChild(layer);
    if (media !== null && typeof media.load === "function") { try { media.removeAttribute("src"); media.load(); } catch (ignored) { /* ignore */ } }
    // In preview mode the host page is the panel's own frame: tell it the run is
    // over so it can close, exactly as the real overlay would hand the shell over.
    if (CONFIG.preview === true) {
      try { parent.postMessage({ __bootPreviewDone: true }, "*"); } catch (ignored) { /* ignore */ }
    }
    try { delete globalThis.__DSH_BOOT_ANIMATION__; } catch (ignored) { /* ignore */ }
  }

  function onMetadata() {
    if (guard !== null) clearTimeout(guard);
    var seconds = media !== null && typeof media.duration === "number" && media.duration > 0
      ? media.duration
      : CONFIG.maxSeconds;
    guard = setTimeout(finish, Math.round(seconds * 1000) + CONFIG.graceMs);
  }

  function onMediaError() {
    if (finished) return;
    showHint(CONFIG.errorHint);
    if (guard !== null) clearTimeout(guard);
    guard = setTimeout(finish, 900);
  }

  function onPlayRefused() {
    if (finished) return;
    // The engine refused unmuted autoplay. Retry muted so the animation still
    // plays, and tell the viewer how to get the sound back.
    if (CONFIG.mutedFallback === false) {
      showHint(CONFIG.blockedHint);
      armGesture();
      return;
    }
    media.muted = true;
    var retry = media.play();
    if (retry !== undefined && typeof retry.catch === "function") {
      retry.catch(function () {
        if (finished) return;
        showHint(CONFIG.blockedHint);
        armGesture();
      });
    }
    showHint(CONFIG.silentHint);
  }

  function onGameMessage(event) {
    var data = event.data;
    if (data === null || typeof data !== "object") return;
    // The frame reported completion: hand over.
    if (data.__bootGameDone === true) {
      finish();
      return;
    }
    // The frame relayed a skip request (its own script saw the Esc).
    if (data.__bootSkip === true) {
      finish();
    }
  }

  // ---- mounting --------------------------------------------------------

  function start(cfg) {
    if (started || finished) return;
    started = true;
    var mode = cfg.mode;

    // The skip affordance: after a short beat for a video (so the clip opens
    // uninterrupted), but at once for a game or a web page — those keep the
    // focus inside their frame, so the button is the only dependable exit and
    // must never be hidden from the viewer.
    var immediate = mode !== "video" && mode !== "image";
    hintTimer = setTimeout(function () {
      if (!finished) hint.classList.add("dsh-boo550wt-animation-hint-on");
    }, immediate ? 0 : cfg.hintDelayMs);

    if (mode === "video") {
      var video = doc.createElement("video");
      video.className = "dsh-boo550wt-animation-media";
      video.autoplay = true;
      // Electron allows unmuted autoplay, so keep the clip's own audio. The
      // fallback only engages when the engine actually refuses it.
      video.muted = cfg.sound === false;
      if (cfg.sound === false) video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.setAttribute("preload", "auto");
      video.controls = false;
      video.loop = false;
      video.disablePictureInPicture = true;
      video.src = cfg.url;
      layer.appendChild(video);
      media = video;
      video.addEventListener("ended", finish);
      video.addEventListener("loadedmetadata", onMetadata);
      video.addEventListener("error", onMediaError);
      var attempt = video.play();
      if (attempt !== undefined && typeof attempt.catch === "function") attempt.catch(onPlayRefused);
    } else if (mode === "image") {
      var img = doc.createElement("img");
      img.className = "dsh-boo550wt-animation-media";
      img.alt = "boot image";
      img.src = cfg.url;
      layer.appendChild(img);
      media = img;
      img.addEventListener("error", onMediaError);
      guard = setTimeout(finish, cfg.durationMs);
    } else if (mode === "web") {
      var frame = doc.createElement("iframe");
      frame.className = "dsh-boo550wt-animation-frame";
      frame.setAttribute("allow", "autoplay; fullscreen");
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
      frame.src = cfg.url;
      layer.appendChild(frame);
      media = frame;
      window.addEventListener("message", onGameMessage);
      // Key events inside the frame never reach this window, so bring the
      // focus back and accept an Esc relayed by the frame's own script.
      releaseFrameFocus(frame);
      guard = setTimeout(finish, cfg.durationMs);
    } else if (mode === "game") {
      var frame2 = doc.createElement("iframe");
      frame2.className = "dsh-boo550wt-animation-frame";
      frame2.setAttribute("allow", "autoplay; fullscreen");
      frame2.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
      frame2.src = cfg.url;
      layer.appendChild(frame2);
      media = frame2;
      window.addEventListener("message", onGameMessage);
      releaseFrameFocus(frame2);
      guard = setTimeout(finish, cfg.maxSeconds * 1000);
    }
  }

  /**
   * Keep a capture-phase key listener alive on this window even while an
   * iframe owns the focus ring, and let the frame's own script post the
   * skip message that the game already sends on game over.
   */
  function releaseFrameFocus(frame) {
    // A blur on the frame returns keyboard ownership to this window, so a
    // later Esc lands here. It also makes the skip button clickable.
    frame.addEventListener("load", function () {
      try {
        if (frame.contentWindow !== null) frame.contentWindow.focus();
      } catch (ignored) { /* cross-origin frame: the in-frame relay covers it */ }
    });
  }

  // ---- boot ------------------------------------------------------------

  // The absolute ceiling: never hold the user hostage if anything stalls.
  guard = setTimeout(finish, CONFIG.maxSeconds * 1000);

  try {
    globalThis.__DSH_BOOT_ANIMATION__ = { skip: finish, element: layer };
  } catch (ignored) { /* ignore */ }

  window.addEventListener("keydown", onKeyDown, true);
  fetchSettings();
}
