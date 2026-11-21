const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const capturas = path.join(root, "capturas");
const port = 5173;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

fs.mkdirSync(capturas, { recursive: true });

function safeName(raw) {
  const base = String(raw || "estiba")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "estiba";
}

function uniqueFile(name) {
  let file = `${name}.png`;
  let n = 2;
  while (fs.existsSync(path.join(capturas, file))) {
    file = `${name}-${n}.png`;
    n += 1;
  }
  return file;
}

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type || "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function listCapturas() {
  return fs
    .readdirSync(capturas)
    .filter((file) => file.toLowerCase().endsWith(".png"))
    .map((file) => ({
      file,
      name: file.replace(/\.png$/i, ""),
      url: `/capturas/${encodeURIComponent(file)}`,
      mtime: fs.statSync(path.join(capturas, file)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ name, url, file }) => ({ name, url, file }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 12 * 1024 * 1024) {
        reject(new Error("grande"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function serveFile(res, filePath) {
  const rel = path.relative(root, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    send(res, 403, "no");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, "no está");
      return;
    }
    send(res, 200, data, types[path.extname(filePath).toLowerCase()] || "application/octet-stream");
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname === "/api/capturas" && req.method === "GET") {
    send(res, 200, JSON.stringify(listCapturas()), "application/json; charset=utf-8");
    return;
  }
  if (url.pathname === "/api/capturas" && req.method === "POST") {
    try {
      const data = JSON.parse(await readBody(req));
      const png = String(data.png || "");
      const match = png.match(/^data:image\/png;base64,(.+)$/);
      if (!match) {
        send(res, 400, "falta la imagen");
        return;
      }
      const file = uniqueFile(safeName(data.name));
      fs.writeFileSync(path.join(capturas, file), Buffer.from(match[1], "base64"));
      send(
        res,
        200,
        JSON.stringify({ file, url: `/capturas/${encodeURIComponent(file)}` }),
        "application/json; charset=utf-8"
      );
    } catch {
      send(res, 400, "no se pudo guardar");
    }
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.normalize(path.join(root, pathname));
  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) {
      serveFile(res, path.join(filePath, "index.html"));
      return;
    }
    serveFile(res, filePath);
  });
});

server.listen(port, () => {
  console.log(`Estiba 3D en http://localhost:${port}`);
});
