// Score: one recorded track (assets/audio/theme.m4a, bundled with the package) played as the film's music bed.
//
// The upstream module synthesised its own pad/drone/rumble/shimmer in WebAudio. That is what sounded "wrong" next
// to the picture, so the generative layers are gone: the same public API now drives a single <audio> element.
// Everything below keeps that API (start / chapter / level / boom / stop / toggle / setMuted / setVolume) so
// main.js and dash.js need no change.
//
// Autoplay: Electron allows unmuted media without a gesture; a browser page may not. If play() is refused the track
// arms a one-shot pointerdown/keydown listener and starts on the first real interaction, and `blocked` is exposed
// so the page can say so.
const TRACK = 'assets/audio/theme.m4a';
const MUSIC_VOLUME = 0.55;      // the bed sits under the narration, not on top of it

export const Sound = (() => {
  let el = null, muted = false, vol = 1, started = false, blocked = false, armed = false;

  function make() {
    if (el !== null) return el;
    if (typeof Audio !== 'function') return null;
    el = new Audio();
    el.src = TRACK;
    el.loop = true;             // 7:05 of music under a 2:54 film, and it keeps going in free flight
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    el.volume = muted ? 0 : MUSIC_VOLUME * vol;
    return el;
  }

  function tryPlay() {
    const a = make(); if (!a) return;
    const p = a.play();
    if (p && typeof p.catch === 'function') {
      p.catch(function () {           // refused: wait for a real gesture, never assume it played
        blocked = true;
        if (armed) return;
        armed = true;
        const go = function () {
          armed = false;
          removeEventListener('pointerdown', go, true);
          removeEventListener('keydown', go, true);
          blocked = false;
          const retry = el && el.play();
          if (retry && typeof retry.catch === 'function') retry.catch(function () { blocked = true; });
        };
        addEventListener('pointerdown', go, true);
        addEventListener('keydown', go, true);
      });
    }
  }

  return {
    start() {
      try {
        const a = make(); if (!a) return;
        started = true;
        if (!muted) { a.volume = MUSIC_VOLUME * vol; tryPlay(); }
      } catch (e) { console.warn('Audio unavailable', e); }
    },
    // The generative cues have no source any more; the film keeps them as no-ops.
    chapter() {},
    level() {},
    boom() {},
    stop() { if (el) { try { el.pause(); } catch (e) { /* already stopped */ } } },
    toggle() {
      muted = !muted;
      if (el) el.volume = muted ? 0 : MUSIC_VOLUME * vol;
      if (!muted && started && el && el.paused) tryPlay();
      return !muted;
    },
    get muted() { return muted; },
    get blocked() { return blocked; },
    /** The one <audio> element, for diagnostics and the boot page's own reporting. */
    get element() { return el; },
    setMuted(m) {
      muted = !!m;
      if (el) el.volume = muted ? 0 : MUSIC_VOLUME * vol;
      if (!muted && started && el && el.paused) tryPlay();
    },
    setVolume(v) {
      vol = Math.max(0, Math.min(1, v));
      if (el && !muted) el.volume = MUSIC_VOLUME * vol;
    },
  };
})();
