// The stack: an animated pixel scene — $L1 is the base slab, every launched coin a block on the layer it
// runs on (L2s on $L1, L3s on their L2…), its logo on the front. Fees fall as packets down through the
// layers and burn; when $L1 settles, SOL sinks into the board. Needs sprite.js.
// Usage: const sc = new StackScene(canvas); sc.set({ coins: [...] }); setInterval(() => sc.tick(), 50);
class StackScene {
  constructor(canvas) {
    this.c = canvas; this.ctx = canvas.getContext("2d"); this.frame = 0;
    this.state = { started: false, level: 1, coins: [], status: "idle", paused: false, l1Sym: "L1", burnedUsd: 0, hot: {} };
    this.nodes = []; this.sig = ""; this.imgs = {};
    this.packets = []; this.flames = []; this.glints = []; this.sinks = []; this.drops = []; this.pings = []; this.zz = []; this.bits = [];
    this.glow = 0; this.l1Glow = 0; this.sweep = -40; this.sweepAt = 160;
    for (let i = 0; i < 40; i++) this.bits.push({ x: (i * 173) % canvas.width, y: (i * 97) % (canvas.height - 60), v: 0.15 + (i % 4) * 0.08, t: (i * 37) % 90 });
    this.rand = Math.random;
  }
  set(patch) { Object.assign(this.state, patch); if (patch.coins) this.layout(); }
  // ---------------------------------------------------------------- events
  deploy(mint) { // a new layer lands on the stack
    const n = this.nodes.find((k) => k.mint === mint); const p = n ? { x: n.x + n.w / 2, y: n.y } : { x: this.c.width / 2, y: this.base - 40 };
    this.drops.push({ mint, life: 40 });
    for (let i = 0; i < 14; i++) this.glints.push({ x: p.x + (this.rand() - 0.5) * 60, y: p.y + (this.rand() - 0.5) * 30, life: 8 + Math.floor(this.rand() * 12) });
  }
  settle(mint, n = 5) { // fees fall from the coin down its chain to $L1 and burn
    const node = this.nodes.find((k) => k.mint === mint); if (!node) return this.finalize();
    const path = this.pathToL1(node);
    for (let i = 0; i < n; i++) this.packets.push({ path, seg: 0, t: 0, speed: 0.04 + this.rand() * 0.02, delay: i * 8, life: 400 });
    this.flames.push({ x: node.x + node.w / 2, y: node.y, life: 50 });
    this.glow = Math.max(this.glow, 40);
  }
  finalize(n = 10) { // $L1 settles: SOL sinks into the board, the slab flashes
    const L = this.l1 || { x: this.c.width / 2 - 100, w: 200 };
    for (let i = 0; i < n; i++) this.sinks.push({ x: L.x + 10 + this.rand() * (L.w - 20), y: -10 - this.rand() * 40, vy: 1.8 + this.rand() * 1.2, life: 200, delay: i * 6 });
    this.l1Glow = Math.max(this.l1Glow, 60);
  }
  ping() { this.pings.push({ x: -20, y: 30 + this.rand() * 40, vx: 3 + this.rand() * 2, t: 0 }); }
  // ---------------------------------------------------------------- layout
  get base() { return this.c.height - 44; }
  l1Width(level) { return [120, 180, 240, 300, 360, 420, 480, 540][Math.max(1, Math.min(8, level)) - 1]; }
  layout() {
    const S = this.state, W = this.c.width, cx = W / 2, base = this.base;
    const coins = S.coins.filter((c) => !c.isL1);
    const level = Math.max(coins.length ? 3 : 1, S.level);
    const sig = level + "|" + coins.map((c) => c.mint + ":" + c.parent).join(",");
    if (sig === this.sig) return; this.sig = sig;
    const lw = Math.min(W - 40, Math.max(this.l1Width(level), coins.filter((c) => c.depth === 1).length * 44 + 40)), lh = 30;
    const L1 = { x: Math.round(cx - lw / 2), y: base - lh, w: lw, h: lh };
    const nodes = [], byMint = {};
    const d1 = coins.filter((c) => c.depth === 1).slice(0, 14);
    const bw = Math.max(28, Math.min(52, Math.floor((lw - 24) / Math.max(1, d1.length)) - 8)), bh = 26;
    d1.forEach((c, i) => {
      const slot = (lw - 24) / d1.length, x = Math.round(L1.x + 12 + slot * i + (slot - bw) / 2), y = L1.y - 6 - bh;
      const n = { mint: c.mint, coin: c, depth: 1, x, y, w: bw, h: bh, parentNode: null };
      nodes.push(n); byMint[c.mint] = n;
    });
    const d2 = coins.filter((c) => c.depth === 2), per = {};
    d2.forEach((c) => { (per[c.parent] = per[c.parent] || []).push(c); });
    for (const [pm, list] of Object.entries(per)) {
      const p = byMint[pm]; if (!p) continue;
      const k = Math.min(3, list.length), w = Math.max(14, Math.floor((p.w - 4) / k) - 4), h = 20;
      list.slice(0, 3).forEach((c, j) => {
        const x = Math.round(p.x + 2 + j * ((p.w - 4) / k) + ((p.w - 4) / k - w) / 2), y = p.y - 6 - h;
        const n = { mint: c.mint, coin: c, depth: 2, x, y, w, h, parentNode: p }; nodes.push(n); byMint[c.mint] = n;
      });
    }
    const d3 = coins.filter((c) => c.depth >= 3);
    d3.forEach((c, j) => {
      const p = byMint[c.parent]; if (!p) return;
      const w = Math.max(10, p.w - 6), h = 14, x = Math.round(p.x + (p.w - w) / 2), y = p.y - 6 - h;
      const n = { mint: c.mint, coin: c, depth: c.depth, x, y, w, h, parentNode: p }; nodes.push(n); byMint[c.mint] = n;
    });
    this.nodes = nodes; this.byMint = byMint; this.l1 = L1; this.level = level; this.extra = coins.length - nodes.length;
    for (const n of nodes) this.loadImg(n.coin.image);
  }
  pathToL1(node) { const pts = []; let n = node; while (n) { pts.push({ x: n.x + n.w / 2, y: n.y + n.h / 2 }); n = n.parentNode; } pts.push({ x: this.l1.x + this.l1.w / 2, y: this.l1.y + this.l1.h / 2 }, { x: this.l1.x + this.l1.w / 2, y: this.base + 24 }); return pts; }
  loadImg(url) { if (!url || this.imgs[url] !== undefined) return; this.imgs[url] = null; const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => { this.imgs[url] = im; }; im.onerror = () => { this.imgs[url] = false; }; im.src = url; }
  // ---------------------------------------------------------------- draw
  tick() {
    const ctx = this.ctx, W = this.c.width, H = this.c.height, S = this.state, f = this.frame, base = this.base;
    ctx.imageSmoothingEnabled = false;
    if (!this.l1) this.layout();
    const L = this.l1, skin = skinFor(this.level);
    // backdrop: deep navy with a faint grid and drifting bits
    ctx.fillStyle = "#0b1020"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#121a33"; for (let x = 0; x < W; x += 32) ctx.fillRect(x, 0, 1, base); for (let y = 0; y < base; y += 32) ctx.fillRect(0, y, W, 1);
    for (const b of this.bits) { b.y -= b.v; if (b.y < 0) { b.y = base - 4; b.x = (b.x + 97) % W; } const ph = (f + b.t) % 90; ctx.fillStyle = ph < 8 ? "#5ef2ff" : ph < 20 ? "#2bb8d6" : "#1c2d55"; ctx.fillRect(b.x, b.y, 2, 2); }
    // the board (floor): dark slate with traces and SOL pads
    ctx.fillStyle = "#141a2e"; ctx.fillRect(0, base, W, H - base);
    ctx.fillStyle = "#2a2823"; ctx.fillRect(0, base - 2, W, 3);
    ctx.fillStyle = "#1f2a4a"; for (let i = 0; i < 14; i++) { const x = (i * 53) % W; ctx.fillRect(x, base + 8 + ((i * 7) % 20), 30 + ((i * 11) % 40), 2); ctx.fillRect(x + 30 + ((i * 11) % 40), base + 8 + ((i * 7) % 20), 2, 10); }
    for (let i = 0; i < 6; i++) drawPix(ctx, COIN, 30 + i * 110 + ((i * 31) % 40), base + 18 + ((i * 17) % 14), 1.6, SOLCOIN);
    ctx.font = "9px Silkscreen, monospace"; ctx.textAlign = "left"; ctx.fillStyle = "#4a5a8a"; ctx.fillText("SOL", 8, H - 6);
    // $L1: the base slab (genesis pending = a dim outline)
    const lg = this.l1Glow > 0 ? (f % 6 < 3) : false; if (this.l1Glow > 0) this.l1Glow--;
    if (!S.started) {
      ctx.fillStyle = "#1c2740"; ctx.fillRect(L.x, L.y, L.w, L.h); ctx.fillStyle = "#2a2823"; ctx.fillRect(L.x, L.y, L.w, 2); ctx.fillRect(L.x, L.y + L.h - 2, L.w, 2); ctx.fillRect(L.x, L.y, 2, L.h); ctx.fillRect(L.x + L.w - 2, L.y, 2, L.h);
      if (f % 60 < 30) { ctx.font = "10px Silkscreen, monospace"; ctx.textAlign = "center"; ctx.fillStyle = "#5ef2ff"; ctx.fillText("GENESIS PENDING", W / 2, L.y + 19); }
    } else {
      drawBlock(ctx, L.x, L.y, L.w, L.h, 2, skin, lg);
      // LEDs along the slab + a sync sweep
      for (let x = L.x + 8; x < L.x + L.w - 8; x += 12) { const on = ((x / 12 + Math.floor(f / 8)) % 5) === 0; ctx.fillStyle = on ? skin.led : skin.side; ctx.fillRect(x, L.y + L.h - 8, 4, 2); }
      if (f >= this.sweepAt) { this.sweep = L.x; this.sweepAt = f + 200 + Math.floor(this.rand() * 300); }
      if (this.sweep >= L.x && this.sweep < L.x + L.w) { ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(this.sweep, L.y, 6, L.h); this.sweep += 6; }
      ctx.font = "11px Silkscreen, monospace"; ctx.textAlign = "center"; ctx.fillStyle = "#0b1020"; ctx.fillText("$" + String(S.l1Sym).toUpperCase(), L.x + L.w / 2, L.y + 17);
    }
    // the layers (parents first)
    for (const n of this.nodes) {
      const hot = S.hot && S.hot[n.mint] ? 1 : 0, sk = depthSkin(n.depth);
      const drop = this.drops.find((d) => d.mint === n.mint), dy = drop ? -Math.round(drop.life * 1.5) : 0;
      drawBlock(ctx, n.x, n.y + dy, n.w, n.h, 2, sk, hot && f % 12 < 6);
      const im = this.imgs[n.coin.image], fs = Math.min(n.h - 6, n.depth === 1 ? 16 : n.depth === 2 ? 12 : 8), fx = Math.round(n.x + (n.w - fs) / 2), fy = Math.round(n.y + dy + (n.h - fs) / 2);
      ctx.fillStyle = "#2a2823"; ctx.fillRect(fx - 1, fy - 1, fs + 2, fs + 2);
      if (im) ctx.drawImage(im, fx, fy, fs, fs);
      else { const col = fruitColors(n.mint); ctx.fillStyle = col.light; ctx.fillRect(fx, fy, fs, fs); ctx.fillStyle = col.dark; ctx.fillRect(fx + fs / 2, fy + fs / 2, fs / 2, fs / 2); }
      // the layer's LED blinks with its own rhythm
      ctx.fillStyle = (f + hueOf(n.mint)) % 40 < 20 ? "#ffffff" : sk.side; ctx.fillRect(n.x + n.w - 5, n.y + dy + 2, 2, 2);
      if (hot && f % 10 === 0) this.glints.push({ x: n.x + this.rand() * n.w, y: n.y + dy - 4 + (this.rand() - 0.5) * 10, life: 6 });
    }
    for (const d of this.drops) d.life--; this.drops = this.drops.filter((d) => d.life > 0);
    if (this.extra > 0) { ctx.font = "9px Silkscreen, monospace"; ctx.fillStyle = "#fff6d6"; ctx.textAlign = "center"; ctx.fillText(`+${this.extra} MORE`, W / 2, L.y - 70); }
    // packets falling down the chain
    for (const p of this.packets) {
      if (p.delay > 0) { p.delay--; continue; }
      const a = p.path[p.seg], b = p.path[p.seg + 1]; if (!b) { p.life = 0; this.l1Glow = Math.max(this.l1Glow, 20); continue; }
      p.t += p.speed; if (p.t >= 1) { p.t = 0; p.seg++; if (p.path[p.seg + 1]) this.flames.push({ x: p.path[p.seg].x, y: p.path[p.seg].y - 8, life: 18 }); }
      const x = a.x + (b.x - a.x) * Math.min(1, p.t), y = a.y + (b.y - a.y) * Math.min(1, p.t);
      drawPix(ctx, PACKET, x - 5, y - 5, 2, f % 6 < 3 ? { n: "#ffffff" } : null); p.life--;
    }
    this.packets = this.packets.filter((p) => p.life > 0);
    // flames (burns)
    for (const fl of this.flames) { drawPix(ctx, FLAME[Math.floor(f / 4) % 2], fl.x - 5, fl.y - 14 - (50 - fl.life) * 0.3, 2); fl.life--; }
    this.flames = this.flames.filter((x) => x.life > 0);
    // SOL sinking into the board ($L1 finalizes)
    for (const s of this.sinks) { if (s.delay > 0) { s.delay--; continue; } s.y += s.vy; if (s.y > base + 26) { s.life = 0; this.glints.push({ x: s.x, y: base + 22, life: 6 }); } drawPix(ctx, COIN, s.x - 7, s.y, 1.6, SOLCOIN); s.life--; }
    this.sinks = this.sinks.filter((s) => s.life > 0);
    // pings: a packet crossing the sky
    for (const p of this.pings) { p.x += p.vx; p.t++; drawPix(ctx, PACKET, p.x, p.y + Math.sin(p.t / 6) * 2, 2, { n: "#8affa0" }); ctx.fillStyle = "#1f8f44"; ctx.fillRect(p.x - 10, p.y + 4, 8, 2); }
    this.pings = this.pings.filter((p) => p.x < W + 30);
    // glints
    for (const g of this.glints) { ctx.fillStyle = "#ffffff"; ctx.fillRect(g.x - 3, g.y, 7, 1); ctx.fillRect(g.x, g.y - 3, 1, 7); g.life--; }
    this.glints = this.glints.filter((g) => g.life > 0);
    if (this.glow > 0) this.glow--;
    // paused: asleep
    if (S.paused && f % 40 === 0) this.zz.push({ x: L.x + L.w - 10, y: L.y - 10, life: 60 });
    for (const z of this.zz) { z.y -= 0.5; z.x += 0.3; ctx.font = "bold 14px Silkscreen, monospace"; ctx.fillStyle = "#fff6d6"; ctx.textAlign = "left"; ctx.fillText("z", z.x, z.y); z.life--; }
    this.zz = this.zz.filter((z) => z.life > 0);
    this.frame++;
  }
}
/// a tiny stack for the epoch strip
function drawMiniStack(canvas, level) {
  const ctx = canvas.getContext("2d"), W = canvas.width, H = canvas.height; ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#0b1020"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#141a2e"; ctx.fillRect(0, H - 10, W, 10); ctx.fillStyle = "#2a2823"; ctx.fillRect(0, H - 11, W, 2);
  const skin = skinFor(level), base = H - 11, lw = [16, 22, 28, 34, 40, 46, 52, 56][level - 1], lh = 10;
  if (level === 1) { ctx.fillStyle = "#1c2740"; ctx.fillRect(W / 2 - lw / 2, base - lh, lw, lh); ctx.fillStyle = "#5ef2ff"; ctx.fillRect(W / 2 - 2, base - lh / 2 - 1, 4, 2); return; }
  drawBlock(ctx, W / 2 - lw / 2, base - lh, lw, lh, 1, skin);
  const n = Math.min(4, Math.max(0, level - 2)), bw = Math.max(5, Math.floor((lw - 6) / Math.max(1, n)) - 2);
  for (let i = 0; i < n; i++) { const x = W / 2 - lw / 2 + 3 + i * ((lw - 6) / n); drawBlock(ctx, Math.round(x), base - lh - 4 - 8, bw, 8, 1, depthSkin(1)); if (level >= 6 && i % 2 === 0) drawBlock(ctx, Math.round(x) + 1, base - lh - 4 - 8 - 3 - 6, Math.max(3, bw - 2), 6, 1, depthSkin(2)); }
}
if (typeof window !== "undefined") Object.assign(window, { StackScene, drawMiniStack });
