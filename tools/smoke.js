/* ===========================================================
 * 《行知·晓庄》引擎冒烟测试
 * 用一个极简 DOM 桩 + BFS 自动寻路，真机跑通整条主线，
 * 用于捕捉选择器拼写、事件绑定、对话栈、地图切换中的运行时错误。
 * 用法： node tools/smoke.js
 * =========================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* ---------------- 极简 DOM ---------------- */
const ALL = [];
let idMap = {};

class El {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this._cls = new Set();
    this.style = { setProperty() {}, };
    this.dataset = {};
    this._html = '';
    this._text = '';
    this._listeners = {};
    this.id = '';
    this.disabled = false;
    this.offsetWidth = 1;
    ALL.push(this);
  }
  get classList() {
    const self = this;
    return {
      add(...c) { c.forEach(x => x && self._cls.add(x)); },
      remove(...c) { c.forEach(x => self._cls.delete(x)); },
      toggle(c, f) { if (f === undefined) f = !self._cls.has(c); f ? self._cls.add(c) : self._cls.delete(c); },
      contains(c) { return self._cls.has(c); }
    };
  }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this._cls].join(' '); }
  set innerHTML(v) {
    this._html = String(v);
    this.children = [];
    // 极简解析：只提取标签、id、class —— 足够让选择器找到按钮
    const re = /<(\w+)([^>]*)>/g;
    let m;
    while ((m = re.exec(this._html))) {
      const el = new El(m[1]);
      const attrs = m[2] || '';
      const idm = /\bid="([^"]+)"/.exec(attrs);
      const cm = /\bclass="([^"]+)"/.exec(attrs);
      if (idm) { el.id = idm[1]; idMap[el.id] = el; }
      if (cm) el.className = cm[1];
      el.parentNode = this;
      this.children.push(el);
    }
  }
  get innerHTML() { return this._html; }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }
  removeEventListener() {}
  click() { (this._listeners.click || []).forEach(f => f({ stopPropagation() {}, preventDefault() {} })); }
  fire(type, ev) { (this._listeners[type] || []).forEach(f => f(Object.assign({ stopPropagation() {}, preventDefault() {} }, ev || {}))); }
  descendants(out) { out = out || []; this.children.forEach(c => { out.push(c); c.descendants(out); }); return out; }
  matches(sel) {
    if (sel.startsWith('#')) return this.id === sel.slice(1);
    if (sel.startsWith('.')) return this._cls.has(sel.slice(1));
    return this.tagName === sel.toUpperCase();
  }
}

// 依据 index.html 预先建好引擎会用到的节点
const IDS = ['title', 'game', 'inp-name', 'btn-new', 'btn-continue', 'btn-how',
  'hud-chapter', 'hud-objective', 'hud-stats', 'btn-menu', 'stage', 'map-name',
  'dialog', 'dlg-panel', 'dlg-who', 'dlg-text', 'dlg-choices', 'dlg-more', 'dlg-tip',
  'overlay', 'overlay-box', 'toasts'];
const root = new El('body');
IDS.forEach((id) => { const e = new El('div'); e.id = id; root.appendChild(e); idMap[id] = e; });
idMap['title'].classList.add('active');
idMap['dialog'].classList.add('hidden');
idMap['overlay'].classList.add('hidden');
const petals = new El('div'); petals.className = 'petals'; root.appendChild(petals);
const pad = new El('div'); pad.id = 'pad'; root.appendChild(pad); idMap['pad'] = pad;
['up', 'left', 'act', 'right', 'down'].forEach((d) => {
  const b = new El('button'); b.className = 'pad-btn';
  if (d === 'act') b.dataset.act = 'act'; else b.dataset.dir = d;
  pad.appendChild(b);
});
idMap['inp-name'].value = '小陶';

function walkAll() { return root.descendants().concat([root]); }

const document = {
  querySelector(sel) {
    const parts = sel.trim().split(/\s+/);
    if (parts.length === 1) {
      if (parts[0].startsWith('#')) return idMap[parts[0].slice(1)] || null;
      return walkAll().find(e => e !== root && e.matches(parts[0])) || null;
    }
    const base = this.querySelector(parts[0]);
    if (!base) return null;
    return base.descendants().find(e => e.matches(parts[1])) || null;
  },
  querySelectorAll(sel) {
    const parts = sel.trim().split(/\s+/);
    if (parts.length === 1) return walkAll().filter(e => e !== root && e.matches(parts[0]));
    const base = this.querySelector(parts[0]);
    if (!base) return [];
    return base.descendants().filter(e => e.matches(parts[1]));
  },
  createElement(tag) { return new El(tag); }
};

const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};

const winListeners = {};
const window = {
  addEventListener(t, f) { (winListeners[t] = winListeners[t] || []).push(f); },
  removeEventListener() {},
  document, localStorage,
  setTimeout: (f, ms) => setTimeout(f, Math.min(ms || 0, 5)),   // 加速计时器
  setInterval: (f, ms) => setInterval(f, Math.max(ms, 1)),
  clearTimeout: clearTimeout
};

/* ---------------- 载入剧情与引擎 ---------------- */
const storySrc = fs.readFileSync(path.join(ROOT, 'js', 'story.js'), 'utf8');
const engineSrc = fs.readFileSync(path.join(ROOT, 'js', 'engine.js'), 'utf8');
new Function('window', 'document', 'localStorage', storySrc)(window, document, localStorage);
new Function('window', 'document', 'localStorage', engineSrc)(window, document, localStorage);
const D = window.STORY;
const Game = window.Game;

/* ---------------- 运行期工具 ---------------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $$ = sel => document.querySelector(sel);
const hidden = el => el.classList.contains('hidden');
const DBG = !!process.env.SMOKE_DEBUG;
const dbg = (...a) => { if (DBG) console.log('  [dbg]', ...a); };

let errors = [];
process.on('uncaughtException', e => { errors.push('uncaught: ' + e.stack); });
process.on('unhandledRejection', e => { errors.push('unhandled: ' + (e && e.stack || e)); });

function key(k) {
  (winListeners.keydown || []).forEach(f => f({ key: k, repeat: false, preventDefault() {}, stopPropagation() {} }));
  (winListeners.keyup || []).forEach(f => f({ key: k, repeat: false, preventDefault() {}, stopPropagation() {} }));
}

const BLOCKED = new Set('#T~HCSB=PGXDW'.split(''));
function tiles(m) {
  const w = Math.max(...m.tiles.map(r => r.length));
  return m.tiles.map(r => r.padEnd(w, '#'));
}
function walkable(mapId, x, y, S) {
  const m = D.maps[mapId], t = tiles(m);
  if (x < 0 || y < 0 || y >= t.length || x >= t[0].length) return false;
  if (BLOCKED.has(t[y][x])) return false;
  if ((m.objects || []).some(o => o.x === x && o.y === y)) return false;
  if ((m.npcs || []).some(n => n.x === x && n.y === y && (!n.condition || n.condition(S)))) return false;
  return true;
}
// BFS：从 (sx,sy) 到任一目标落脚点
function bfs(mapId, sx, sy, goals, S) {
  const keyOf = (x, y) => x + ',' + y;
  const goalSet = new Set(goals.map(g => keyOf(g[0], g[1])));
  const prev = new Map();
  const start = keyOf(sx, sy);
  prev.set(start, null);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    if (goalSet.has(keyOf(x, y)) && !(x === sx && y === sy)) {
      const pathArr = [];
      let cur = keyOf(x, y);
      while (cur && cur !== start) {
        const [px, py] = cur.split(',').map(Number);
        pathArr.unshift([px, py]);
        cur = prev.get(cur);
      }
      return pathArr;
    }
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx, ny = y + dy, k = keyOf(nx, ny);
      if (prev.has(k) || !walkable(mapId, nx, ny, S)) continue;
      prev.set(k, keyOf(x, y));
      q.push([nx, ny]);
    }
  }
  return null;
}

const DIRKEY = { '0,-1': 'ArrowUp', '0,1': 'ArrowDown', '-1,0': 'ArrowLeft', '1,0': 'ArrowRight' };

/* ---------------- 对话推进 ---------------- */
async function drainDialog(pickIdx) {
  let guard = 0;
  while (!hidden($$('#dialog')) && guard++ < 4000) {
    const ch = $$('#dlg-choices');
    if (!hidden(ch) && ch.children.length) {
      const opts = ch.children;
      const idx = pickIdx(opts.length);
      opts[Math.min(idx, opts.length - 1)].click();
      await sleep(2);
      continue;
    }
    $$('#dlg-panel').click();   // 打字中 → 立即显示；已显示 → 下一句
    await sleep(2);
  }
}

/* ---------------- 主流程 ---------------- */
async function main() {
  Game.boot();
  $$('#btn-new').click();
  await sleep(500);   // 等待开场对白的延时定时器

  let pick = 0;
  const pickIdx = (n) => (pick++ % n);   // 轮流选择，覆盖各种分支

  let lastMap = null, pass = 0, interactCount = 0, loopGuard = 0;

  while (loopGuard++ < 6000) {
    const S = Game.state();
    if (!S) { errors.push('Game.state() 为空'); break; }

    if (!hidden($$('#dialog'))) { await drainDialog(pickIdx); continue; }

    // 章节卡 / 结局 覆盖层
    if (!hidden($$('#overlay'))) {
      const btn = $$('#ov-next') || $$('#ov-again') || $$('#ov-home') || document.querySelector('#overlay-box .btn-main');
      if (btn) { btn.click(); await sleep(10); continue; }
      errors.push('覆盖层出现但没有可点击的按钮');
      break;
    }

    if (S.endingId) break;

    if (S.map !== lastMap) { lastMap = S.map; pass = 0; }

    const m = D.maps[S.map];
    const targets = [];
    (m.objects || []).forEach(o => targets.push({ kind: 'obj', ref: o, x: o.x, y: o.y }));
    (m.npcs || []).forEach(n => { if (!n.condition || n.condition(S)) targets.push({ kind: 'npc', ref: n, x: n.x, y: n.y }); });
    dbg(`在地图 ${S.map} (${S.x},${S.y}) 章节${S.chapter} pass${pass} 目标${targets.length} 对话${!hidden($$('#dialog'))}`);

    // 每轮把可达目标全部交互一次
    let acted = false;
    for (const t of targets) {
      const S2 = Game.state();
      if (S2.map !== S.map) break;
      const goals = [];
      for (const [dx, dy] of [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const gx = t.x + dx, gy = t.y + dy;
        if (dx === 0 && dy === 0) { if (walkable(S.map, gx, gy, S2)) goals.push([gx, gy]); continue; }
        if (walkable(S.map, gx, gy, S2)) goals.push([gx, gy]);
      }
      if (!goals.length) { dbg(`目标 ${t.kind}(${t.x},${t.y}) 周围无可站立格`); continue; }
      let pathArr = bfs(S.map, S2.x, S2.y, goals, S2);
      if (!pathArr) { dbg(`目标 ${t.kind}(${t.x},${t.y}) 不可达 goals=${JSON.stringify(goals)}`); continue; }

      // 沿路径行走（引擎每步有 105ms 冷却，未生效则重试按键）
      let ok = true;
      for (const [nx, ny] of pathArr) {
        let arrived = false;
        for (let w = 0; w < 16; w++) {
          const cur = Game.state();
          if (cur.map !== S.map || !hidden($$('#dialog'))) { ok = false; dbg('走位中断：地图/对话变化'); break; }
          if (cur.x === nx && cur.y === ny) { arrived = true; break; }
          key(DIRKEY[(nx - cur.x) + ',' + (ny - cur.y)]);
          await sleep(40);
        }
        if (!ok || !arrived) { dbg(`走位失败：目标格 (${nx},${ny})，当前 (${Game.state().x},${Game.state().y})`); ok = false; break; }
        await sleep(110);   // 等待移动冷却结束
      }
      if (!ok) continue;

      // 面向目标并交互
      const cur = Game.state();
      const dx = t.x - cur.x, dy = t.y - cur.y;
      if (dx || dy) {
        key(DIRKEY[dx + ',' + dy]);   // 目标格不可走 → 只转身
        await sleep(15);
      }
      key('e');
      await sleep(15);
      acted = true;
      interactCount++;
    }

    if (!acted) {
      pass++;
      if (pass > 3) { errors.push(`在地图 ${S.map} 上找不到可交互目标，流程卡住（章节 ${S.chapter}）`); break; }
    }
  }

  const S = Game.state();
  console.log('—— 冒烟测试结果 ——');
  console.log(`交互次数：${interactCount}`);
  console.log(`最终章节：${S.chapter}（${(D.chapters[S.chapter] || {}).no}）`);
  console.log(`结局：${S.endingId || '未抵达结局'}`);
  console.log(`心志：仁 ${S.stats.ren} / 真 ${S.stats.zhen} / 创 ${S.stats.chuang}`);
  console.log(`行知书卷：${S.items.length} / ${Object.keys(D.relics).length}`);
  console.log(`走过地图：${S.map}`);

  if (errors.length) {
    console.log(`\n✗ 发现 ${errors.length} 个问题：`);
    [...new Set(errors)].slice(0, 20).forEach(e => console.log('  ' + e));
    process.exit(1);
  }
  if (!S.endingId) { console.log('\n✗ 未能抵达结局'); process.exit(1); }
  console.log('\n✓ 引擎冒烟测试通过：从标题界面一路自动通关到结局，无运行时错误。');
  process.exit(0);
}

main().catch(e => { console.log('✗ 测试异常：', e.stack); process.exit(1); });
