// The grove: an animated pixel scene of the tree — $ROOT is the trunk, every grown coin a branch (depth 1),
// a twig on a branch (depth 2) or a sprig further up, each ending in leaves and its logo as the fruit.
// Needs sprite.js. Usage: const sc = new RootScene(canvas); sc.set({ coins: [...] }); setInterval(() => sc.tick(), 50);
class RootScene {
  constructor(canvas) {
    this.c = canvas; this.ctx = canvas.getContext("2d"); this.frame = 0;
    this.state = { started: false, level: 1, coins: [], status: "idle", paused: false, rootSym: "ROOT", burnedUsd: 0, hot: {} };
    this.nodes = []; this.sig = ""; this.imgs = {};
    this.birds = []; this.clouds = []; this.drops = []; this.glints = []; this.leaves = []; this.flies = []; this.sinks = []; this.sprouts = []; this.zz = [];
    this.birdAt = 120; this.leafAt = 90; this.glow = 0; this.rootGlow = 0; this.wobble = 0; this.wobbleAt = 120;
    this.stars = Array.from({ length: 26 }, (_, i) => ({ x: 10 + ((i * 173) % (canvas.width - 20)), y: 8 + ((i * 97) % 120), t: (i * 37) % 90 }));
    for (let i = 0; i < 3; i++) this.clouds.push({ x: (i * 230) % canvas.width, y: 18 + i * 22, v: 0.12 + i * 0.05, s: 2 + (i % 2) });
    this.rand = Math.random;
  }
  set(patch) { Object.assign(this.state, patch); if (patch.coins) this.layout(); }
  // ---------------------------------------------------------------- events
  grow(mint) { const n = this.nodes.find((k) => k.mint === mint); const p = n ? { x: n.x, y: n.y } : { x: this.c.width / 2, y: this.base - 30 }; this.sprouts.push({ x: p.x, y: p.y, life: 70 }); for (let i = 0; i < 10; i++) this.glints.push({ x: p.x + (this.rand() - 0.5) * 40, y: p.y + (this.rand() - 0.5) * 30, life: 8 + Math.floor(this.rand() * 10) }); }
  sap(mint, n = 5) { // sap drops run from the coin down its limb to the trunk and into the roots
    const node = this.nodes.find((k) => k.mint === mint); if (!node) return this.drink();
    const path = this.pathToRoot(node);
    for (let i = 0; i < n; i++) this.drops.push({ path, seg: 0, t: 0, speed: 0.03 + this.rand() * 0.02, delay: i * 9, life: 400 });
    this.glow = Math.max(this.glow, 40);
  }
  drink(n = 10) { // the trunk drinks: SOL coins sink into the soil, the roots glow
    const W = this.c.width;
    for (let i = 0; i < n; i++) this.sinks.push({ x: W / 2 + (this.rand() - 0.5) * 70, y: -10 - this.rand() * 40, vy: 1.6 + this.rand() * 1.2, life: 200, delay: i * 6 });
    this.rootGlow = Math.max(this.rootGlow, 60);
  }
  // ---------------------------------------------------------------- layout
  get base() { return this.c.height - 70; }
  trunkHeight(level) { return [26, 44, 78, 108, 136, 156, 172, 186][Math.max(1, Math.min(8, level)) - 1]; }
  trunkWidth(level) { return [0, 4, 6, 10, 14, 18, 22, 26][Math.max(1, Math.min(8, level)) - 1]; }
  layout() {
    const S = this.state, W = this.c.width, cx = W / 2, base = this.base;
    const level = Math.max(S.coins.length ? 3 : 1, S.level); // a tree with coins on it is at least a sapling
    const th = this.trunkHeight(level), tw = this.trunkWidth(level), top = base - th;
    const coins = S.coins.filter((c) => !c.isRoot);
    const sig = level + "|" + coins.map((c) => c.mint + ":" + c.parent).join(",");
    if (sig === this.sig) return; this.sig = sig;
    const nodes = [], byMint = {};
    const d1 = coins.filter((c) => c.depth === 1).slice(0, 18);
    d1.forEach((c, i) => {
      const side = i % 2 ? 1 : -1, k = (i + 1) / (d1.length + 1);
      const y0 = base - 22 - (1 - k) * (th - 30), len = 56 + ((i * 37) % 46) + Math.min(40, th / 6);
      const x0 = cx + side * (tw / 2), x1 = cx + side * (tw / 2 + len), y1 = y0 - len * (0.32 + ((i * 13) % 5) / 25);
      const n = { mint: c.mint, coin: c, depth: 1, x: x1, y: y1, px: x0, py: y0, w: Math.max(4, tw / 2.2), r: 14 + Math.min(6, c.children || 0), side, parentNode: null };
      nodes.push(n); byMint[c.mint] = n;
    });
    const d2 = coins.filter((c) => c.depth === 2);
    const perBranch = {};
    d2.forEach((c) => { (perBranch[c.parent] = perBranch[c.parent] || []).push(c); });
    for (const [pm, list] of Object.entries(perBranch)) {
      const p = byMint[pm]; if (!p) continue;
      list.slice(0, 6).forEach((c, j) => {
        const t = 0.35 + (j + 1) / (list.length + 2) * 0.55, ax = p.px + (p.x - p.px) * t, ay = p.py + (p.y - p.py) * t;
        const len = 20 + ((j * 17) % 14), side = (j % 2 ? -1 : 1);
        const n = { mint: c.mint, coin: c, depth: 2, x: ax + p.side * len * 0.5 + side * 6, y: ay - len, px: ax, py: ay, w: 4, r: 10, side: p.side, parentNode: p };
        nodes.push(n); byMint[c.mint] = n;
      });
    }
    const d3 = coins.filter((c) => c.depth >= 3);
    d3.forEach((c, j) => {
      const p = byMint[c.parent]; if (!p) return;
      const len = 12 + (j % 3) * 4, side = (j % 2 ? -1 : 1);
      const n = { mint: c.mint, coin: c, depth: c.depth, x: p.x + side * len, y: p.y - len, px: p.x, py: p.y, w: 2, r: 7, side: p.side, parentNode: p };
      nodes.push(n); byMint[c.mint] = n;
    });
    this.nodes = nodes; this.byMint = byMint; this.tree = { level, th, tw, top, cx, extra: coins.length - nodes.length };
    for (const n of nodes) this.loadImg(n.coin.image);
  }
  pathToRoot(node) { const pts = []; let n = node; while (n) { pts.push({ x: n.x, y: n.y }, { x: n.px, y: n.py }); n = n.parentNode; } pts.push({ x: this.tree.cx, y: this.base + 20 }); return pts; }
  loadImg(url) { if (!url || this.imgs[url] !== undefined) return; this.imgs[url] = null; const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => { this.imgs[url] = im; }; im.onerror = () => { this.imgs[url] = false; }; im.src = url; }
  // ---------------------------------------------------------------- draw
  sky() {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    const night = h < 5.5 || h >= 20.5, dusk = (h >= 18.5 && h < 20.5) || (h >= 5.5 && h < 7.5);
    return night ? { a: "#0d0719", b: "#1d1231", night: true, sun: false } : dusk ? { a: "#2a1b4a", b: "#8a4a5a", night: false, sun: true, dusk: true } : { a: "#3b7fc4", b: "#8fd0ff", night: false, sun: true };
  }
  tick() {
    const ctx = this.ctx, W = this.c.width, H = this.c.height, S = this.state, f = this.frame, base = this.base;
    ctx.imageSmoothingEnabled = false;
    if (!this.tree) this.layout();
    const T = this.tree, skin = skinFor(T.level);
    // sky
    const sky = this.sky();
    ctx.fillStyle = sky.a; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = sky.b; ctx.fillRect(0, Math.floor(base * 0.45), W, base - Math.floor(base * 0.45));
    for (let y = Math.floor(base * 0.3); y < base * 0.45; y += 4) for (let x = ((y / 4) % 2) * 4; x < W; x += 8) if (((x * 7 + y * 13) % 11) < (y - base * 0.3) / (base * 0.15) * 11) ctx.fillRect(x, y, 4, 4);
    if (sky.night) for (const g of this.stars) { const ph = (f + g.t) % 90; ctx.fillStyle = ph < 6 ? "#ffffff" : ph < 12 ? "#d9c8ff" : "#6d5aa0"; ctx.fillRect(g.x, g.y, 2, 2); if (ph < 6) { ctx.fillRect(g.x - 2, g.y, 6, 2); ctx.fillRect(g.x, g.y - 2, 2, 6); } }
    drawPix(ctx, sky.night ? MOON : SUN, W - 70, 16, 3, sky.dusk ? { F: "#ff8a3d", y: "#ffb060" } : null);
    for (const c of this.clouds) { c.x += c.v; if (c.x > W + 40) c.x = -60; drawPix(ctx, CLOUD, c.x, c.y, c.s, sky.night ? { c: "#4d3a7a", B: "#3a2a5c", o: "#2a1b4a" } : sky.dusk ? { c: "#ffd2b0", B: "#f0a080" } : null); }
    // far hills
    ctx.fillStyle = sky.night ? "#17102a" : sky.dusk ? "#3d2a52" : "#4f9e40";
    for (let i = 0; i < 8; i++) { const x = i * 100 - 10, r = 60 + ((i * 29) % 34), hh = 14 + ((i * 17) % 12); for (let k = 0; k <= hh; k += 3) { const w = r * Math.sqrt(Math.max(0, 1 - (k / hh) * (k / hh))); ctx.fillRect(Math.round(x - w), base - 4 - k, Math.round(w * 2), 3); } }
    // ground + soil
    ctx.fillStyle = "#3f8f3a"; ctx.fillRect(0, base - 4, W, 10);
    ctx.fillStyle = "#63c15a"; for (let x = 0; x < W; x += 12) ctx.fillRect(x + ((x / 12) % 2 ? 6 : 0), base - 6, 4, 2);
    ctx.fillStyle = "#3a2615"; ctx.fillRect(0, base + 6, W, H - base - 6);
    ctx.fillStyle = "#2a1b0e"; for (let i = 0; i < 40; i++) ctx.fillRect((i * 97 + 13) % W, base + 10 + ((i * 53) % (H - base - 14)), 4, 2);
    // roots + SOL in the soil (the trunk is paired with SOL: SOL is what the roots drink)
    const rg = this.rootGlow > 0 ? 1 : 0; if (this.rootGlow > 0) this.rootGlow--;
    ctx.fillStyle = rg && f % 6 < 3 ? "#f7c948" : "#5e3f22";
    if (T.level >= 2) for (const [dx, len] of [[-1, 48], [1, 54], [-1, 24], [1, 28], [0, 30]]) { for (let k = 0; k < len; k += 3) { const x = T.cx + dx * (k * 0.9 + (dx === 0 ? 0 : T.tw / 2)) + (dx === 0 ? 0 : (k % 9 < 3 ? dx * 2 : 0)); ctx.fillRect(x - 2, base + 6 + k * 0.5 + (dx === 0 ? k : 0) * 0.3, 4, 3); } }
    for (let i = 0; i < 6; i++) drawPix(ctx, COIN, 30 + i * 110 + ((i * 31) % 40), base + 20 + ((i * 17) % 28), 1.6, SOLCOIN);
    ctx.font = "9px Silkscreen, monospace"; ctx.textAlign = "left"; ctx.fillStyle = "#8a6a4a"; ctx.fillText("SOL", 8, H - 6);
    // the trunk / seed / sprout
    if (!S.started || T.level === 1) {
      if (f >= this.wobbleAt) { this.wobble = 20; this.wobbleAt = f + 120 + Math.floor(this.rand() * 160); }
      const wob = this.wobble > 0 ? (Math.floor(f / 4) % 2 ? 1 : -1) : 0; if (this.wobble > 0) this.wobble--;
      drawPix(ctx, SEED, T.cx - 15 + wob, base + 4, 3);
      if (S.started) drawPix(ctx, SPROUT, T.cx - 15, base - 24, 3);
      if (this.wobble > 0 && f % 6 === 0) this.glints.push({ x: T.cx + (this.rand() - 0.5) * 50, y: base + 10 + this.rand() * 20, life: 5 });
    } else if (T.level === 2) {
      drawPix(ctx, SPROUT, T.cx - 20, base - 36, 4.5, skin);
    } else {
      // trunk: bark bands, wider at the base, glowing when sap runs
      const tw = T.tw, top = T.top;
      ctx.fillStyle = "#2a2823"; ctx.fillRect(T.cx - tw / 2 - 2, top - 2, tw + 4, base - top + 8);
      ctx.fillStyle = this.glow > 0 && f % 8 < 4 ? "#b8632b" : "#9a6b3c"; ctx.fillRect(T.cx - tw / 2, top, tw, base - top + 6);
      ctx.fillStyle = "#5e3f22"; for (let y = top + 4; y < base; y += 8) ctx.fillRect(T.cx - tw / 2 + ((y / 8) % 3) * 2 + 2, y, Math.max(2, tw / 3), 4);
      ctx.fillStyle = "#c48a4f"; for (let y = top + 8; y < base; y += 12) ctx.fillRect(T.cx - tw / 2 + 1, y, 2, 6);
      // flare at the base
      ctx.fillStyle = "#9a6b3c"; ctx.fillRect(T.cx - tw / 2 - 6, base - 2, tw + 12, 8); ctx.fillStyle = "#2a2823"; ctx.fillRect(T.cx - tw / 2 - 8, base + 4, tw + 16, 2);
      // crown of the trunk: a leaf blob when few branches
      drawBlob(ctx, T.cx, top - 6, 16 + T.level * 2, 2, skin, 7);
      if (this.glow > 0) this.glow--;
    }
    // limbs (parents first so twigs sit on branches)
    for (const n of this.nodes) drawLimb(ctx, n.px, n.py, n.x, n.y, n.depth === 1 ? n.w + 2 : n.depth === 2 ? 4 : 2, 2, n.depth === 1 ? "#9a6b3c" : "#7a5230", "#2a2823");
    // leaves + fruit (the logo)
    for (const n of this.nodes) {
      const hot = S.hot && S.hot[n.mint] ? 1 : 0;
      drawBlob(ctx, n.x, n.y - 4, n.r + (hot ? ((f % 12 < 6) ? 1 : 0) : 0), 2, skin, hueOf(n.mint) % 97);
      const im = this.imgs[n.coin.image], fs = n.depth === 1 ? 14 : n.depth === 2 ? 11 : 8, fx = Math.round(n.x - fs / 2), fy = Math.round(n.y - 2);
      ctx.fillStyle = "#2a2823"; ctx.fillRect(fx - 2, fy - 2, fs + 4, fs + 4);
      if (im) ctx.drawImage(im, fx, fy, fs, fs);
      else { const col = fruitColors(n.mint); ctx.fillStyle = col.light; ctx.fillRect(fx, fy, fs, fs); ctx.fillStyle = col.dark; ctx.fillRect(fx + fs / 2, fy + fs / 2, fs / 2, fs / 2); ctx.fillStyle = "#ffffff"; ctx.fillRect(fx + 2, fy + 2, 2, 2); }
      if (hot && f % 14 === 0) this.glints.push({ x: n.x + (this.rand() - 0.5) * 24, y: n.y + (this.rand() - 0.5) * 16, life: 6 });
      if (this.rand() < 0.004) this.leaves.push({ x: n.x + (this.rand() - 0.5) * 20, y: n.y, vy: 0.5 + this.rand() * 0.4, t: this.rand() * 100, life: 220 });
    }
    if (T.extra > 0) { ctx.font = "9px Silkscreen, monospace"; ctx.fillStyle = "#fff6d6"; ctx.textAlign = "center"; ctx.fillText(`+${T.extra} MORE`, T.cx, T.top - 30 - T.level * 2); }
    // sprouts (a new coin growing)
    for (const s of this.sprouts) { drawPix(ctx, SPROUT, s.x - 10, s.y - 20 - (70 - s.life) * 0.1, 2, { g: "#a8e07a" }); s.life--; }
    this.sprouts = this.sprouts.filter((s) => s.life > 0);
    // sap drops running down
    for (const d of this.drops) {
      if (d.delay > 0) { d.delay--; continue; }
      const a = d.path[d.seg], b = d.path[d.seg + 1]; if (!b) { d.life = 0; this.rootGlow = Math.max(this.rootGlow, 30); continue; }
      d.t += d.speed; if (d.t >= 1) { d.t = 0; d.seg++; }
      const x = a.x + (b.x - a.x) * Math.min(1, d.t), y = a.y + (b.y - a.y) * Math.min(1, d.t);
      drawPix(ctx, SAP, x - 5, y - 6, 2, f % 6 < 3 ? { F: "#ffffff" } : null); d.life--;
    }
    this.drops = this.drops.filter((d) => d.life > 0);
    // SOL coins sinking into the soil (the trunk drinks)
    for (const s of this.sinks) { if (s.delay > 0) { s.delay--; continue; } s.y += s.vy; if (s.y > base + 30) { s.life = 0; this.glints.push({ x: s.x, y: base + 24, life: 6 }); } drawPix(ctx, COIN, s.x - 7, s.y, 1.6, SOLCOIN); s.life--; }
    this.sinks = this.sinks.filter((s) => s.life > 0);
    // falling leaves
    for (const l of this.leaves) { l.y += l.vy; l.x += Math.sin((f + l.t) / 14) * 0.8; l.t++; drawPix(ctx, Math.floor(l.t / 10) % 2 ? LEAF1 : LEAF2, l.x, l.y, 2, { g: skin.G || PAL.G }); if (l.y > base - 2) l.life = 0; l.life--; }
    this.leaves = this.leaves.filter((l) => l.life > 0);
    // birds (by day) / fireflies (by night)
    if (f >= this.birdAt) { const fromLeft = this.rand() < 0.5; this.birds.push({ x: fromLeft ? -20 : W + 20, y: 20 + this.rand() * 70, vx: (fromLeft ? 1 : -1) * (1.6 + this.rand() * 1.2), t: 0 }); this.birdAt = f + 260 + Math.floor(this.rand() * 500); }
    for (const b of this.birds) { b.x += b.vx; b.y += Math.sin(b.t / 7) * 0.9; b.t++; drawPix(ctx, BIRD[Math.floor(f / 6) % 2], b.x, b.y, 2, sky.night ? { k: "#4d3a7a", o: "#2a1b4a" } : null); }
    this.birds = this.birds.filter((b) => b.x > -30 && b.x < W + 30);
    if (sky.night) { if (this.flies.length < 9 && f % 30 === 0) this.flies.push({ x: 40 + this.rand() * (W - 80), y: base - 20 - this.rand() * 120, t: this.rand() * 100, life: 300 }); for (const y of this.flies) { y.x += Math.sin(y.t / 9) * 0.6; y.y += Math.cos(y.t / 11) * 0.4; y.t++; if (y.t % 40 < 24) drawPix(ctx, FIREFLY, y.x, y.y, 1.5); y.life--; } this.flies = this.flies.filter((y) => y.life > 0); }
    // glints
    for (const g of this.glints) { ctx.fillStyle = "#ffffff"; ctx.fillRect(g.x - 3, g.y, 7, 1); ctx.fillRect(g.x, g.y - 3, 1, 7); g.life--; }
    this.glints = this.glints.filter((g) => g.life > 0);
    // paused: asleep
    if (S.paused && f % 40 === 0) this.zz.push({ x: T.cx + 20, y: T.top - 10, life: 60 });
    for (const z of this.zz) { z.y -= 0.5; z.x += 0.3; ctx.font = "bold 14px Silkscreen, monospace"; ctx.fillStyle = "#fff6d6"; ctx.textAlign = "left"; ctx.fillText("z", z.x, z.y); z.life--; }
    this.zz = this.zz.filter((z) => z.life > 0);
    // labels
    ctx.font = "11px Silkscreen, monospace"; ctx.textAlign = "center"; ctx.fillStyle = "#fff6d6";
    if (S.started && T.level >= 3) ctx.fillText("$" + String(S.rootSym).toUpperCase(), T.cx, base + 18);
    this.frame++;
  }
}
/// a tiny tree for the level strip
function drawMiniTree(canvas, level, coinsN = 0) {
  const ctx = canvas.getContext("2d"), W = canvas.width, H = canvas.height; ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#1d1231"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#3a2615"; ctx.fillRect(0, H - 10, W, 10); ctx.fillStyle = "#3f8f3a"; ctx.fillRect(0, H - 12, W, 3);
  const skin = skinFor(level), cx = W / 2, base = H - 12;
  if (level === 1) { drawPix(ctx, SEED, cx - 7, base - 2, 1.5); return; }
  if (level === 2) { drawPix(ctx, SPROUT, cx - 8, base - 16, 2, skin); return; }
  const th = [0, 0, 18, 24, 30, 36, 40, 44][level - 1], tw = [0, 0, 3, 4, 5, 6, 8, 9][level - 1];
  ctx.fillStyle = "#9a6b3c"; ctx.fillRect(cx - tw / 2, base - th, tw, th);
  const n = Math.min(6, Math.max(1, level - 2));
  for (let i = 0; i < n; i++) { const side = i % 2 ? 1 : -1, y = base - th + 4 + i * (th / (n + 1)), len = 6 + (i % 3) * 3; drawLimb(ctx, cx, y, cx + side * len, y - len * 0.4, 2, 1); drawBlob(ctx, cx + side * len, y - len * 0.4 - 2, 5 + (level > 5 ? 2 : 0), 1, skin, i + 3); }
  drawBlob(ctx, cx, base - th - 3, 7 + level, 1, skin, 9);
}
if (typeof window !== "undefined") Object.assign(window, { RootScene, drawMiniTree });
