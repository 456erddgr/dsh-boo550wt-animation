/**
 * dsh-boot-animation — byte service for the boot clip.
 *
 * The route is deliberately a plain `prefix` route on the profile's own
 * webserver so the page can stream the file with the browser's native media
 * stack: `<video>` issues `Range` requests and expects `206` plus
 * `Content-Range`, and the Desktop shell forwards those requests to the Host
 * unchanged (it only strips `host`/`origin`/`cookie`/`sec-fetch-site` and adds
 * the session cookie, so `Range` survives).
 *
 * Only GET/HEAD are answered. The route is same-origin with the page, and the
 * shell treats anything reached through `dsh-app://app` as trusted, so the
 * page can read the bytes without extra CORS work.
 */

import { createReadStream, promises as fs } from "node:fs";

/** Path of the clip inside the page, relative to the route base. */
export const VIDEO_ROUTE = "/video.mp4";
export const STATE_ROUTE = "/state";

const VIDEO_MIME = "video/mp4";
const CHUNK = 64 * 1024;

/** Parse a single-range `Range` header against a known total size. */
export function parseRange(header, size) {
  if (typeof header !== "string" || header.length === 0) return { kind: "full" };
  const match = /^bytes=(.*)$/i.exec(header.trim());
  if (match === null) return { kind: "unsatisfiable" };
  const spec = match[1].split(",")[0].trim();
  const parts = /^(\d*)-(\d*)$/.exec(spec);
  if (parts === null) return { kind: "unsatisfiable" };
  const rawStart = parts[1];
  const rawEnd = parts[2];
  if (rawStart === "" && rawEnd === "") return { kind: "unsatisfiable" };
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return { kind: "unsatisfiable" };
    const start = Math.max(0, size - suffix);
    return { kind: "range", start, end: size - 1 };
  }
  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return { kind: "unsatisfiable" };
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(end) || end < start) return { kind: "unsatisfiable" };
  return { kind: "range", start, end };
}

function sendHead(res, status, size, range) {
  const headers = {
    "content-type": VIDEO_MIME,
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  };
  if (range === undefined) {
    headers["content-length"] = String(size);
  } else {
    headers["content-length"] = String(range.end - range.start + 1);
    headers["content-range"] = `bytes ${range.start}-${range.end}/${size}`;
  }
  res.writeHead(status, headers);
}

/**
 * Serve one clip file with Range support.
 *
 * @param {string} file absolute path of the clip
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
export async function serveVideo(file, req, res) {
  let stat;
  try {
    stat = await fs.stat(file);
  } catch (error) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end(`boot animation: clip is unavailable (${error.code ?? "unknown"})`);
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("boot animation: clip path is not a file");
    return;
  }

  const size = stat.size;
  const range = parseRange(req.headers.range, size);

  if (range.kind === "unsatisfiable") {
    res.writeHead(416, {
      "content-range": `bytes */${size}`,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    });
    res.end();
    return;
  }

  if (req.method === "HEAD") {
    if (range.kind === "full") sendHead(res, 200, size, undefined);
    else sendHead(res, 206, size, range);
    res.end();
    return;
  }

  if (range.kind === "full") {
    sendHead(res, 200, size, undefined);
    await pump(createReadStream(file, { highWaterMark: CHUNK }), res);
    return;
  }

  sendHead(res, 206, size, range);
  await pump(createReadStream(file, { start: range.start, end: range.end, highWaterMark: CHUNK }), res);
}

/** Pipe a stream into the response, tolerating client disconnects. */
function pump(stream, res) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    stream.on("error", () => {
      if (!res.headersSent) res.writeHead(500, { "cache-control": "no-store" });
      res.end();
      done();
    });
    res.on("close", () => {
      stream.destroy();
      done();
    });
    res.on("finish", done);
    stream.pipe(res);
  });
}
