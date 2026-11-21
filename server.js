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

const indexPath = path.join(capturas, "indice.json");

function readIndex() {
  try {
    const data = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeDocumentation(items) {
  const lines = [
    "# Capturas para el procedimiento",
    "",
    "Cada imagen está en esta carpeta. La observación es lo que esa imagen tiene que transmitir cuando se arme o se mejore el instructivo.",
    "",
  ];
  for (const item of items) {
    lines.push(`## ${item.nombre}`);
    lines.push("");
    lines.push(`- Imagen: \`${item.archivo}\``);
    lines.push(`- Fecha: ${item.fecha}`);
    lines.push("");
    lines.push(item.observacion || "_Sin observación._");
    lines.push("");
  }
  fs.writeFileSync(path.join(capturas, "documentacion.md"), `${lines.join("\n")}\n`, "utf8");
}

function forgetCaptura(file) {
  const target = path.join(capturas, file);
  const hadFile = fs.existsSync(target);
  if (hadFile) fs.unlinkSync(target);
  const before = readIndex();
  const hadNote = before.some((item) => item.archivo === file);
  const files = new Set(
    fs
      .readdirSync(capturas)
      .filter((name) => name.toLowerCase().endsWith(".png"))
  );
  const items = before.filter((item) => files.has(item.archivo) && item.archivo !== file);
  fs.writeFileSync(indexPath, JSON.stringify(items, null, 2), "utf8");
  writeDocumentation(items);
  return hadFile || hadNote;
}

function rememberCaptura(entry) {
  const files = new Set(
    fs
      .readdirSync(capturas)
      .filter((file) => file.toLowerCase().endsWith(".png"))
  );
  const items = readIndex().filter(
    (item) => files.has(item.archivo) && item.archivo !== entry.archivo
  );
  items.unshift(entry);
  fs.writeFileSync(indexPath, JSON.stringify(items, null, 2), "utf8");
  writeDocumentation(items);
}

function listCapturas() {
  const notes = new Map(readIndex().map((item) => [item.archivo, item]));
  return fs
    .readdirSync(capturas)
    .filter((file) => file.toLowerCase().endsWith(".png"))
    .map((file) => {
      const note = notes.get(file);
      return {
        file,
        name: note?.nombre || file.replace(/\.png$/i, ""),
        url: `/capturas/${encodeURIComponent(file)}`,
        observacion: note?.observacion || "",
        fecha: note?.fecha || "",
        tieneEscena: Array.isArray(note?.escena?.boxes),
        mtime: fs.statSync(path.join(capturas, file)).mtimeMs,
      };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ name, url, file, observacion, fecha, tieneEscena }) => ({
      name,
      url,
      file,
      observacion,
      fecha,
      tieneEscena,
    }));
}

function shotFile(raw) {
  const file = path.basename(String(raw || ""));
  if (!/^[\w.-]+\.png$/i.test(file)) return "";
  return file;
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sceneFrom(data) {
  if (!data || !Array.isArray(data.boxes)) return null;
  return {
    pallet: {
      l: numberOr(data.pallet?.l, 120),
      w: numberOr(data.pallet?.w, 100),
      h: numberOr(data.pallet?.h, 14.5),
    },
    boxes: data.boxes.slice(0, 500).map((b, i) => ({
      id: numberOr(b.id, i + 1),
      x: numberOr(b.x, 0),
      y: numberOr(b.y, 0),
      z: numberOr(b.z, 0),
      rot: numberOr(b.rot, 0),
      h: numberOr(b.h, 0),
      kind: ["comun", "madera", "chata", "cuatro"].includes(b.kind) ? b.kind : "comun",
      color: typeof b.color === "string" ? b.color.slice(0, 20) : "",
      label: typeof b.label === "string" ? b.label.slice(0, 18) : "",
    })),
    camera: data.camera
      ? {
          x: numberOr(data.camera.x, 90),
          y: numberOr(data.camera.y, 120),
          z: numberOr(data.camera.z, -170),
          tx: numberOr(data.camera.tx, 0),
          ty: numberOr(data.camera.ty, 18),
          tz: numberOr(data.camera.tz, 0),
          fov: numberOr(data.camera.fov, 36),
        }
      : null,
  };
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
    const archivo = shotFile(url.searchParams.get("archivo"));
    if (url.searchParams.has("archivo")) {
      const item = archivo && readIndex().find((entry) => entry.archivo === archivo);
      if (!item) {
        send(res, 404, "no está");
        return;
      }
      send(res, 200, JSON.stringify(item), "application/json; charset=utf-8");
      return;
    }
    send(res, 200, JSON.stringify(listCapturas()), "application/json; charset=utf-8");
    return;
  }
  if (url.pathname === "/api/capturas" && req.method === "DELETE") {
    const archivo = shotFile(url.searchParams.get("archivo"));
    if (!archivo) {
      send(res, 400, "falta el archivo");
      return;
    }
    if (!forgetCaptura(archivo)) {
      send(res, 404, "no está");
      return;
    }
    send(res, 200, JSON.stringify({ file: archivo }), "application/json; charset=utf-8");
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
      const replace = shotFile(data.file);
      const file =
        replace && fs.existsSync(path.join(capturas, replace))
          ? replace
          : uniqueFile(safeName(data.name));
      const observacion = String(data.observacion || "")
        .replace(/\r\n/g, "\n")
        .trim()
        .slice(0, 800);
      const nombre = String(data.name || file).trim().slice(0, 80) || file;
      fs.writeFileSync(path.join(capturas, file), Buffer.from(match[1], "base64"));
      rememberCaptura({
        archivo: file,
        nombre,
        observacion,
        fecha: new Date().toLocaleString("es-AR", {
          dateStyle: "short",
          timeStyle: "short",
        }),
        escena: sceneFrom(data.escena),
      });
      send(
        res,
        200,
        JSON.stringify({ file, url: `/capturas/${encodeURIComponent(file)}`, observacion }),
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
