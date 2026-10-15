// The stack explorer: a vector diagram of the stack. Lanes from the bottom up — $L1 as a wide bar, every
// layer a block on the lane above its base layer, width by market cap. Fees flow down as dashes along the
// connectors and flash when they settle; $L1 pulses when it finalizes. Also a live log (tail -f) of events.
// Usage: const ex = new StackExplorer(canvas, logEl); ex.set({ coins }); setInterval(() => ex.tick(), 1000 / 30);
class StackExplorer {
  constructor(canvas, logEl) {
    this.c = canvas; this.ctx = canvas.getContext("2d"); this.logEl = logEl; this.frame = 0;
    this.state = { started: false, level: 1, coins: [], status: "idle", paused: false, l1Sym: "L1", burnedUsd: 0, hot: {} };
    this.nodes = []; this.sig = null; this.imgs = {}; this.flows = []; this.flashes = []; this.pulse = 0; this.drops = []; this.lines = []; this.cursor = 0;
    this.col = { bg: "#06070a", lane: "#0f1218", grid: "#161a23", text: "#e6e8ef", muted: "#7b8294", l1: "#e6e8ef", d1: "#7cff6b", d2: "#ffb020", d3: "#ff5cf0", sol: "#9fb3ff" };
    this.rand = Math.random;
  }
  colorOf(depth) { return depth === 0 ? this.col.l1 : depth === 1 ? this.col.d1 : depth === 2 ? this.col.d2 : this.col.d3; }
  set(patch) { Object.assign(this.state, patch); if (patch.coins) this.layout(); }
  log(kind, text) { this.lines.push({ kind, text, t: Date.now() }); if (this.lines.length > 60) this.lines.shift(); this.renderLog(); }
  renderLog() {
    if (!this.logEl) return;
    this.logEl.innerHTML = this.lines.slice(-14).map((l) => `<div class="ln ${l.kind}"><span class="ts">${new Date(l.t).toISOString().slice(11, 19)}</span>${l.text}</div>`).join("") + `<div class="ln cur"><span class="ts">&nbsp;</span>▮</div>`;
  }
  // ---------------------------------------------------------------- events
  deploy(mint) { const n = this.nodes.find((k) => k.mint === mint); if (n) this.drops.push({ mint, life: 30 }); this.flashes.push({ node: n, life: 24 }); if (n) this.log("ok", `<b>deploy</b> $${n.coin.symbol} · ${this.laneName(n.depth)} on $${n.parentNode ? n.parentNode.coin.symbol : this.state.l1Sym}`); }
  settle(mint, n = 5) {
    const node = this.nodes.find((k) => k.mint === mint); if (!node) return this.finalize();
    const path = this.pathDown(node);
    for (let i = 0; i < n; i++) this.flows.push({ path, seg: 0, t: 0, speed: 0.03 + this.rand() * 0.02, delay: i * 7, color: this.colorOf(node.depth) });
    this.flashes.push({ node, life: 30 });
    this.log("settle", `<b>settle</b> $${node.coin.symbol} → burn self · burn $${node.parentNode ? node.parentNode.coin.symbol : this.state.l1Sym}`);
  }
  finalize() { this.pulse = 50; this.log("l1", `<b>finalize</b> $${this.state.l1Sym} · claim SOL → buy back → burn`); }
  ping() { this.log("muted", `ping · ${this.nodes.length} layer${this.nodes.length === 1 ? "" : "s"} · stack height ${this.laneName(this.nodes.reduce((m, n) => Math.max(m, n.depth), 0))}`); }
  laneName(d) { return "L" + (d + 1); }
  // ---------------------------------------------------------------- layout
  layout() {
    const S = this.state, W = this.c.width, H = this.c.height;
    const coins = S.coins.filter((c) => !c.isL1);
    const sig = coins.map((c) => c.mint + ":" + c.parent + ":" + Math.round(c.mcapUsd || 0)).join(",");
    if (sig === this.sig) return; this.sig = sig;
    const maxDepth = Math.max(1, coins.reduce((m, c) => Math.max(m, c.depth), 0));
    const lanes = maxDepth + 1, laneH = Math.min(64, Math.floor((H - 40) / lanes)), bottom = H - 22;
    const laneY = (d) => bottom - d * laneH;                               // top of the block on lane d is laneY(d) - blockH
    const blockH = Math.round(laneH * 0.55);
    const L1 = { x: 24, y: laneY(0) - blockH, w: W - 48, h: blockH, depth: 0 };
    const nodes = [], byMint = {};
    const place = (list, parent, x0, x1) => {
      if (!list.length) return;
      const total = list.reduce((s, c) => s + Math.max(1, Math.sqrt(c.mcapUsd || 1)), 0), gap = 6, avail = (x1 - x0) - gap * (list.length + 1);
      let x = x0 + gap;
      for (const c of list) {
        const w = Math.max(18, Math.floor((avail * Math.max(1, Math.sqrt(c.mcapUsd || 1))) / total));
        const n = { mint: c.mint, coin: c, depth: c.depth, x, y: laneY(c.depth) - blockH, w: Math.min(w, x1 - x - gap), h: blockH, parentNode: parent };
        nodes.push(n); byMint[c.mint] = n; x += n.w + gap;
        place(coins.filter((k) => k.parent === c.mint).sort((a, b) => (b.mcapUsd || 0) - (a.mcapUsd || 0)), n, n.x, n.x + n.w);
      }
    };
    place(coins.filter((c) => c.depth === 1).sort((a, b) => (b.mcapUsd || 0) - (a.mcapUsd || 0)), null, L1.x, L1.x + L1.w);
    this.nodes = nodes; this.byMint = byMint; this.l1 = L1; this.lanes = lanes; this.laneH = laneH; this.laneY = laneY; this.blockH = blockH;
    for (const n of nodes) this.loadImg(n.coin.image);
  }
  pathDown(node) { const pts = []; let n = node; while (n) { pts.push({ x: n.x + n.w / 2, y: n.y + n.h }); n = n.parentNode; if (n) pts.push({ x: n.x + n.w / 2, y: n.y }); } pts.push({ x: this.l1.x + this.l1.w / 2, y: this.l1.y }, { x: this.l1.x + this.l1.w / 2, y: this.l1.y + this.l1.h }); return pts; }
  loadImg(url) { if (!url || this.imgs[url] !== undefined) return; this.imgs[url] = null; const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => { this.imgs[url] = im; }; im.onerror = () => { this.imgs[url] = false; }; im.src = url; }
  // ---------------------------------------------------------------- draw
  tick() {
    const ctx = this.ctx, W = this.c.width, H = this.c.height, S = this.state, f = this.frame, C = this.col;
    if (!this.l1) this.layout();
    const L = this.l1;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    // lanes + labels
    ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace"; ctx.textBaseline = "middle";
    for (let d = 0; d < this.lanes; d++) {
      const y = this.laneY(d);
      ctx.fillStyle = C.grid; ctx.fillRect(0, y - 0.5, W, 1);
      ctx.fillStyle = d === 0 ? C.muted : this.colorOf(d); ctx.globalAlpha = 0.9; ctx.textAlign = "left"; ctx.fillText(this.laneName(d), 6, y - this.laneH / 2); ctx.globalAlpha = 1;
    }
    ctx.fillStyle = C.grid; ctx.fillRect(0, H - 22 + 0.5, W, 1);
    ctx.fillStyle = C.muted; ctx.textAlign = "left"; ctx.fillText("SOL", 6, H - 11); ctx.textAlign = "right"; ctx.fillText(S.started ? `fees settled ${fmtUsd(S.burnedUsd)}` : "genesis pending", W - 8, H - 11);
    // connectors (thin lines from each block down to its base)
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (const n of this.nodes) { const p = n.parentNode || L; ctx.beginPath(); ctx.moveTo(n.x + n.w / 2, n.y + n.h); ctx.lineTo(n.x + n.w / 2, p.y); ctx.stroke(); }
    // $L1
    const pulse = this.pulse > 0 ? 0.5 + 0.5 * Math.sin(f / 3) : 0; if (this.pulse > 0) this.pulse--;
    if (!S.started) { ctx.strokeStyle = C.muted; ctx.setLineDash([4, 4]); ctx.strokeRect(L.x + 0.5, L.y + 0.5, L.w - 1, L.h - 1); ctx.setLineDash([]); ctx.fillStyle = C.muted; ctx.textAlign = "center"; ctx.font = "12px 'JetBrains Mono', monospace"; if (f % 60 < 40) ctx.fillText("$L1 · GENESIS PENDING", L.x + L.w / 2, L.y + L.h / 2); }
    else {
      ctx.fillStyle = C.lane; ctx.fillRect(L.x, L.y, L.w, L.h);
      ctx.strokeStyle = C.l1; ctx.globalAlpha = 0.5 + pulse * 0.5; ctx.strokeRect(L.x + 0.5, L.y + 0.5, L.w - 1, L.h - 1); ctx.globalAlpha = 1;
      if (pulse) { ctx.fillStyle = C.l1; ctx.globalAlpha = pulse * 0.12; ctx.fillRect(L.x, L.y, L.w, L.h); ctx.globalAlpha = 1; }
      ctx.fillStyle = C.text; ctx.textAlign = "left"; ctx.font = "600 13px 'Space Grotesk', system-ui, sans-serif"; ctx.fillText("$" + String(S.l1Sym).toUpperCase(), L.x + 10, L.y + L.h / 2);
      ctx.font = "11px 'JetBrains Mono', monospace"; ctx.fillStyle = C.muted; ctx.textAlign = "right"; ctx.fillText(`base layer · ${this.nodes.filter((n) => n.depth === 1).length} L2${this.nodes.filter((n) => n.depth === 1).length === 1 ? "" : "s"}`, L.x + L.w - 10, L.y + L.h / 2);
      // a slow scan across the slab
      const sx = L.x + ((f * 1.5) % (L.w + 40)) - 20; ctx.fillStyle = C.l1; ctx.globalAlpha = 0.08; ctx.fillRect(sx, L.y, 20, L.h); ctx.globalAlpha = 1;
    }
    // layers
    for (const n of this.nodes) {
      const col = this.colorOf(n.depth), hot = S.hot && S.hot[n.mint], drop = this.drops.find((d) => d.mint === n.mint), dy = drop ? -drop.life * 2 : 0;
      const fl = this.flashes.find((x) => x.node === n), glow = fl ? fl.life / 30 : 0;
      ctx.fillStyle = C.lane; ctx.fillRect(n.x, n.y + dy, n.w, n.h);
      if (glow) { ctx.fillStyle = col; ctx.globalAlpha = glow * 0.25; ctx.fillRect(n.x, n.y + dy, n.w, n.h); ctx.globalAlpha = 1; }
      ctx.strokeStyle = col; ctx.globalAlpha = hot ? 0.6 + 0.4 * Math.sin(f / 4) : 0.85; ctx.strokeRect(n.x + 0.5, n.y + dy + 0.5, n.w - 1, n.h - 1); ctx.globalAlpha = 1;
      ctx.fillStyle = col; ctx.fillRect(n.x, n.y + dy, n.w, 2);
      const im = this.imgs[n.coin.image], fs = Math.min(n.h - 8, 18); let tx = n.x + 6;
      if (n.w >= 40) { if (im) { ctx.drawImage(im, n.x + 5, n.y + dy + (n.h - fs) / 2, fs, fs); tx += fs + 4; } }
      if (n.w >= 54) { ctx.fillStyle = C.text; ctx.textAlign = "left"; ctx.font = "11px 'JetBrains Mono', monospace"; const label = "$" + n.coin.symbol; ctx.fillText(label.length * 7 > n.w - (tx - n.x) - 4 ? label.slice(0, Math.max(2, Math.floor((n.w - (tx - n.x) - 4) / 7))) : label, tx, n.y + dy + n.h / 2); }
      else if (n.w >= 22) { ctx.fillStyle = col; ctx.fillRect(n.x + n.w / 2 - 2, n.y + dy + n.h / 2 - 2, 4, 4); }
    }
    for (const d of this.drops) d.life--; this.drops = this.drops.filter((d) => d.life > 0);
    for (const x of this.flashes) x.life--; this.flashes = this.flashes.filter((x) => x.life > 0);
    // fee flows down the connectors
    for (const p of this.flows) {
      if (p.delay > 0) { p.delay--; continue; }
      const a = p.path[p.seg], b = p.path[p.seg + 1]; if (!b) { p.done = true; this.pulse = Math.max(this.pulse, 12); continue; }
      p.t += p.speed; if (p.t >= 1) { p.t = 0; p.seg++; }
      const x = a.x + (b.x - a.x) * Math.min(1, p.t), y = a.y + (b.y - a.y) * Math.min(1, p.t);
      ctx.fillStyle = p.color; ctx.fillRect(x - 1, y - 4, 2, 8); ctx.globalAlpha = 0.35; ctx.fillRect(x - 1, y - 12, 2, 8); ctx.globalAlpha = 1;
    }
    this.flows = this.flows.filter((p) => !p.done);
    // paused
    if (S.paused) { ctx.fillStyle = C.muted; ctx.textAlign = "center"; ctx.font = "12px 'JetBrains Mono', monospace"; if (f % 40 < 25) ctx.fillText("SEQUENCER PAUSED", W / 2, 16); }
    this.frame++;
  }
}
const fmtUsd = (n) => (!isFinite(n) ? "—" : n >= 1000 ? "$" + Math.round(n).toLocaleString("en-US") : "$" + n.toFixed(2));
if (typeof window !== "undefined") Object.assign(window, { StackExplorer });
