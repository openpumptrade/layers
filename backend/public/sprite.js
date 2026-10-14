// ROOT pixel sprites + icons — shared by the page, the scene and the brand renderer.
const PAL = {
  o: "#2a2823", g: "#63c15a", G: "#3f8f3a", d: "#2f7a3a", b: "#fff0b8", B: "#e8cf83", w: "#ffffff", k: "#1a1410",
  r: "#e5473f", R: "#b8322b", y: "#f7c948", Y: "#d9a521", f: "#ff8a3d", F: "#ffd23d", p: "#b58cf0", P: "#8a5fd1",
  s: "#62a8ea", S: "#3b7fc4", m: "#9a6b3c", M: "#5e3f22", x: "#9a93a8", c: "#fff6d6", l: "#a8e07a", L: "#7ccf6a", ".": null,
};
// small sprites (art strings, same letters as PAL)
const SEED = ["...oooo...", "..oMMMMo..", ".oMmMmMMo.", ".oooooooo.", ".ommmmmmo.", ".ommmmmmo.", "..ommmmo..", "...ommo...", "....oo...."];
const SPROUT = ["....oo....", "...oggo.oo", "...ogGoggo", "....ogogo.", "....oggo..", ".....ogo..", ".....ogo..", "....ommo.."];
const BIRD = [[".o......o.", "oko....oko", ".okkookko.", "..okkkko..", "...okko..."], ["..........", "..oo..oo..", ".okkookko.", "..okkkko..", "...okko..."]];
const SUN = ["...oooo...", "..oFFFFo..", ".oFFyyFFo.", "oFFyyyyFFo", "oFyyyyyyFo", "oFyyyyyyFo", "oFFyyyyFFo", ".oFFyyFFo.", "..oFFFFo..", "...oooo..."];
const MOON = ["...oooo...", "..occcco..", ".occccoo..", "occcco....", "occcco....", "occcco....", "occcco....", ".occccoo..", "..occcco..", "...oooo..."];
const CLOUD = ["....oooo......", "...occccoo....", ".oocccccccoo..", "occcccccccccoo", "ocBccccccccBco", ".oooooooooooo."];
const SAP = ["..o..", ".oyo.", "oyFyo", "oyyyo", ".oYo.", "..o.."];
const LEAF1 = ["..oo", ".ogo", "ogo.", "oo.."];
const LEAF2 = ["oo..", ".ogo", "..og", "...o"];
const FIREFLY = [".o.", "oFo", ".o."];
const COIN = [".ooooooo.", "oYYYYYYYo", "oyyyyyyyo", ".ooooooo."];
const SOLCOIN = { Y: "#3b7fc4", y: "#62a8ea" };
const AXE = ["......oo..", ".....oxxo.", "....oxxxxo", "...oxxxxo.", "..omoxxo..", ".omoooo...", "omo.......", "oo........"];

// 12 x 12 icons
const ICONS = {
  coin: ["....oooo....", "..ooyyyyoo..", ".oyyyyyyyyo.", ".oyyyooyyyo.", "oyyyoyyyyyyo", "oyyyyooyyyyo", "oyyyyyyoyyyo", "oyyyoooyyyyo", ".oyyyyyyYYo.", ".oYyyyyyYYo.", "..ooYYYYoo..", "....oooo...."],
  tree: ["....oooo....", "...oggggo...", "..ogggGggo..", ".ogggggGggo.", ".oggGgggggo.", "..ogggggGo..", "...oggggo...", "....ommo....", "....ommo....", "....ommo....", "...oMMMMo...", "............"],
  leaf: ["............", ".........oo.", ".......oogo.", ".....ooggGo.", "....ogggGgo.", "...oggGgggo.", "..oggGggggo.", "..ogGggggo..", "..oGgggoo...", "..oggoo.....", "..oo........", "............"],
  seed: ["............", "....oooo....", "...oMMMMo...", "..oMmMmMMo..", "..oooooooo..", "..ommmmmmo..", "..ommmmmmo..", "..ommmmmmo..", "...ommmmo...", "....ommo....", ".....oo.....", "............"],
  sprout: ["............", ".....oo.....", "....oggo.oo.", "....ogGooggo", ".....ogoggo.", ".....ogggo..", "......ogo...", "......ogo...", "....oooooo..", "...oMmmmmMo.", "....oMMMMo..", "............"],
  branch: ["............", "............", "..........o.", ".........ogo", ".......oogo.", "oo....ommo..", "ommoooommo..", ".ommmmmmo...", "..oommmo....", "....ommo....", ".....oo.....", "............"],
  drop: ["............", ".....o......", "....oyo.....", "....oyo.....", "...oyyyo....", "...oyFyo....", "..oyyFyyo...", "..oyyyyyo...", "..oYyyyYo...", "...oYYYo....", "....ooo.....", "............"],
  root: ["....ommo....", "....ommo....", "....ommo....", "...ommmmo...", "..ommoommo..", ".ommo..ommo.", ".omo....omo.", "omo.oo...omo", "oo.ommo...oo", "...oo.o.....", "............", "............"],
  bird: ["............", "............", "........oo..", ".......okko.", "......okkko.", "..oo.okkkoo.", ".okkookkko..", "..okkkkkko..", "...okkkko...", "....okko....", ".....oo.....", "............"],
  up: ["............", ".....oo.....", "....oggo....", "...oggggo...", "..oggggggo..", ".oggooooggo.", ".ooo.oo.ooo.", ".....oo.....", ".....oo.....", ".....oo.....", ".....oo.....", "............"],
  down: ["............", ".....oo.....", ".....oo.....", ".....oo.....", ".....oo.....", ".ooo.oo.ooo.", ".orrooooorro", "..orrrrrro..", "...orrrro...", "....orro....", ".....oo.....", "............"],
  fire: [".....o......", "....ofo.....", "....ofo.....", "...offfo....", "...ofFfo....", "..ofFFFfo...", "..ofFFFfo...", ".ofFFFFFfo..", ".ofFFwFFfo..", ".ofFFFFFfo..", "..offffffo..", "...oooooo..."],
  book: ["............", "..oooooooo..", ".osssssssso.", ".osSssssSso.", ".osssssssso.", ".osSssssSso.", ".osssssssso.", ".osSssssSso.", ".osssssssso.", ".obbbbbbbbo.", "..oooooooo..", "............"],
  wallet: ["............", "............", ".oooooooooo.", ".ommmmmmmmo.", ".ommmmmmmmo.", ".oooooooooo.", ".ommmmmmoyo.", ".ommmmmmoyo.", ".oooooooooo.", "............", "............", "............"],
  chart: ["............", "............", ".........oo.", ".........oyo", ".....oo..oyo", ".....ogo.oyo", ".oo..ogo.oyo", ".oso.ogo.oyo", ".oso.ogo.oyo", ".oso.ogo.oyo", ".oooooooooo.", "............"],
  clock: ["....oooo....", "..oobbbboo..", ".obbbbobbbo.", ".obbbbobbbo.", "obbbbbobbbbo", "obbbbbobbbbo", "obbbbboooobo", "obbbbbbbbbbo", ".obbbbbbbbo.", ".obbbbbbbbo.", "..oobbbboo..", "....oooo...."],
  skull: ["............", "...oooooo...", "..obbbbbbo..", ".obbbbbbbbo.", ".obbbbbbbbo.", ".obkkbbbkkbo", ".obkkbbbkkbo", ".obbbbobbbbo", "..obbbbbbbo.", "..obobobobo.", "...oooooo...", "............"],
  check: ["............", "..........o.", ".........oo.", "........ogo.", ".......ogo..", ".o....ogo...", ".oo..ogo....", ".ogo.ogo....", "..ogogo.....", "...ogo......", "....o.......", "............"],
  hourglass: ["............", ".oooooooooo.", "..oyyyyyyo..", "..oyyyyyyo..", "...oyyyyo...", "....oyyo....", "....oooo....", "....obbo....", "...obbyyo...", "..obbyyyyo..", "..oyyyyyyo..", ".oooooooooo."],
  x: ["............", ".oo......oo.", ".ooo....ooo.", "..ooo..ooo..", "...oooooo...", "....oooo....", "....oooo....", "...oooooo...", "..ooo..ooo..", ".ooo....ooo.", ".oo......oo.", "............"],
  plane: ["............", "..........o.", "........oso.", "......osssso", "....osssssso", "..osssssssso", "ossssssssso.", "..osssssso..", "....ossso...", ".....oso....", "......o.....", "............"],
  search: ["............", "..ooooo.....", ".obbbbbo....", "obbbbbbbo...", "obbwbbbbo...", "obbbbbbbo...", "obbbbbbbo...", ".obbbbbo.o..", "..ooooo.ooo.", ".......oooo.", "........ooo.", "............"],
  bolt: ["............", "......oo....", ".....oyo....", "....oyyo....", "...oyyyo....", "..oyyyyooo..", ".oyyyyyyyo..", ".oooooyyo...", "....oyyo....", "....oyo.....", "....oo......", "............"],
  bag: ["............", "....oooo....", "...ommmmo...", "...ommmmo...", "..oooooooo..", ".ommmmmmmmo.", ".ommmyymmmo.", ".ommmyymmmo.", ".ommmmmmmmo.", ".ommmmmmmmo.", "..oooooooo..", "............"],
  scroll: ["............", "..oooooooo..", ".obbbbbbbbo.", ".obbbbbbbbo.", ".oboooobbbo.", ".obbbbbbbbo.", ".obooooobbo.", ".obbbbbbbbo.", ".obooobbbbo.", ".obbbbbbbbo.", "..oooooooo..", "............"],
  star: ["............", ".....oo.....", "....oyyo....", "....oyyo....", ".ooooyyoooo.", ".oyyyyyyyyo.", "..oyyyyyyo..", "...oyyyyo...", "...oyyyyo...", "..oyyooyyo..", "..oo....oo..", "............"],
  flask: ["............", "....oooo....", "....obbo....", "....obbo....", "....obbo....", "...obbbbo...", "..obbppbbo..", ".obbppppbbo.", ".obppppppbo.", ".oppppppppo.", "..oooooooo..", "............"],
  lock: ["............", "....oooo....", "...ommmmo...", "...om..mo...", "...om..mo...", ".oooooooooo.", ".oyyyyyyyyo.", ".oyyyooyyyo.", ".oyyyooyyyo.", ".oyyyyoyyyo.", ".oooooooooo.", "............"],
  gem: ["............", "............", "...oooooo...", "..opppppPo..", ".oppwppppPo.", ".oppppppPPo.", "..opppppPo..", "...oppPPo...", "....opPo....", ".....oo.....", "............", "............"],
  copy: ["............", "..oooooo....", "..obbbbo....", "..obooboooo.", "..obbbbobbo.", "..oboobobbo.", "..obbbbobbo.", "..oooooobbo.", "....obbbbbo.", "....obbbbbo.", "....ooooooo.", "............"],
  gif: ["............", ".oooooooooo.", ".oppppppppo.", ".opcpcpcppo.", ".oppcpcpcpo.", ".opcpcpcppo.", ".oppppppppo.", ".oooooooooo.", "..o.o..o.o..", "..o.o..o.o..", "............", "............"],
  link: ["............", "............", "...oooo.....", "..osssso.oo.", ".ossoosso.so", ".oso..osso..", ".oso...oso..", ".ossoossso..", "..osssosso..", "...oooooo...", "............", "............"],
  axe: ["............", "......oo....", ".....oxxo...", "....oxxxxo..", "...oxxxxo...", "..omoxxo....", ".omoooo.....", "omo.........", "oo..........", "............", "............", "............"],
  crown: ["............", ".o...oo...o.", ".oo.oyyo.oo.", ".oyooyyooyo.", ".oyyyyyyyyo.", ".oyyyyyyyyo.", ".oyYyYyYyYo.", ".oyyyyyyyyo.", ".oYYYYYYYYo.", ".oooooooooo.", "............", "............"],
  chest: ["............", "..oooooooo..", ".oMmmmmmmmo.", ".ommmmmmmmo.", ".oooooooooo.", ".ommmmyymmo.", ".ommmmyymmo.", ".oMmmmoommMo", ".oMmmmmmmmMo", ".oMMMMMMMMMo", "..oooooooo..", "............"],
};

// leaf skins per tree level (1..8): the canopy changes with the rings
const LEVEL_SKINS = [
  { name: "seed", g: "#a8e07a", G: "#7ccf6a", d: "#4f9e40" },
  { name: "sprout", g: "#a8e07a", G: "#7ccf6a", d: "#4f9e40" },
  { name: "sapling", g: "#7ccf6a", G: "#4f9e40", d: "#2f7a3a" },
  { name: "young tree", g: "#63c15a", G: "#3f8f3a", d: "#2f7a3a" },
  { name: "tree", g: "#4fb04f", G: "#2f8a3a", d: "#1f6a2e" },
  { name: "oak", g: "#63c15a", G: "#3f8f3a", d: "#2f7a3a", y: "#f7c948" },
  { name: "elder", g: "#f7c948", G: "#e59a2b", d: "#b8632b" },
  { name: "world tree", g: "#d7c8ff", G: "#b58cf0", d: "#8a5fd1" },
];
const skinFor = (level) => LEVEL_SKINS[Math.max(1, Math.min(LEVEL_SKINS.length, level)) - 1];
const LEVEL_NAMES = LEVEL_SKINS.map((s) => s.name);

function drawPix(ctx, art, x, y, s, override) {
  for (let r = 0; r < art.length; r++) for (let c = 0; c < art[r].length; c++) {
    const ch = art[r][c]; let col = PAL[ch];
    if (ch === "." || !col) continue;
    if (override && override[ch]) col = override[ch];
    ctx.fillStyle = col; ctx.fillRect(Math.round(x + c * s), Math.round(y + r * s), Math.ceil(s), Math.ceil(s));
  }
}
/// a chunky leaf blob: a deterministic pixel disc with darker rim + lighter highlights (pixel size `s`)
function drawBlob(ctx, cx, cy, radius, s, skin, seed = 1) {
  const sk = Object.assign({}, PAL, skin || {});
  const R = Math.max(1, Math.round(radius / s));
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const d2 = dx * dx + dy * dy; if (d2 > R * R) continue;
    const h = (Math.imul(dx * 73856093 ^ dy * 19349663 ^ seed * 83492791, 1) >>> 0) % 7;
    if (d2 > R * R * 0.85 && h < 2) continue; // ragged edge
    const col = d2 > R * R * 0.62 ? sk.d : d2 < R * R * 0.2 && h < 3 ? (sk.g === PAL.g ? "#8fe07a" : sk.g) : h === 0 ? sk.G : sk.g;
    ctx.fillStyle = col; ctx.fillRect(Math.round(cx + dx * s), Math.round(cy + dy * s), s, s);
  }
  ctx.fillStyle = "#2a2823";
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const d2 = dx * dx + dy * dy; if (d2 <= R * R && d2 > (R - 0.9) * (R - 0.9) && ((dx + dy + seed) % 3 === 0)) ctx.fillRect(Math.round(cx + dx * s), Math.round(cy + dy * s), s, s); }
}
/// a pixel limb of width `w` (bark): a run of chunky brown squares with a dark outline, thinner toward the tip
function drawLimb(ctx, x0, y0, x1, y1, w, s, col = PAL.m, edge = PAL.o) {
  const dx = x1 - x0, dy = y1 - y0, n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / s));
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push({ x: Math.round((x0 + dx * t) / s) * s, y: Math.round((y0 + dy * t) / s) * s, ww: Math.max(s * 2, Math.round((w * (1 - t * 0.4)) / s) * s) }); }
  ctx.fillStyle = edge; for (const p of pts) ctx.fillRect(p.x - p.ww / 2 - s, p.y - p.ww / 2 - s, p.ww + 2 * s, p.ww + 2 * s);
  ctx.fillStyle = col; for (const p of pts) ctx.fillRect(p.x - p.ww / 2, p.y - p.ww / 2, p.ww, p.ww);
  ctx.fillStyle = PAL.M; for (let i = 0; i < pts.length; i += 4) { const p = pts[i]; ctx.fillRect(p.x - p.ww / 2, p.y + p.ww / 2 - s, Math.max(s, p.ww / 2), s); }
}
/// inline SVG of a 12 x 12 icon (runs merged per row)
function iconSvg(name, px = 14, override) {
  const art = ICONS[name]; if (!art) return "";
  const h = art.length, w = art[0].length; let out = "";
  for (let r = 0; r < h; r++) {
    let c = 0;
    while (c < w) {
      const ch = art[r][c]; let col = PAL[ch]; if (override && override[ch]) col = override[ch];
      if (ch === "." || !col) { c++; continue; }
      let e = c; while (e < w && art[r][e] === ch) e++;
      out += `<rect x="${c}" y="${r}" width="${e - c}" height="1" fill="${col}"/>`; c = e;
    }
  }
  return `<svg class="ico" viewBox="0 0 ${w} ${h}" width="${px}" height="${px}" shape-rendering="crispEdges" aria-hidden="true">${out}</svg>`;
}
/// a coin's colour from its mint (fruit colour when there is no logo)
function hueOf(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h % 360; }
function fruitColors(mint) { const h = hueOf(mint || "x"); return { light: `hsl(${h} 75% 62%)`, dark: `hsl(${h} 65% 42%)` }; }
if (typeof window !== "undefined") Object.assign(window, { PAL, SEED, SPROUT, BIRD, SUN, MOON, CLOUD, SAP, LEAF1, LEAF2, FIREFLY, COIN, SOLCOIN, AXE, ICONS, LEVEL_SKINS, LEVEL_NAMES, skinFor, drawPix, drawBlob, drawLimb, iconSvg, hueOf, fruitColors });
