/**
 * dsh-boo550wt-animation — the two index-injection rows.
 *
 * Both rows are produced inside the Host half and pushed onto the
 * `webserver/index-inject` table that every page boot consumes:
 *
 *   - `style`  -> rendered into <head> on both the server and the Desktop path.
 *   - `script` -> rendered into <body>. On the Desktop path the page appends it
 *                 while `__DSH_BOOT_READY__` is still pending, i.e. before the
 *                 client module loader runs, so the overlay is on screen before
 *                 any application UI exists.
 *
 * The client script is emitted by stringifying a real function, so the emitted
 * text is valid JavaScript by construction.
 */

/** Overlay stylesheet. Must not contain a literal "</style" sequence. */
export const BOOT_STYLE = [
  "#dsh-boo550wt-animation-layer{position:fixed;inset:0;margin:0;padding:0;border:0;",
  "display:flex;align-items:center;justify-content:center;background:#000;",
  "opacity:1;transition:opacity .38s ease;-webkit-user-select:none;user-select:none}",
  "#dsh-boo550wt-animation-layer.dsh-boo550wt-animation-out{opacity:0}",
  ".dsh-boo550wt-animation-video{display:block;width:100%;height:100%;padding:0;margin:0;",
  "object-fit:contain;background:#000;pointer-events:none}",
  ".dsh-boo550wt-animation-hint{position:absolute;right:20px;bottom:16px;margin:0;",
  'font:12px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;',
  "color:rgba(255,255,255,.4);letter-spacing:.05em;opacity:0;",
  "transition:opacity .6s ease;pointer-events:none;white-space:pre}",
  ".dsh-boo550wt-animation-hint.dsh-boo550wt-animation-hint-on{opacity:1}",
  "html.dsh-boo550wt-animation-locked,html.dsh-boo550wt-animation-locked body{",
  "background:#000 !important;overflow:hidden !important}",
].join("");

/** Build the body script row text: `(<real function source>)(<config>)`. */
export function bootScript(config) {
  return `(${bootClient.toString()})(${JSON.stringify(config)});`;
}

/**
 * Runs in the page. Kept as an ordinary function so its source is parsed and
 * linted here, then stringified into the injected row.
 *
 * @param {{
 *   src: string, zIndex: number, skipHint: string, silentHint: string,
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

  var video = doc.createElement("video");
  video.className = "dsh-boo550wt-animation-video";
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.setAttribute("preload", "auto");
  video.controls = false;
  video.loop = false;
  video.disablePictureInPicture = true;
  video.src = CONFIG.src;

  var hint = doc.createElement("div");
  hint.className = "dsh-boo550wt-animation-hint";
  hint.textContent = CONFIG.skipHint;

  layer.appendChild(video);
  layer.appendChild(hint);
  (doc.body !== null ? doc.body : doc.documentElement).appendChild(layer);
  doc.documentElement.classList.add("dsh-boo550wt-animation-locked");

  var finished = false;
  var guard = null;
  var fade = null;
  var hintTimer = null;
  var gestureArmed = false;

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
    var attempt = video.play();
    if (attempt !== undefined && typeof attempt.catch === "function") attempt.catch(noop);
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
    video.removeEventListener("ended", finish);
    video.removeEventListener("loadedmetadata", onMetadata);
    video.removeEventListener("error", onVideoError);
    layer.setAttribute("data-dsh-boo550wt-animation", "done");
    try { video.pause(); } catch (ignored) { /* ignore */ }
    layer.classList.add("dsh-boo550wt-animation-out");
    fade = setTimeout(unmount, CONFIG.fadeMs);
  }

  function unmount() {
    if (fade !== null) clearTimeout(fade);
    fade = null;
    doc.documentElement.classList.remove("dsh-boo550wt-animation-locked");
    if (layer.parentNode !== null) layer.parentNode.removeChild(layer);
    try {
      video.removeAttribute("src");
      video.load();
    } catch (ignored) { /* ignore */ }
    try { delete globalThis.__DSH_BOOT_ANIMATION__; } catch (ignored) { /* ignore */ }
  }

  function onMetadata() {
    if (guard !== null) clearTimeout(guard);
    var seconds = video.duration;
    // Phrased as a negated comparison so the emitted text stays free of angle
    // brackets: the row is inserted verbatim inside a script element.
    if (typeof seconds !== "number" || !isFinite(seconds) || !(seconds > 0)) return;
    guard = setTimeout(finish, Math.round(seconds * 1000) + CONFIG.graceMs);
  }

  function onVideoError() {
    if (finished) return;
    showHint(CONFIG.errorHint);
    if (guard !== null) clearTimeout(guard);
    guard = setTimeout(finish, 900);
  }

  function onPlayRefused() {
    if (finished) return;
    // Sound was refused (or playback entirely). Muted playback is allowed by
    // every engine, so fall back to it and say so; a gesture retries with sound.
    video.muted = true;
    var retry = video.play();
    if (retry !== undefined && typeof retry.catch === "function") {
      retry.catch(function () {
        if (finished) return;
        showHint(CONFIG.blockedHint);
        armGesture();
      });
    }
    showHint(CONFIG.silentHint);
  }

  function start() {
    var attempt = video.play();
    if (attempt !== undefined && typeof attempt.catch === "function") attempt.catch(onPlayRefused);
  }

  video.addEventListener("ended", finish);
  video.addEventListener("loadedmetadata", onMetadata);
  video.addEventListener("error", onVideoError);
  window.addEventListener("keydown", onKeyDown, true);

  // Absolute ceiling: never hold the user hostage if the file stalls.
  guard = setTimeout(finish, CONFIG.maxSeconds * 1000);
  // The skip affordance only appears after the animation has had the stage.
  hintTimer = setTimeout(function () {
    if (!finished) hint.classList.add("dsh-boo550wt-animation-hint-on");
  }, CONFIG.hintDelayMs);

  try {
    globalThis.__DSH_BOOT_ANIMATION__ = { skip: finish, element: layer, video: video };
  } catch (ignored) { /* ignore */ }

  start();
}
