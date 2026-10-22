/**
 * dsh-boo550wt-animation — generic byte service.
 *
 * One route serves every media kind the boot animation can ask for (video or
 * image) with `Range` support, so the browser's own media stack decodes it.
 * The web/game kinds are served by dedicated routes in the Host half.
 */

import { createReadStream, promises as fs } from "node:fs";

export const VIDEO_ROUTE = "/media/video";
export const IMAGE_ROUTE = "/media/image";
export const WEB_ROUTE = "/media/web";

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

function sendHead(res, status, size, range, contentType) {
  const headers = {
    "content-type": contentType,
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

/** Guess a content type from the file extension. */
function contentTypeOf(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v") || lower.endsWith(".mov")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

/**
 * Serve one file with Range support. `contentType` overrides the guessed one.
 *
 * @param {string} file absolute path
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string} [contentType]
 */
export async function serveFile(file, req, res, contentType) {
  let stat;
  try {
    stat = await fs.stat(file);
  } catch (error) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end(`boot animation: file is unavailable (${error.code ?? "unknown"})`);
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("boot animation: path is not a file");
    return;
  }

  const size = stat.size;
  const range = parseRange(req.headers.range, size);
  const type = contentType ?? contentTypeOf(file);

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
    if (range.kind === "full") sendHead(res, 200, size, undefined, type);
    else sendHead(res, 206, size, range, type);
    res.end();
    return;
  }

  if (range.kind === "full") {
    sendHead(res, 200, size, undefined, type);
    await pump(createReadStream(file, { highWaterMark: CHUNK }), res);
    return;
  }

  sendHead(res, 206, size, range, type);
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
