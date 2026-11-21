import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Caja parada: las botellas van de pie. Alto 33 cm, fondo de fila 25 cm.
// El frente se ajusta a 50/3 cm (16,67) para que la traba cierre sin sobresalir:
// 3 frentes = 2 fondos = 50 cm. La base de 6 (2 × 25 por 3 × 16,67) y la de arriba
// (3 × 16,67 por 2 × 25) son el mismo cuadrado de 50 × 50.
// Con esa misma cuenta, 6 cajas atravesadas miden 100 cm, igual que 4 filas de 25,
// y 7 de frente miden 116,67 cm, igual que dos medias (2 × 16,67 + 25 = 58,33).
const BOX = { frente: 50 / 3, fila: 25, h: 33 };
const pallet = { l: 120, w: 100, h: 14.5 };

const COLORS = [
  { name: "Kraft", hex: "#c4a36e" },
  { name: "Kraft oscuro", hex: "#9a7049" },
  { name: "Vino", hex: "#8a4548" },
  { name: "Verde", hex: "#6a764e" },
  { name: "Azul", hex: "#59697f" },
  { name: "Claro", hex: "#d4cfc4" },
  { name: "Bordó", hex: "#6e3540" },
  { name: "Mostaza", hex: "#b8913e" },
];

const $ = (id) => document.getElementById(id);
const round2 = (n) => Math.round(n * 100) / 100;
const cm = (n) =>
  `${Number(n).toLocaleString("es-AR", { maximumFractionDigits: 1 })} cm`;

const paint = { color: COLORS[0].hex, label: "", kind: "comun" };
let boxes = [];
let nextId = 1;
let selectedId = null;
let history = [];
let future = [];
let activePreset = "base28";
let viewName = "tres";
let showNumbers = false;
let showCenter = true;
let showDims = true;
let seeThrough = false;
let allowOverhang = false;
let placeLevel = 0;
let dragging = false;
let dragOffsetX = 0;
let dragOffsetZ = 0;
let hintTimer = 0;

const labelCache = new Map();
const numberCache = new Map();

function poseOf(rot, kind = "comun") {
  if (kind === "chata" || kind === "cuatro") {
    const largo = 2 * BOX.frente;
    const ancho = kind === "cuatro" ? BOX.h : 2 * BOX.fila;
    const espesor = BOX.h / 4;
    if (kind === "cuatro") {
      if (rot === 2) return { sx: espesor, sz: ancho, h: largo };
      if (rot === 3) return { sx: ancho, sz: espesor, h: largo };
      if (rot === 4) return { sx: largo, sz: espesor, h: ancho };
      if (rot === 5) return { sx: espesor, sz: largo, h: ancho };
    } else {
      if (rot === 2) return { sx: espesor, sz: ancho, h: largo };
      if (rot === 3) return { sx: largo, sz: espesor, h: ancho };
    }
    const pose = { sx: largo, sz: ancho, h: espesor };
    return rot % 2 === 1 ? { sx: pose.sz, sz: pose.sx, h: pose.h } : pose;
  }
  const frente = kind === "madera" ? BOX.frente * 2 : BOX.frente;
  if (rot === 2 || rot === 3) {
    const largo = kind === "madera" ? frente : BOX.h;
    const pose = { sx: largo, sz: BOX.fila, h: BOX.frente };
    return rot === 3 ? { sx: pose.sz, sz: pose.sx, h: pose.h } : pose;
  }
  return rot === 1
    ? { sx: BOX.fila, sz: frente, h: BOX.h }
    : { sx: frente, sz: BOX.fila, h: BOX.h };
}

function isFlat(kind) {
  return kind === "chata" || kind === "cuatro";
}

function turnCount(kind) {
  return kind === "cuatro" ? 6 : 4;
}

function sizeOf(b) {
  const pose = poseOf(b.rot, b.kind);
  return { sx: pose.sx, sz: pose.sz };
}

function overlapXZ(a, b, pad = 0.25) {
  const A = sizeOf(a);
  const B = sizeOf(b);
  return (
    a.x < b.x + B.sx - pad &&
    a.x + A.sx > b.x + pad &&
    a.z < b.z + B.sz - pad &&
    a.z + A.sz > b.z + pad
  );
}

function overlap3D(a, b) {
  if (!overlapXZ(a, b)) return false;
  return a.y < b.y + b.h - 0.25 && a.y + a.h > b.y + 0.25;
}

function supportHeight(b) {
  let y = pallet.h;
  for (const o of boxes) {
    if (o.id === b.id) continue;
    if (!overlapXZ(b, o)) continue;
    y = Math.max(y, o.y + o.h);
  }
  return y;
}

function hangs(b) {
  const { sx, sz } = sizeOf(b);
  return b.x < -0.4 || b.z < -0.4 || b.x + sx > pallet.l + 0.4 || b.z + sz > pallet.w + 0.4;
}

function clampBox(b) {
  if (allowOverhang) return;
  const { sx, sz } = sizeOf(b);
  const maxX = Math.max(0, pallet.l - sx);
  const maxZ = Math.max(0, pallet.w - sz);
  b.x = Math.min(Math.max(0, b.x), maxX);
  b.z = Math.min(Math.max(0, b.z), maxZ);
}

function snapValue(value, size, anchors) {
  let best = null;
  let bestD = 5;
  for (const a of anchors) {
    for (const c of [a, a - size]) {
      const d = Math.abs(value - c);
      if (d < bestD) {
        best = c;
        bestD = d;
      }
    }
  }
  if (best !== null) return round2(best);
  return Math.round(value * 2) / 2;
}

function snapBox(b) {
  const { sx, sz } = sizeOf(b);
  const ax = [0, pallet.l, pallet.l / 2];
  const az = [0, pallet.w, pallet.w / 2];
  for (const o of boxes) {
    if (o.id === b.id) continue;
    const s = sizeOf(o);
    ax.push(o.x, o.x + s.sx);
    az.push(o.z, o.z + s.sz);
  }
  b.x = snapValue(b.x, sx, ax);
  b.z = snapValue(b.z, sz, az);
}

function settle() {
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.id - b.id);
  const placed = [];
  for (const b of sorted) {
    let y = pallet.h;
    for (const o of placed) {
      if (!overlapXZ(b, o)) continue;
      y = Math.max(y, o.y + o.h);
    }
    b.y = y;
    placed.push(b);
  }
}

function captureState() {
  return boxes.map((b) => ({
    id: b.id,
    x: b.x,
    y: b.y,
    z: b.z,
    rot: b.rot,
    h: b.h,
    kind: b.kind,
    color: b.color,
    label: b.label,
  }));
}

function pushHistory() {
  history.push(captureState());
  if (history.length > 80) history.shift();
  future = [];
  updateUndoButtons();
}

function spec(x, z, rot, level, color = COLORS[0].hex, label = "") {
  return { x, z, rot, level, color, label, kind: "comun" };
}

function halfWidth() {
  return 2 * BOX.frente + BOX.fila;
}

function halfPattern(originX, level, order, color, label) {
  const straight = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 2; col++) {
      straight.push({ dx: col * BOX.frente, dz: row * BOX.fila, rot: 0 });
    }
  }
  const z0 = (4 * BOX.fila - 6 * BOX.frente) / 2;
  const cross = [];
  for (let row = 0; row < 6; row++) {
    cross.push({ dx: 0, dz: z0 + row * BOX.frente, rot: 1 });
  }
  const crossFirst = order === "cross";
  const blocks = crossFirst ? [cross, straight] : [straight, cross];
  const widths = crossFirst ? [BOX.fila, 2 * BOX.frente] : [2 * BOX.frente, BOX.fila];
  const out = [];
  let x0 = originX;
  blocks.forEach((block, i) => {
    for (const p of block) out.push(spec(x0 + p.dx, p.dz, p.rot, level, color, label));
    x0 += widths[i];
  });
  return out;
}

function trabadoPiso(level) {
  const w = halfWidth();
  const x0 = (pallet.l - 2 * w) / 2;
  return [...halfPattern(x0, level, "cross"), ...halfPattern(x0 + w, level, "straight")];
}

function base28(level, color = COLORS[0].hex, label = "") {
  const x0 = (pallet.l - 7 * BOX.frente) / 2;
  const out = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 7; col++) {
      out.push(spec(x0 + col * BOX.frente, row * BOX.fila, 0, level, color, label));
    }
  }
  return out;
}

function block6(level, turned) {
  const out = [];
  if (!turned) {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 2; col++) {
        out.push(spec(col * BOX.fila, row * BOX.frente, 1, level));
      }
    }
    return out;
  }
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      out.push(spec(col * BOX.frente, row * BOX.fila, 0, level));
    }
  }
  return out;
}

function base5(level, sign, color, label) {
  const zFront = 20;
  const zBack = 20 + BOX.fila;
  const out = [];
  const xAt = (i) =>
    sign > 0 ? pallet.l / 2 + i * BOX.frente : pallet.l / 2 - (i + 1) * BOX.frente;
  for (let i = 0; i < 3; i++) out.push(spec(xAt(i), zFront, 0, level, color, label));
  for (let i = 0; i < 2; i++) out.push(spec(xAt(i), zBack, 0, level, color, label));
  return out;
}

const PRESETS = [
  {
    group: "Armado libre",
    id: "libre",
    name: "Modo libre · pallet vacío",
    detail:
      "Pallet vacío para armar cualquier cantidad. Normal la apoya de frente, Atravesada la cruza y Acostada la tira. Otro doble clic la deja acostada, pero de costado. Dos acostadas, una sobre la otra, equivalen a dos paradas juntas.",
    build: () => [],
  },
  {
    group: "Pallet entero",
    id: "base28",
    name: "Base normal · 28 cajas",
    detail:
      "4 filas de 7. Es la base de un pallet de un solo producto: 2 pisos son 56 cajas y 3 pisos son 84.",
    build: () => base28(0),
  },
  {
    group: "Pallet entero",
    id: "p2",
    name: "2 pisos trabados · 56",
    detail:
      "Abajo, la base de 28. Arriba, las cajas van atravesadas para que las juntas no coincidan y la estiba trabe. Cada piso mide 33 cm.",
    build: () => [...base28(0), ...trabadoPiso(1)],
  },
  {
    group: "Pallet entero",
    id: "p3",
    name: "3 pisos trabados · 84",
    detail:
      "Tres pisos de 33 cm. El del medio va en posición opuesta, así cada junta queda tapada por una caja.",
    build: () => [...base28(0), ...trabadoPiso(1), ...base28(2)],
  },
  {
    group: "Mitades y cuartos",
    id: "media",
    name: "Media base · 14 cajas",
    detail:
      "4 filas de 2 y, al lado, 6 cajas atravesadas en una columna. Las atravesadas llegan justo al fondo. Mide 58,3 × 100 cm: la mitad de la base de 28.",
    build: () => halfPattern(0, 0, "straight"),
  },
  {
    group: "Mitades y cuartos",
    id: "mediaUp",
    name: "La misma media, piso de arriba",
    detail:
      "Las mismas 14 cajas, con los bloques al revés. Es la posición opuesta: ocupa el mismo lugar y traba a la de abajo.",
    build: () => halfPattern(0, 0, "cross"),
  },
  {
    group: "Mitades y cuartos",
    id: "mediaTrabada",
    name: "Media trabada · 14 + 14",
    detail:
      "Un piso con 4 filas de 2 y 6 atravesadas, y arriba la trama invertida. Las dos capas ocupan la misma mitad del pallet.",
    build: () => [...halfPattern(0, 0, "straight"), ...halfPattern(0, 1, "cross")],
  },
  {
    group: "Mitades y cuartos",
    id: "cuarto",
    name: "Un cuarto · fila de 7",
    detail:
      "Una sola fila de 7 cajas paradas. Son 25 cm de fondo: un cuarto de los 100 cm del pallet.",
    build: () => {
      const x0 = (pallet.l - 7 * BOX.frente) / 2;
      return Array.from({ length: 7 }, (_, col) => spec(x0 + col * BOX.frente, 0, 0, 0));
    },
  },
  {
    group: "Bloque de 6",
    id: "b6",
    name: "Base de 6 · cuadrada",
    detail:
      "2 × 3 cajas atravesadas en el rincón de adelante, a la izquierda. Ocupan 50 × 50 cm y el resto del pallet queda libre.",
    build: () => block6(0, false),
  },
  {
    group: "Bloque de 6",
    id: "b6t",
    name: "6 abajo + 6 arriba, trabado",
    detail:
      "En el rincón de adelante: abajo 2 × 3 y arriba 3 × 2. El mismo cuadrado de 50 × 50, sin que nada sobresalga, y al lado se ve el lugar que queda.",
    build: () => [...block6(0, false), ...block6(1, true)],
  },
  {
    group: "Norma de armado",
    id: "e9",
    name: "9 cajas · base de 3 con traba",
    detail:
      "Tres abajo y tres en el medio, paradas. Arriba, una parada y dos acostadas una sobre la otra: llegan casi a la misma altura y traban lo justo para circular.",
    build: () => {
      const f = BOX.frente;
      const x0 = pallet.l / 2;
      const z = (pallet.w - BOX.fila) / 2;
      const out = [];
      for (const level of [0, 1]) {
        for (let i = 0; i < 3; i++) out.push(spec(x0 + i * f, z, 0, level));
      }
      out.push(spec(x0, z, 0, 2));
      out.push(spec(x0 + f, z, 2, 2));
      out.push(spec(x0 + f, z, 2, 2));
      return out;
    },
  },
  {
    group: "Norma de armado",
    id: "e5",
    name: "5 cajas · base de 3 y 2 arriba",
    detail:
      "Desde el centro hacia afuera. Abajo hay 3 y arriba 2: el hueco queda del lado de afuera, para contar desde el centro.",
    build: () => {
      const z = (pallet.w - BOX.fila) / 2;
      const x0 = pallet.l / 2;
      const out = [];
      for (let i = 0; i < 3; i++) out.push(spec(x0 + i * BOX.frente, z, 0, 0));
      for (let i = 0; i < 2; i++) out.push(spec(x0 + i * BOX.frente, z, 0, 1));
      return out;
    },
  },
  {
    group: "Norma de armado",
    id: "e15",
    name: "15 cajas · base de 5, 3 pisos",
    detail:
      "Una base de 5 (3 adelante y 2 atrás) desde el centro hacia un costado, repetida en 3 pisos. 5 × 3 = 15.",
    build: () => [0, 1, 2].flatMap((level) => base5(level, 1, "#6a764e", "")),
  },
  {
    group: "Norma de armado",
    id: "e30",
    name: "30 cajas · dos bases de 5",
    detail:
      "Una base de 5 hacia cada lado del centro, en 3 pisos. Dos productos distintos, para que se vea el corte en el medio.",
    build: () => {
      const out = [];
      for (const level of [0, 1, 2]) {
        out.push(...base5(level, -1, "#8a4548", "A"));
        out.push(...base5(level, 1, "#59697f", "B"));
      }
      return out;
    },
  },
];

const canvas = $("c");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0xefeae3, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 1, 4000);
camera.position.set(90, 120, -170);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = false;
controls.target.set(0, 18, 0);
controls.minDistance = 40;
controls.maxDistance = 1600;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
controls.minPolarAngle = 0.12;
controls.update();

canvas.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const line = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    controls._pan(event.deltaX * line * 0.85, event.deltaY * line * 0.85);
    controls.update();
    renderer.render(scene, camera);
  },
  { passive: false, capture: true }
);

scene.add(new THREE.HemisphereLight(0xfff6ea, 0xd9cbb8, 0.72));
const ambient = new THREE.AmbientLight(0xffffff, 0.28);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xfff5e8, 1.35);
sun.position.set(-90, 220, -70);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -180;
sun.shadow.camera.right = 180;
sun.shadow.camera.top = 140;
sun.shadow.camera.bottom = -140;
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 520;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.04;
scene.add(sun);
scene.add(sun.target);

const fill = new THREE.DirectionalLight(0xe7eef8, 0.38);
fill.position.set(40, 80, 140);
scene.add(fill);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000),
  new THREE.MeshStandardMaterial({ color: 0xefeae3, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const edgeMat = new THREE.LineBasicMaterial({ color: 0x3d2e22 });
edgeMat.userData.shared = true;
const selMat = new THREE.LineBasicMaterial({ color: 0x8f1d2c });
selMat.userData.shared = true;

let palletGroup = null;
let centerLine = null;
let centerCross = null;
let dimGroup = null;

function makeWoodTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#c49262";
  g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = `rgba(90, 52, 24, ${0.05 + (i % 4) * 0.035})`;
    g.lineWidth = 1 + (i % 3);
    g.beginPath();
    const y = (i + 0.5) * (128 / 26);
    g.moveTo(0, y);
    g.bezierCurveTo(140, y + 3, 300, y - 4, 512, y + 1);
    g.stroke();
  }
  g.fillStyle = "rgba(120, 72, 32, 0.18)";
  g.beginPath();
  g.ellipse(180, 70, 10, 6, 0.4, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.userData.shared = true;
  return tex;
}

const woodTex = makeWoodTexture();

function woodMaterial(lightness, seed) {
  const mat = new THREE.MeshStandardMaterial({
    map: woodTex,
    roughness: 0.9,
    metalness: 0,
  });
  mat.color.setHSL(0.07, 0.46, lightness);
  mat.userData.seed = seed;
  return mat;
}

function makeTextSprite(text, widthCm) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(255, 250, 244, 0.94)";
  roundRect(g, 6, 28, 500, 72, 18);
  g.fill();
  g.fillStyle = "#2c241c";
  g.font = "600 48px Segoe UI, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  mat.userData.shared = false;
  const s = new THREE.Sprite(mat);
  const h = widthCm * (128 / 512);
  s.scale.set(widthCm, h, 1);
  s.renderOrder = 20;
  return s;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function buildPallet() {
  if (palletGroup) {
    scene.remove(palletGroup);
    disposeObject(palletGroup);
  }
  palletGroup = new THREE.Group();
  const L = pallet.l;
  const W = pallet.w;
  const H = pallet.h;
  const deckT = 2.2;
  const botT = 2.0;
  const strH = H - deckT - botT;
  const strW = 9;
  const zs = [-W / 2 + strW / 2 + 2, 0, W / 2 - strW / 2 - 2];
  for (const z of zs) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(L - 2, strH, strW), woodMaterial(0.34, z));
    m.position.set(0, botT + strH / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    palletGroup.add(m);
  }

  let n = Math.max(6, Math.round(L / 14.5));
  const plankW = 10.5;
  while (n * plankW > L - 4) n -= 1;
  const gap = n > 1 ? (L - n * plankW) / (n - 1) : 0;
  let x = -L / 2 + plankW / 2;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(plankW, deckT, W),
      woodMaterial(0.42 + (i % 5) * 0.025, i)
    );
    m.position.set(x, H - deckT / 2, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    palletGroup.add(m);
    x += plankW + gap;
  }

  for (const bx of [-L / 2 + 10, 0, L / 2 - 10]) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(12, botT, W - 6),
      woodMaterial(0.36, bx)
    );
    m.position.set(bx, botT / 2, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    palletGroup.add(m);
  }

  const centerMat = () => new THREE.MeshBasicMaterial({ color: 0x8f1d2c });
  centerLine = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, W + 18), centerMat());
  centerLine.position.set(0, H + 0.08, 0);
  centerLine.visible = showCenter;
  palletGroup.add(centerLine);

  centerCross = new THREE.Mesh(new THREE.BoxGeometry(L + 18, 0.12, 0.5), centerMat());
  centerCross.position.set(0, H + 0.16, 0);
  centerCross.visible = showCenter;
  palletGroup.add(centerCross);

  dimGroup = new THREE.Group();
  dimGroup.visible = showDims;
  const len = makeTextSprite(cm(L), 42);
  len.position.set(0, H + 6, -W / 2 - 16);
  const wid = makeTextSprite(cm(W), 36);
  wid.position.set(-L / 2 - 18, H + 8, 0);
  const boxLabel = makeTextSprite("Caja parada · alto 33", 52);
  boxLabel.position.set(-L / 2 + 36, H + 18, -W / 2 - 16);
  const frente = makeTextSprite("FRENTE", 28);
  frente.position.set(L / 4, H + 6, -W / 2 - 16);
  dimGroup.add(len, wid, boxLabel, frente);
  palletGroup.add(dimGroup);

  scene.add(palletGroup);
}

function labelTexture(text) {
  const key = text || "";
  if (labelCache.has(key)) return labelCache.get(key);
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#f4efe4";
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = "#6b5344";
  g.lineWidth = 8;
  g.strokeRect(6, 6, 244, 116);
  g.fillStyle = "#2c241c";
  g.textAlign = "center";
  g.textBaseline = "middle";
  if (key) {
    g.font = "700 42px Segoe UI, sans-serif";
    g.fillText(key.toUpperCase(), 128, 66, 220);
  } else {
    g.fillStyle = "#d9d0c2";
    g.fillRect(36, 38, 184, 12);
    g.fillRect(36, 60, 140, 12);
    g.fillRect(36, 82, 96, 12);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData.shared = true;
  labelCache.set(key, tex);
  return tex;
}

function numberTexture(n) {
  if (numberCache.has(n)) return numberCache.get(n);
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(255, 250, 242, 0.94)";
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = "#7a2f38";
  g.stroke();
  g.fillStyle = "#2a2118";
  g.font = "700 62px Segoe UI, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(n), 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.shared = true;
  numberCache.set(n, tex);
  return tex;
}

function cartonQuaternion(rot, kind = "comun") {
  const q = new THREE.Quaternion();
  const x = new THREE.Vector3(1, 0, 0);
  const y = new THREE.Vector3(0, 1, 0);
  const z = new THREE.Vector3(0, 0, 1);
  if (rot === 1) q.setFromAxisAngle(y, Math.PI / 2);
  else if (rot === 2) q.setFromAxisAngle(z, -Math.PI / 2);
  else if (rot === 3 && kind === "chata") q.setFromAxisAngle(x, -Math.PI / 2);
  else if (rot === 3) {
    const qz = new THREE.Quaternion().setFromAxisAngle(z, -Math.PI / 2);
    const qy = new THREE.Quaternion().setFromAxisAngle(y, Math.PI / 2);
    q.multiplyQuaternions(qy, qz);
  } else if (rot === 4 && kind === "cuatro") q.setFromAxisAngle(x, -Math.PI / 2);
  else if (rot === 5 && kind === "cuatro") {
    const qx = new THREE.Quaternion().setFromAxisAngle(x, -Math.PI / 2);
    const qy = new THREE.Quaternion().setFromAxisAngle(y, Math.PI / 2);
    q.multiplyQuaternions(qy, qx);
  }
  return q;
}

function cartonTurnFits(kind, rot) {
  if (!rot) return true;
  const stand = poseOf(0, kind);
  const posed = poseOf(rot, kind);
  const q = cartonQuaternion(rot, kind);
  const ex = new THREE.Vector3(stand.sx, 0, 0).applyQuaternion(q);
  const ey = new THREE.Vector3(0, stand.h, 0).applyQuaternion(q);
  const ez = new THREE.Vector3(0, 0, stand.sz).applyQuaternion(q);
  const near = (a, b) => Math.abs(a - b) < 0.2;
  return (
    near(Math.abs(ex.x) + Math.abs(ey.x) + Math.abs(ez.x), posed.sx) &&
    near(Math.abs(ex.y) + Math.abs(ey.y) + Math.abs(ez.y), posed.h) &&
    near(Math.abs(ex.z) + Math.abs(ey.z) + Math.abs(ez.z), posed.sz)
  );
}

function createBoxGroup(b) {
  const stand = poseOf(0, b.kind);
  const turned = cartonTurnFits(b.kind, b.rot);
  const sx = turned ? stand.sx : sizeOf(b).sx;
  const sz = turned ? stand.sz : sizeOf(b).sz;
  const h = turned ? stand.h : b.h;
  const turn = turned ? cartonQuaternion(b.rot, b.kind) : new THREE.Quaternion();
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.userData.boxId = b.id;
  const geo = new THREE.BoxGeometry(sx - 0.3, h - 0.06, sz - 0.3);
  const body = new THREE.MeshStandardMaterial({
    color: b.color,
    roughness: 0.84,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, body);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  inner.add(mesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
  edges.renderOrder = 3;
  inner.add(edges);

  const sel = new THREE.LineSegments(new THREE.EdgesGeometry(geo), selMat);
  sel.scale.setScalar(1.035);
  sel.renderOrder = 4;
  sel.visible = false;
  inner.add(sel);

  if (!isFlat(b.kind)) {
    const longIsX = sx > sz;
    const seam = new THREE.Mesh(
      new THREE.BoxGeometry(longIsX ? sx * 0.72 : 0.4, 0.14, longIsX ? 0.4 : sz * 0.72),
      new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 1 })
    );
    seam.position.y = (h - 0.06) / 2 + 0.02;
    inner.add(seam);
  }

  if (isFlat(b.kind)) {
    const bottles = b.kind === "cuatro" ? 4 : 6;
    const step = sz / bottles;
    for (let i = 1; i < bottles; i++) {
      const groove = new THREE.Mesh(
        new THREE.BoxGeometry(sx * 0.78, 0.1, 0.35),
        new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 1 })
      );
      groove.position.z = -sz / 2 + i * step;
      groove.position.y = (h - 0.06) / 2 + 0.03;
      inner.add(groove);
    }
    const topLabel = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(Math.max(sx, sz) * 0.42, 26), Math.min(Math.min(sx, sz) * 0.38, 12)),
      new THREE.MeshBasicMaterial({ map: labelTexture(b.label) })
    );
    topLabel.rotation.x = -Math.PI / 2;
    topLabel.position.y = (h - 0.06) / 2 + 0.12;
    topLabel.userData.isLabel = true;
    inner.add(topLabel);
  }

  const labelH = Math.min(isFlat(b.kind) ? h * 0.62 : h * 0.4, 14);
  const facePointsUp = (nx, ny, nz) => {
    if (!turned || b.rot < 2) return true;
    return new THREE.Vector3(nx, ny, nz).applyQuaternion(turn).y > -0.5;
  };
  const sticker = (geo, rotY, x, y, z, normal) => {
    if (!facePointsUp(...normal)) return;
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ map: labelTexture(b.label) })
    );
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.userData.isLabel = true;
    inner.add(m);
  };
  const hy = b.kind === "madera" ? h * 0.12 : 0;
  const faceX = new THREE.PlaneGeometry(Math.min(sz * 0.72, 18), labelH);
  const faceZ = new THREE.PlaneGeometry(Math.min(sx * 0.72, 18), labelH);
  const xf = (sx - 0.3) / 2 + 0.12;
  const zf = (sz - 0.3) / 2 + 0.12;
  sticker(faceZ, 0, 0, hy, zf, [0, 0, 1]);
  sticker(faceZ, Math.PI, 0, hy, -zf, [0, 0, -1]);
  sticker(faceX, Math.PI / 2, xf, hy, 0, [1, 0, 0]);
  sticker(faceX, -Math.PI / 2, -xf, hy, 0, [-1, 0, 0]);

  if (b.kind === "madera") {
    for (const t of [-0.22, 0.22]) {
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(sx + 0.08, 0.45, sz + 0.08),
        new THREE.MeshStandardMaterial({ color: 0x4a3424, roughness: 1 })
      );
      band.position.y = h * t;
      inner.add(band);
    }
    const alongX = sx >= sz;
    const joint = new THREE.Mesh(
      new THREE.BoxGeometry(alongX ? 0.45 : sx * 0.9, 0.22, alongX ? sz * 0.9 : 0.45),
      new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 1 })
    );
    joint.position.y = (h - 0.06) / 2 + 0.05;
    inner.add(joint);
  }

  inner.quaternion.copy(turn);
  group.add(inner);

  const num = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: numberTexture(1), transparent: true, depthTest: false })
  );
  num.scale.set(11, 11, 1);
  num.position.y = b.h / 2 + 7;
  num.visible = showNumbers;
  num.renderOrder = 12;
  num.userData.n = 1;
  group.add(num);

  group.userData.body = body;
  group.userData.sel = sel;
  group.userData.num = num;
  return group;
}

function mount(b) {
  b.group = createBoxGroup(b);
  scene.add(b.group);
  syncTransform(b);
}

function syncTransform(b) {
  const { sx, sz } = sizeOf(b);
  b.group.position.set(
    b.x + sx / 2 - pallet.l / 2,
    b.y + b.h / 2,
    b.z + sz / 2 - pallet.w / 2
  );
}

function disposeObject(root) {
  const geos = new Set();
  root.traverse((obj) => {
    if (obj.geometry) geos.add(obj.geometry);
    const mats = obj.material
      ? Array.isArray(obj.material)
        ? obj.material
        : [obj.material]
      : [];
    for (const m of mats) {
      if (m.map && !m.map.userData?.shared) m.map.dispose();
      if (!m.userData?.shared) m.dispose();
    }
  });
  for (const geo of geos) geo.dispose();
}

function clearBoxes() {
  for (const b of boxes) {
    if (b.group) {
      scene.remove(b.group);
      disposeObject(b.group);
    }
  }
  boxes = [];
  selectedId = null;
}

function makeBox(item) {
  const kind = item.kind || "comun";
  return {
    id: nextId++,
    x: item.x,
    y: pallet.h + (item.level || 0) * BOX.h,
    z: item.z,
    rot: item.rot || 0,
    h:
      isFlat(kind) || item.rot >= 2
        ? poseOf(item.rot || 0, kind).h
        : item.h && kind !== "madera"
          ? item.h
          : BOX.h,
    kind,
    color: item.color || paint.color,
    label: item.label || "",
  };
}

function rebuild(b) {
  if (b.group) {
    scene.remove(b.group);
    disposeObject(b.group);
  }
  mount(b);
}

function selected() {
  return boxes.find((b) => b.id === selectedId) || null;
}

function renumber() {
  const levels = new Map();
  for (const b of boxes) {
    const level = Math.round((b.y - pallet.h) / BOX.h);
    if (!levels.has(level)) levels.set(level, []);
    levels.get(level).push(b);
  }
  const nums = new Map();
  for (const list of levels.values()) {
    list.sort((a, b) => {
      const ac = a.x + sizeOf(a).sx / 2;
      const bc = b.x + sizeOf(b).sx / 2;
      const d = Math.abs(ac - pallet.l / 2) - Math.abs(bc - pallet.l / 2);
      if (Math.abs(d) > 0.5) return d;
      if (Math.abs(a.z - b.z) > 0.5) return a.z - b.z;
      return a.x - b.x;
    });
    list.forEach((b, i) => nums.set(b.id, i + 1));
  }
  for (const b of boxes) {
    const sprite = b.group?.userData.num;
    if (!sprite) continue;
    const n = nums.get(b.id) || 0;
    if (sprite.userData.n !== n) {
      sprite.material.map = numberTexture(n);
      sprite.userData.n = n;
    }
    sprite.visible = showNumbers;
  }
}

function updateLooks() {
  edgeMat.transparent = seeThrough;
  edgeMat.opacity = 1;
  edgeMat.depthWrite = true;
  edgeMat.needsUpdate = true;
  selMat.transparent = seeThrough;
  selMat.opacity = 1;
  selMat.depthWrite = true;
  selMat.needsUpdate = true;
  for (const b of boxes) {
    const on = b.id === selectedId;
    const mat = b.group.userData.body;
    if (on) {
      mat.emissive.set("#6b2430");
      mat.emissiveIntensity = seeThrough ? 0.15 : 0.5;
    } else if (hangs(b)) {
      mat.emissive.set("#8a4b12");
      mat.emissiveIntensity = seeThrough ? 0.12 : 0.45;
    } else {
      mat.emissive.set("#000000");
      mat.emissiveIntensity = 0;
    }
    b.group.userData.sel.visible = on;
    b.group.traverse((obj) => {
      if (!obj.material || obj.isLine) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (m.userData?.shared) continue;
        m.transparent = seeThrough;
        m.opacity = seeThrough ? (obj.userData.isLabel ? 0.5 : 0.28) : 1;
        m.depthWrite = !seeThrough;
        m.side = seeThrough ? THREE.DoubleSide : THREE.FrontSide;
        m.needsUpdate = true;
      }
    });
  }
  if (centerLine) centerLine.visible = showCenter;
  if (centerCross) centerCross.visible = showCenter;
  if (dimGroup) dimGroup.visible = showDims;
}

function loadBounds() {
  if (!boxes.length) return null;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  let maxY = 0;
  for (const b of boxes) {
    const { sx, sz } = sizeOf(b);
    minX = Math.min(minX, b.x);
    minZ = Math.min(minZ, b.z);
    maxX = Math.max(maxX, b.x + sx);
    maxZ = Math.max(maxZ, b.z + sz);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { minX, minZ, maxX, maxZ, maxY, w: maxX - minX, d: maxZ - minZ };
}

function updateStatus() {
  const b = loadBounds();
  if (!b) {
    $("metrics").textContent = `Pallet ${cm(pallet.l)} × ${cm(pallet.w)} · sin cajas`;
    return;
  }
  const top = Math.max(...boxes.map((box) => box.y + box.h)) - pallet.h;
  const levels = Math.max(1, Math.round(top / BOX.h));
  let equiv = 0;
  for (const box of boxes) equiv += box.kind === "madera" ? 2 : 1;
  const extra = equiv === boxes.length ? "" : ` · equivalen a ${equiv} comunes`;
  const off = boxes.some(hangs) ? " · hay cajas fuera del pallet" : "";
  $("metrics").textContent =
    `${boxes.length} cajas · ${levels} ${levels === 1 ? "piso" : "pisos"} · ` +
    `ocupan ${cm(b.w)} × ${cm(b.d)} · alto ${cm(b.maxY - pallet.h)} · ` +
    `con pallet ${cm(b.maxY)}${extra}${off}`;
}

function hint(text) {
  $("hint").textContent = text;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    if ($("hint").textContent === text) $("hint").textContent = "";
  }, 5000);
}

function persist() {
  try {
    const data = {
      boxes: captureState(),
      nextId,
      palletL: pallet.l,
      palletW: pallet.w,
      preset: activePreset,
    };
    localStorage.setItem("estiba3d-v3", JSON.stringify(data));
  } catch {
    /* sin almacenamiento */
  }
}

function refresh() {
  renumber();
  updateLooks();
  updateStatus();
  syncInspector();
  updateFloorUi();
  persist();
}

function applyItems(items) {
  clearBoxes();
  for (const item of items) {
    const b = makeBox(item);
    boxes.push(b);
    mount(b);
  }
  settle();
  for (const b of boxes) syncTransform(b);
}

function applyPreset(id, { record = true } = {}) {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) return;
  if (record) pushHistory();
  placeLevel = 0;
  activePreset = id;
  applyItems(preset.build());
  $("detail").textContent = preset.detail;
  for (const btn of document.querySelectorAll("#presets button")) {
    btn.classList.toggle("active", btn.dataset.preset === id);
  }
  setView(viewName === "arriba" ? "arriba" : "tres");
  refresh();
}

function markLibre() {
  activePreset = "libre";
  const preset = PRESETS.find((p) => p.id === "libre");
  if (preset) $("detail").textContent = preset.detail;
  for (const btn of document.querySelectorAll("#presets button")) {
    btn.classList.toggle("active", btn.dataset.preset === "libre");
  }
}

function stackTops() {
  const tops = new Set();
  for (const o of boxes) {
    const top = round2(o.y + o.h);
    if (top > pallet.h + 0.4) tops.add(top);
  }
  return [...tops].sort((a, b) => a - b);
}

function findSpot(rot, level) {
  const { sx, sz, h } = poseOf(rot, paint.kind);
  const tops = stackTops();
  const y = level <= 0 ? pallet.h : tops[level - 1] ?? tops[tops.length - 1] ?? pallet.h + level * BOX.h;
  const xs = new Set([0]);
  const zs = new Set([0]);
  for (let i = 1; i * sx <= pallet.l - sx + 0.01; i++) xs.add(i * sx);
  for (let i = 1; i * sz <= pallet.w - sz + 0.01; i++) zs.add(i * sz);
  for (const o of boxes) {
    const s = sizeOf(o);
    xs.add(o.x);
    xs.add(o.x + s.sx);
    zs.add(o.z);
    zs.add(o.z + s.sz);
  }
  const xList = [...xs].filter((x) => x >= -0.01 && x + sx <= pallet.l + 0.4).sort((a, b) => a - b);
  const zList = [...zs].filter((z) => z >= -0.01 && z + sz <= pallet.w + 0.4).sort((a, b) => a - b);
  for (const z of zList) {
    for (const x of xList) {
      const probe = { id: -1, x, z, rot, y, h, kind: paint.kind };
      const blocked = boxes.some((o) => overlapXZ(probe, o) && overlapY(probe, o));
      if (blocked) continue;
      if (level > 0 && !restsOn(probe)) continue;
      return { x, z, y };
    }
  }
  return null;
}

function overlapY(a, b) {
  return a.y < b.y + b.h - 0.25 && a.y + a.h > b.y + 0.25;
}

function restsOn(probe) {
  const { sx, sz } = sizeOf(probe);
  return boxes.some((o) => {
    const s = sizeOf(o);
    const top = o.y + o.h;
    if (top > probe.y + 0.6 || top < probe.y - 0.6) return false;
    const overlapX = Math.min(probe.x + sx, o.x + s.sx) - Math.max(probe.x, o.x);
    const overlapZ = Math.min(probe.z + sz, o.z + s.sz) - Math.max(probe.z, o.z);
    return overlapX > 8 && overlapZ > 8;
  });
}

function addBox(rot) {
  const poseRot = isFlat(paint.kind) && rot === 2 ? 0 : rot;
  const spot = findSpot(poseRot, placeLevel);
  if (!spot) {
    hint(
      placeLevel === 0
        ? "No entra otra caja en la base."
        : "En este piso no entra otra. Bajá un piso o seguí en otro lugar arrastrando."
    );
    return;
  }
  pushHistory();
  const b = {
    id: nextId++,
    x: spot.x,
    y: spot.y,
    z: spot.z,
    rot: poseRot,
    h: poseOf(poseRot, paint.kind).h,
    kind: paint.kind,
    color: paint.color,
    label: paint.label,
  };
  b.y = supportHeight(b);
  clampBox(b);
  boxes.push(b);
  mount(b);
  selectedId = b.id;
  markLibre();
  refresh();
  hint(
    paint.kind === "cuatro"
      ? "4 botellas, acostada. Casi cuadrada. Parada, el doble clic la gira para los dos lados."
      : paint.kind === "chata"
      ? "Chata acostada. Doble clic: de costado, parada sobre la base de la botella, o parada sobre el costado."
      : placeLevel === 0
        ? "Caja en la base, desde el rincón. Arrastrala si querés correrla."
        : `Caja en el piso ${placeLevel + 1}. Girala con el botón si hace falta trabar.`
  );
}

function encimar() {
  placeLevel = Math.min(16, placeLevel + 1);
  updateFloorUi();
  hint(
    `Piso ${placeLevel + 1}. La próxima caja se apoya arriba. Atravesada la cruza para trabar.`
  );
}

function bajarPiso() {
  if (placeLevel === 0) return;
  placeLevel -= 1;
  updateFloorUi();
  hint(placeLevel === 0 ? "De nuevo en la base, desde el rincón." : `Piso ${placeLevel + 1}.`);
}

function updateFloorUi() {
  const label = $("floorLabel");
  if (!label) return;
  label.textContent =
    placeLevel === 0
      ? "Las cajas nuevas van en la base, desde el rincón de adelante."
      : `Las cajas nuevas van en el piso ${placeLevel + 1}, arriba de lo que ya está.`;
  const down = $("downLevel");
  if (down) down.disabled = placeLevel === 0;
}

function rotateSelected() {
  const b = selected();
  if (!b) {
    hint("Primero elegí una caja.");
    return;
  }
  pushHistory();
  const { sx, sz } = sizeOf(b);
  const cx = b.x + sx / 2;
  const cz = b.z + sz / 2;
  b.rot = ((b.rot || 0) + 1) % turnCount(b.kind);
  b.h = poseOf(b.rot, b.kind).h;
  const n = sizeOf(b);
  b.x = round2(cx - n.sx / 2);
  b.z = round2(cz - n.sz / 2);
  snapBox(b);
  clampBox(b);
  b.y = supportHeight(b);
  rebuild(b);
  settle();
  for (const o of boxes) syncTransform(o);
  activePreset = "libre";
  clearPresetHighlight();
  refresh();
  hint(
    b.kind === "cuatro"
      ? [
          "4 botellas, acostada. Casi cuadrada.",
          "4 botellas, acostada de costado.",
          "Parada sobre la base de la botella.",
          "La misma parada, ahora para el otro lado.",
          "Parada sobre el costado de la botella.",
          "El costado, girado para el otro lado.",
        ][b.rot] || "4 botellas."
      : b.kind === "chata"
      ? b.rot === 3
        ? "Chata parada. Apoya el costado de la botella."
        : b.rot === 2
          ? "Chata parada. Apoya la base de la botella."
          : b.rot === 1
            ? "Chata acostada de costado."
            : "Chata acostada. Las botellas quedan de lado."
      : b.rot === 3
        ? "Sigue acostada, ahora de costado."
        : b.rot === 2
          ? "Acostada. Dos así, una sobre la otra, equivalen a dos paradas juntas."
          : b.rot === 1
            ? "Atravesada."
            : "Parada, de frente."
  );
}

function removeSelected() {
  const b = selected();
  if (!b) {
    hint("Primero elegí una caja.");
    return;
  }
  pushHistory();
  scene.remove(b.group);
  disposeObject(b.group);
  boxes = boxes.filter((o) => o.id !== b.id);
  selectedId = null;
  settle();
  for (const o of boxes) syncTransform(o);
  activePreset = "libre";
  clearPresetHighlight();
  refresh();
}

function restore(data) {
  clearBoxes();
  let maxId = 0;
  for (const item of data) {
    const b = {
      id: item.id,
      x: item.x,
      y: item.y,
      z: item.z,
      rot: item.rot,
      h: item.h,
      kind: item.kind,
      color: item.color,
      label: item.label || "",
    };
    if (isFlat(b.kind) || b.rot >= 2) b.h = poseOf(b.rot || 0, b.kind).h;
    else if (b.kind === "madera") b.h = BOX.h;
    maxId = Math.max(maxId, b.id);
    boxes.push(b);
    mount(b);
  }
  nextId = Math.max(nextId, maxId + 1);
  selectedId = null;
}

function undo() {
  if (!history.length) return;
  future.push(captureState());
  restore(history.pop());
  activePreset = "libre";
  clearPresetHighlight();
  updateUndoButtons();
  refresh();
}

function redo() {
  if (!future.length) return;
  history.push(captureState());
  restore(future.pop());
  updateUndoButtons();
  refresh();
}

function updateUndoButtons() {
  const noBack = history.length === 0;
  const noForward = future.length === 0;
  for (const id of ["undo", "undoView"]) if ($(id)) $(id).disabled = noBack;
  for (const id of ["redo", "redoView"]) if ($(id)) $(id).disabled = noForward;
}

function clearPresetHighlight() {
  for (const btn of document.querySelectorAll("#presets button")) btn.classList.remove("active");
}

function syncControlsUp() {
  controls._quat.setFromUnitVectors(camera.up, new THREE.Vector3(0, 1, 0));
  controls._quatInverse.copy(controls._quat).invert();
  controls._sphericalDelta.set(0, 0, 0);
  controls._panOffset.set(0, 0, 0);
}

function loadCenter() {
  const b = loadBounds();
  if (!b) {
    return {
      x: 0,
      y: pallet.h + 10,
      z: 0,
      size: Math.max(pallet.l, pallet.w),
    };
  }
  return {
    x: (b.minX + b.maxX) / 2 - pallet.l / 2,
    y: (pallet.h + b.maxY) / 2,
    z: (b.minZ + b.maxZ) / 2 - pallet.w / 2,
    size: Math.max(b.w, b.d, b.maxY - pallet.h, 50),
  };
}

function highlightView() {
  for (const btn of document.querySelectorAll("[data-view]")) {
    btn.classList.toggle("active", btn.dataset.view === viewName);
  }
}

function setView(name) {
  viewName = name;
  const c = loadCenter();
  const span = Math.max(c.size, pallet.l * 0.72, 90);
  camera.up.set(0, 1, 0);
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  camera.fov = 36;
  const ty = Math.max(c.y, 14);
  controls.target.set(c.x, ty, c.z);
  if (name === "frente") {
    const dist = span * 1.45;
    camera.position.set(c.x, ty + dist * 0.18, c.z - dist);
  } else if (name === "lateral") {
    const dist = Math.max(c.size, pallet.w) * 1.8 + 40;
    camera.position.set(c.x + dist, ty + dist * 0.28, c.z + dist * 0.08);
  } else if (name === "arriba") {
    controls.minPolarAngle = 0;
    controls.target.set(0, 0, 0);
    const dist = Math.max(pallet.l, pallet.w) * 1.7;
    camera.fov = 42;
    camera.position.set(0, dist, dist * 0.045);
  } else {
    const dist = span * 1.65;
    camera.position.set(c.x + dist * 0.7, ty + dist * 0.55, c.z - dist);
  }
  const pos = camera.position.clone();
  const target = controls.target.clone();
  camera.updateProjectionMatrix();
  syncControlsUp();
  controls.update();
  camera.position.copy(pos);
  controls.target.copy(target);
  camera.lookAt(target);
  highlightView();
}

function resize() {
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (viewName === "arriba") setView("arriba");
}

function typingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -pallet.h);
const hitPoint = new THREE.Vector3();

function setPointer(e) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function pickBox(e) {
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const roots = boxes.map((b) => b.group).filter(Boolean);
  const hits = raycaster.intersectObjects(roots, true);
  for (const hit of hits) {
    let obj = hit.object;
    while (obj && obj.userData.boxId == null) obj = obj.parent;
    if (obj) return boxes.find((b) => b.id === obj.userData.boxId) || null;
  }
  return null;
}

function palletPoint(e) {
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const ok = raycaster.ray.intersectPlane(floorPlane, hitPoint);
  if (!ok) return null;
  return {
    x: hitPoint.x + pallet.l / 2,
    z: hitPoint.z + pallet.w / 2,
  };
}

let dragMoved = false;
let downX = 0;
let downY = 0;

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const box = pickBox(e);
  if (!box) {
    selectedId = null;
    updateLooks();
    syncInspector();
    return;
  }
  e.stopImmediatePropagation();
  e.preventDefault();
  selectedId = box.id;
  const pt = palletPoint(e);
  if (pt) {
    dragOffsetX = pt.x - box.x;
    dragOffsetZ = pt.z - box.z;
    dragging = true;
    dragMoved = false;
    downX = e.clientX;
    downY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  }
  updateLooks();
  syncInspector();
}, true);

canvas.addEventListener("pointermove", (e) => {
  if (!dragging) {
    canvas.style.cursor = pickBox(e) ? "grab" : "default";
    return;
  }
  const b = selected();
  const pt = palletPoint(e);
  if (!b || !pt) return;
  if (!dragMoved) {
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    if (dx * dx + dy * dy < 16) return;
    dragMoved = true;
    pushHistory();
  }
  b.x = pt.x - dragOffsetX;
  b.z = pt.z - dragOffsetZ;
  if (!e.altKey) snapBox(b);
  clampBox(b);
  b.y = supportHeight(b);
  syncTransform(b);
  canvas.style.cursor = "grabbing";
});

function endDrag() {
  if (!dragging) return;
  dragging = false;
  canvas.style.cursor = "default";
  if (!dragMoved) return;
  settle();
  for (const b of boxes) syncTransform(b);
  activePreset = "libre";
  clearPresetHighlight();
  refresh();
}

canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("dblclick", (e) => {
  const box = pickBox(e);
  if (!box) return;
  e.preventDefault();
  e.stopPropagation();
  selectedId = box.id;
  rotateSelected();
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("keydown", (e) => {
  if (typingTarget(e.target)) return;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === "z") {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === "y") {
    e.preventDefault();
    redo();
    return;
  }
  if (key === "r") {
    e.preventDefault();
    rotateSelected();
    return;
  }
  if (key === "delete" || key === "backspace") {
    e.preventDefault();
    removeSelected();
    return;
  }
  if (key === "escape") {
    selectedId = null;
    updateLooks();
    syncInspector();
    return;
  }
  const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  if (arrows[key]) {
    const b = selected();
    if (!b) return;
    e.preventDefault();
    if (!e.repeat) pushHistory();
    const step = e.shiftKey ? 5 : 1;
    const [dx, dz] = arrows[key];
    b.x = round2(b.x + dx * step);
    b.z = round2(b.z + dz * step);
    clampBox(b);
    b.y = supportHeight(b);
    settle();
    for (const o of boxes) syncTransform(o);
    activePreset = "libre";
    clearPresetHighlight();
    refresh();
  }
});

controls.addEventListener("start", () => {
  if (!dragging && viewName !== "libre") {
    viewName = "libre";
    highlightView();
  }
});

function syncInspector() {
  const b = selected();
  const color = b ? b.color : paint.color;
  const kind = b ? b.kind : paint.kind;
  $("label").value = b ? b.label : paint.label;
  for (const btn of document.querySelectorAll(".swatch")) {
    btn.classList.toggle("on", btn.dataset.color === color);
  }
  $("kindComun").classList.toggle("active", kind === "comun");
  $("kindMadera").classList.toggle("active", kind === "madera");
  $("kindChata").classList.toggle("active", kind === "chata");
  $("kindCuatro").classList.toggle("active", kind === "cuatro");
}

function setColor(hex) {
  paint.color = hex;
  const b = selected();
  if (b && b.color !== hex) {
    pushHistory();
    b.color = hex;
    b.group.userData.body.color.set(hex);
    activePreset = "libre";
    clearPresetHighlight();
    persist();
  }
  syncInspector();
}

function setKind(kind) {
  paint.kind = kind;
  const b = selected();
  if (!b) {
    syncInspector();
    return;
  }
  if (b.kind === kind) {
    syncInspector();
    return;
  }
  pushHistory();
  const prev = { h: b.h, kind: b.kind };
  b.kind = kind;
  b.h = poseOf(b.rot, kind).h;
  if (boxes.some((o) => o.id !== b.id && overlap3D(b, o))) {
    b.h = prev.h;
    b.kind = prev.kind;
    history.pop();
    updateUndoButtons();
    hint("No entra: esa medida pisa otra caja.");
    syncInspector();
    return;
  }
  rebuild(b);
  settle();
  for (const o of boxes) syncTransform(o);
  refresh();
}

function setLabel(text) {
  paint.label = text;
  const b = selected();
  if (!b) return;
  b.label = text;
  const map = labelTexture(text);
  b.group.traverse((obj) => {
    if (obj.userData.isLabel) obj.material.map = map;
  });
  persist();
}

function buildSwatches() {
  const wrap = $("swatches");
  for (const color of COLORS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "swatch";
    btn.dataset.color = color.hex;
    btn.title = color.name;
    btn.style.background = color.hex;
    btn.addEventListener("click", () => setColor(color.hex));
    wrap.appendChild(btn);
  }
}

function buildPresetButtons() {
  const wrap = $("presets");
  let last = "";
  let group = null;
  for (const preset of PRESETS) {
    if (preset.group !== last) {
      last = preset.group;
      group = document.createElement("div");
      group.className = "group";
      const title = document.createElement("h2");
      title.textContent = preset.group;
      group.appendChild(title);
      wrap.appendChild(group);
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = preset.name;
    btn.dataset.preset = preset.id;
    btn.addEventListener("click", () => applyPreset(preset.id));
    group.appendChild(btn);
  }
}

function readPalletInputs() {
  const l = Number($("palletL").value);
  const w = Number($("palletW").value);
  if (!Number.isFinite(l) || !Number.isFinite(w)) return;
  pallet.l = Math.min(400, Math.max(80, l));
  pallet.w = Math.min(240, Math.max(40, w));
  $("palletL").value = String(pallet.l);
  $("palletW").value = String(pallet.w);
  buildPallet();
  for (const b of boxes) {
    clampBox(b);
    syncTransform(b);
  }
  settle();
  for (const b of boxes) syncTransform(b);
  setView(viewName === "libre" ? "tres" : viewName);
  refresh();
}

let loadedCapture = "";

function sceneSnapshot() {
  return {
    pallet: { l: pallet.l, w: pallet.w, h: pallet.h },
    boxes: captureState(),
    camera: {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      tx: controls.target.x,
      ty: controls.target.y,
      tz: controls.target.z,
      fov: camera.fov,
    },
  };
}

function applyCamera(cam) {
  if (!cam) return;
  camera.fov = cam.fov || 36;
  camera.position.set(cam.x, cam.y, cam.z);
  controls.target.set(cam.tx, cam.ty, cam.tz);
  camera.up.set(0, 1, 0);
  camera.updateProjectionMatrix();
  syncControlsUp();
  const pos = camera.position.clone();
  const target = controls.target.clone();
  controls.update();
  camera.position.copy(pos);
  controls.target.copy(target);
  camera.lookAt(target);
  viewName = "libre";
  highlightView();
}

function markLoadedCapture() {
  const label = loadedCapture ? "Actualizar captura" : "Sacar captura";
  if ($("shot")) $("shot").textContent = label;
  if ($("shot2")) $("shot2").textContent = loadedCapture ? "Actualizar" : "Sacar captura";
  const note = $("shotEditing");
  if (!note) return;
  note.replaceChildren();
  note.hidden = !loadedCapture;
  if (!loadedCapture) return;
  note.append("Estás editando esta captura. ");
  const release = document.createElement("button");
  release.type = "button";
  release.textContent = "Soltar";
  release.addEventListener("click", () => {
    loadedCapture = "";
    markLoadedCapture();
    loadShots();
    hint("La próxima va a ser una captura nueva.");
  });
  note.append(release);
}

function shotName() {
  const typed = ($("shotName")?.value || "").trim();
  if (typed) return typed;
  const preset = PRESETS.find((p) => p.id === activePreset);
  const base = preset ? preset.name : "estiba";
  return `${base} · ${viewName}`;
}

function downloadShot(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

function shotNote() {
  return ($("shotNote")?.value || "").trim();
}

async function shot() {
  renderer.render(scene, camera);
  const png = renderer.domElement.toDataURL("image/png");
  const name = shotName();
  const observacion = shotNote();
  try {
    const res = await fetch("/api/capturas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        png,
        observacion,
        escena: sceneSnapshot(),
        file: loadedCapture || "",
      }),
    });
    if (!res.ok) throw new Error("save");
    const saved = await res.json();
    if (!loadedCapture) {
      if ($("shotName")) $("shotName").value = "";
      if ($("shotNote")) $("shotNote").value = "";
    }
    hint(
      loadedCapture
        ? `Captura actualizada: ${saved.file}.`
        : observacion
          ? `Captura y observación guardadas: ${saved.file}. Quedan en capturas, para el procedimiento.`
          : `Captura guardada: ${saved.file}. La observación quedó vacía.`
    );
    loadShots();
  } catch {
    const file = `${name.replace(/[^\wáéíóúñü -]+/gi, "").trim() || "estiba"}.png`;
    downloadShot(png, file);
    hint("La captura se bajó a Descargas. Volvé a abrir la página desde el servidor para guardarla en la carpeta.");
  }
}

async function loadShots() {
  const wrap = $("shots");
  if (!wrap) return;
  try {
    const res = await fetch("/api/capturas");
    if (!res.ok) throw new Error("list");
    const items = await res.json();
    wrap.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "keys";
      empty.textContent = "Todavía no hay capturas.";
      wrap.appendChild(empty);
      return;
    }
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "shotitem";
      const img = document.createElement("img");
      img.src = item.url;
      img.alt = item.name;
      const text = document.createElement("div");
      text.className = "shottext";
      const name = document.createElement("strong");
      name.textContent = item.name;
      text.appendChild(name);
      if (item.observacion) {
        const note = document.createElement("p");
        note.textContent = item.observacion;
        text.appendChild(note);
      }
      const acts = document.createElement("div");
      acts.className = "shotacts";
      const load = document.createElement("button");
      load.type = "button";
      load.textContent = "Cargar";
      load.addEventListener("click", () => openCapture(item.file));
      const open = document.createElement("a");
      open.href = item.url;
      open.target = "_blank";
      open.rel = "noopener";
      open.textContent = "Abrir";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Borrar";
      remove.addEventListener("click", () => deleteCapture(item.file, item.name));
      acts.append(load, open, remove);
      if (item.file === loadedCapture) row.classList.add("on");
      row.append(img, text, acts);
      wrap.appendChild(row);
    }
  } catch {
    wrap.replaceChildren();
  }
}

async function deleteCapture(file, name) {
  const label = name || file;
  if (!confirm(`¿Borrar la captura “${label}”? Se elimina la imagen y la observación.`)) return;
  try {
    const res = await fetch(`/api/capturas?archivo=${encodeURIComponent(file)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("delete");
    if (loadedCapture === file) {
      loadedCapture = "";
      markLoadedCapture();
    }
    hint("Captura borrada.");
    loadShots();
  } catch {
    hint("No pude borrar esa captura.");
  }
}

async function openCapture(file) {
  try {
    const res = await fetch(`/api/capturas?archivo=${encodeURIComponent(file)}`);
    if (!res.ok) throw new Error("missing");
    const item = await res.json();
    if (!Array.isArray(item.escena?.boxes)) {
      hint("Esta captura es solo la imagen. El armado no quedó guardado, así que no se puede volver a cargar.");
      return;
    }
    pushHistory();
    const scene = item.escena;
    if (scene.pallet?.l && scene.pallet?.w) {
      pallet.l = scene.pallet.l;
      pallet.w = scene.pallet.w;
      if ($("palletL")) $("palletL").value = String(pallet.l);
      if ($("palletW")) $("palletW").value = String(pallet.w);
      buildPallet();
    }
    restore(scene.boxes);
    activePreset = "libre";
    clearPresetHighlight();
    applyCamera(scene.camera);
    if ($("shotName")) $("shotName").value = item.nombre || item.name || "";
    if ($("shotNote")) $("shotNote").value = item.observacion || "";
    loadedCapture = item.archivo || file;
    markLoadedCapture();
    refresh();
    loadShots();
    hint("Captura cargada. Modificá la estiba y tocá Actualizar captura.");
  } catch {
    hint("No pude cargar esa captura.");
  }
}

function exportJson() {
  const blob = new Blob(
    [JSON.stringify({ pallet, boxes: captureState() }, null, 2)],
    { type: "application/json" }
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "estiba.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.boxes)) throw new Error("formato");
      pushHistory();
      if (data.pallet?.l && data.pallet?.w) {
        pallet.l = data.pallet.l;
        pallet.w = data.pallet.w;
        $("palletL").value = String(pallet.l);
        $("palletW").value = String(pallet.w);
        buildPallet();
      }
      restore(data.boxes);
      activePreset = "libre";
      clearPresetHighlight();
      setView("tres");
      refresh();
    } catch {
      hint("Ese archivo no es una estiba.");
    }
  };
  reader.readAsText(file);
}

$("add").addEventListener("click", () => addBox(0));
$("addCross").addEventListener("click", () => addBox(1));
$("addLay").addEventListener("click", () => addBox(2));
$("stack").addEventListener("click", encimar);
$("downLevel").addEventListener("click", bajarPiso);
$("rotate").addEventListener("click", rotateSelected);
$("remove").addEventListener("click", removeSelected);
$("undo").addEventListener("click", undo);
$("redo").addEventListener("click", redo);
$("undoView").addEventListener("click", undo);
$("redoView").addEventListener("click", redo);
$("clear").addEventListener("click", () => {
  pushHistory();
  clearBoxes();
  placeLevel = 0;
  activePreset = "libre";
  markLibre();
  refresh();
});
$("label").addEventListener("focus", () => {
  if (selected()) pushHistory();
});
$("label").addEventListener("input", (e) => setLabel(e.target.value));
$("kindComun").addEventListener("click", () => setKind("comun"));
$("kindMadera").addEventListener("click", () => setKind("madera"));
$("kindChata").addEventListener("click", () => setKind("chata"));
$("kindCuatro").addEventListener("click", () => setKind("cuatro"));
$("nums").addEventListener("change", (e) => {
  showNumbers = e.target.checked;
  refresh();
});
$("center").addEventListener("change", (e) => {
  showCenter = e.target.checked;
  updateLooks();
  persist();
});
$("dims").addEventListener("change", (e) => {
  showDims = e.target.checked;
  updateLooks();
  persist();
});
$("ghost").addEventListener("click", () => {
  seeThrough = !seeThrough;
  $("ghost").classList.toggle("active", seeThrough);
  updateLooks();
  hint(seeThrough ? "Cajas transparentes, con el contorno marcado." : "Cajas opacas de nuevo.");
});
$("overhang").addEventListener("change", (e) => {
  allowOverhang = e.target.checked;
});
$("palletL").addEventListener("change", readPalletInputs);
$("palletW").addEventListener("change", readPalletInputs);
$("shot").addEventListener("click", shot);
$("shot2").addEventListener("click", shot);
$("foto").addEventListener("click", () => {
  document.body.classList.add("foto");
  setTimeout(resize, 30);
});
$("foto2").addEventListener("click", () => {
  document.body.classList.remove("foto");
  setTimeout(resize, 30);
});
$("export").addEventListener("click", exportJson);
$("import").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) importJson(file);
  e.target.value = "";
});
for (const btn of document.querySelectorAll("[data-view]")) {
  btn.addEventListener("click", () => setView(btn.dataset.view));
}

buildSwatches();
buildPresetButtons();
buildPallet();
new ResizeObserver(() => resize()).observe(canvas.parentElement);
resize();

let booted = false;
try {
  const raw = localStorage.getItem("estiba3d-v3");
  if (raw) {
    const data = JSON.parse(raw);
    if (data.palletL && data.palletW) {
      pallet.l = data.palletL;
      pallet.w = data.palletW;
      $("palletL").value = String(pallet.l);
      $("palletW").value = String(pallet.w);
      buildPallet();
    }
    if (Array.isArray(data.boxes) && data.boxes.length) {
      restore(data.boxes);
      nextId = data.nextId || nextId;
      activePreset = data.preset || "libre";
      const preset = PRESETS.find((p) => p.id === activePreset);
      if (preset) {
        $("detail").textContent = preset.detail;
        for (const btn of document.querySelectorAll("#presets button")) {
          btn.classList.toggle("active", btn.dataset.preset === activePreset);
        }
      }
      booted = true;
    }
  }
} catch {
  booted = false;
}
if (!booted) applyPreset("base28", { record: false });
else {
  setView("tres");
  refresh();
}
loadShots();

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();

hint("Doble clic: parada, atravesada, acostada y acostada de costado.");
