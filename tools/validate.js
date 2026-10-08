/* ===========================================================
 * 《行知·晓庄》静态校验 + 自动通关模拟
 * 用法： node tools/validate.js
 * =========================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'story.js'), 'utf8');

global.window = {};
new Function('window', src)(global.window);
const D = global.window.STORY;

let errors = [];
let warns = [];
function err(m) { errors.push(m); }
function warn(m) { warns.push(m); }

const BLOCKED = new Set('#T~HCSB=PGXDW'.split(''));
const pad = (m) => {
  const w = Math.max(...m.tiles.map(r => r.length));
  return m.tiles.map(r => r.padEnd(w, '#'));
};

/* ---------- 1. 结构校验 ---------- */
console.log('== 1. 地图结构校验 ==');
Object.keys(D.maps).forEach((id) => {
  const m = D.maps[id];
  const t = pad(m);
  const w = t[0].length, h = t.length;
  m._t = t; m._w = w; m._h = h;

  const isWalk = (x, y) =>
    x >= 0 && y >= 0 && x < w && y < h && !BLOCKED.has(t[y][x]);

  // 出生点
  if (!isWalk(m.spawn[0], m.spawn[1])) err(`[${id}] 出生点 (${m.spawn}) 不可行走：'${t[m.spawn[1]][m.spawn[0]]}'`);

  // 连通性（忽略 NPC / 物件）
  const seen = new Set();
  const q = [[m.spawn[0], m.spawn[1]]];
  seen.add(m.spawn.join(','));
  while (q.length) {
    const [x, y] = q.pop();
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (isWalk(nx, ny) && !seen.has(k)) { seen.add(k); q.push([nx, ny]); }
    });
  }

  const reachable = (x, y) => seen.has(x + ',' + y) ||
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has((x + dx) + ',' + (y + dy)));

  const check = (label, arr, walkable) => {
    (arr || []).forEach((o) => {
      if (o.x < 0 || o.y < 0 || o.x >= w || o.y >= h) { err(`[${id}] ${label} ${o.name || o.id} 坐标越界 (${o.x},${o.y})`); return; }
      if (walkable && !isWalk(o.x, o.y)) err(`[${id}] ${label} ${o.name || o.id} 站在不可行走格 '${t[o.y][o.x]}' (${o.x},${o.y})`);
      if (!reachable(o.x, o.y)) err(`[${id}] ${label} ${o.name || o.id} (${o.x},${o.y}) 无法从出生点抵达`);
    });
  };
  check('NPC', m.npcs, true);
  check('物件', m.objects, false);

  // 引用检查
  (m.npcs || []).forEach(n => { if (!D.dialogs[n.dialog]) err(`[${id}] NPC ${n.id} 引用了不存在的对白 '${n.dialog}'`); });
  (m.objects || []).forEach(o => {
    if (o.dialog && !D.dialogs[o.dialog]) err(`[${id}] 物件 ${o.name} 引用了不存在的对白 '${o.dialog}'`);
    if (o.portal && !D.maps[o.portal.to]) err(`[${id}] 物件 ${o.name} 指向不存在的地图 '${o.portal.to}'`);
    if (!o.dialog && !o.portal) err(`[${id}] 物件 ${o.name} 既无 dialog 也无 portal`);
  });
});
Object.keys(D.enter).forEach(k => {
  if (!D.maps[k]) err(`enter 表中地图不存在：${k}`);
  if (!D.dialogs[D.enter[k]]) err(`enter 表 ${k} 引用不存在的对白 ${D.enter[k]}`);
});

/* ---------- 2. 对白健壮性：所有分支、各种状态 ---------- */
console.log('== 2. 对白健壮性校验 ==');
function baseState() {
  return {
    name: '测试者', chapter: 0, map: 'library', x: 0, y: 0, facing: 'down',
    stats: { ren: 1, zhen: 1, chuang: 1 },
    flags: {}, items: [], talked: {}, seen: {}, objective: ''
  };
}
function runDialog(key, S, policy, rng, depth) {
  depth = depth || 0;
  if (depth > 30) return;
  let lines;
  try { lines = D.dialogs[key](S); } catch (e) { err(`对白 ${key} 抛异常：${e.message}`); return; }
  if (!Array.isArray(lines)) { err(`对白 ${key} 未返回数组`); return; }
  walk(lines, S, policy, rng, depth + 1);
}
function walk(lines, S, policy, rng, depth) {
  for (const node of lines) {
    if (!node || typeof node !== 'object') { err('对白节点不是对象：' + JSON.stringify(node)); continue; }
    if (node.effect) applyEffect(node.effect, key0);
    if (node.choices) {
      if (!Array.isArray(node.choices) || !node.choices.length) { err('choices 为空'); continue; }
      node.choices.forEach(c => { if (!c.text) err('选项缺少 text'); });
      let idx = 0;
      if (policy === 'random') idx = Math.floor(rng() * node.choices.length);
      else if (policy === 'max') {
        let best = -1e9;
        node.choices.forEach((c, i) => {
          const s = (c.effect && c.effect.stats) || {};
          const v = (s.ren || 0) + (s.zhen || 0) + (s.chuang || 0) + (c.effect && c.effect.flag ? 0.1 : 0);
          if (v > best) { best = v; idx = i; }
        });
      }
      const c = node.choices[idx];
      if (c.effect) applyEffect(c.effect, key0);
      if (c.lines) walk(c.lines, S, policy, rng, depth + 1);
    }
  }
}
let key0 = '';
function applyEffect(e, k) {
  if (e.stats) for (const s in e.stats) S0.stats[s] = (S0.stats[s] || 0) + e.stats[s];
  if (e.flag) S0.flags[e.flag] = 1;
  if (e.item && S0.items.indexOf(e.item) < 0) {
    S0.items.push(e.item);
    if (!D.relics[e.item]) warn(`信物「${e.item}」未在 relics 中登记`);
  }
  if (e.card !== undefined && e.card !== null && !D.chapters[e.card]) err(`非法的章节号 card=${e.card}（来源 ${k}）`);
  if (e.map) {
    if (!D.maps[e.map.to]) err(`对白 ${k} 指向不存在的地图 ${e.map.to}`);
    else if (e.map.spawn && !D.maps[e.map.to]._t) err(`地图 ${e.map.to} 尚未校验`);
  }
}
let S0 = null;

// 用多种随机状态反复调用所有对白，捕捉异常
const allKeys = Object.keys(D.dialogs);
let rngState = 12345;
const rng = () => { rngState = (rngState * 1103515245 + 12345) % 2147483648; return rngState / 2147483648; };

let calls = 0;
for (let round = 0; round < 60; round++) {
  S0 = baseState();
  // 随机预习一批 flag，制造不同分支
  Object.keys(D.dialogs).forEach(() => {
    if (rng() < 0.28) S0.flags['f' + Math.floor(rng() * 40)] = 1;
  });
  ['ch1_study', 'ch2_usa', 'ch3_note', 'ch3_talk_dewey', 'ch4_quit', 'ch4_last', 'ch4_1000',
   'ch5_name', 'ch5_stone', 'ch5_farmer', 'ch5_bean', 'ch5_3', 'ch5_1930',
   'ch6_abo', 'ch6_xiansheng', 'ch6_report', 'ch7_zhou', 'today_code'].forEach(f => {
    if (rng() < 0.4) S0.flags[f] = 1;
  });
  S0.talked = { mother: 1, linxiaoman: 1, shushu: 1, aniu: 1, cy_rich: 1, cy_poor: 1, cb_cn: 1, nj_woman: 1, nj_student: 1, xz_stu1: 1, xz_stu2: 1, sh_farmer: 1, yc_boy: 1, yc_girl: 1 };
  allKeys.forEach(k => { key0 = k; calls++; runDialog(k, S0, 'random', rng, 0); });
}

/* ---------- 2.5 防刷校验：反复交谈不应无限获得心志 ---------- */
console.log('== 2.5 防刷校验（重复交谈是否仍会加心志）==');
(function () {
  const keys = Object.keys(D.dialogs);
  // 建立 对白 -> NPC id 映射（引擎只对 NPC 交谈计数；物件不计数）
  const dlgToNpc = {};
  Object.keys(D.maps).forEach((mid) => {
    (D.maps[mid].npcs || []).forEach((n) => { if (n.dialog) dlgToNpc[n.dialog] = n.id; });
  });
  keys.forEach((k) => {
    const S = baseState();
    S.talked = {};
    let lastGain = 0;
    for (let i = 0; i < 5; i++) {
      let gain = 0;
      const apply = (e) => {
        if (!e) return;
        if (e.stats) for (const s in e.stats) { S.stats[s] = (S.stats[s] || 0) + e.stats[s]; gain += e.stats[s]; }
        if (e.flag) S.flags[e.flag] = 1;
        if (e.item && S.items.indexOf(e.item) < 0) S.items.push(e.item);
      };
      const walkN = (lines, depth) => {
        if (depth > 12) return;
        for (const node of lines) {
          if (node.effect) apply(node.effect);
          if (node.choices) {
            let best = 0, bv = -1e9;
            node.choices.forEach((c, ci) => {
              const s = (c.effect && c.effect.stats) || {};
              const v = (s.ren || 0) + (s.zhen || 0) + (s.chuang || 0);
              if (v > bv) { bv = v; best = ci; }
            });
            const c = node.choices[best];
            if (c.effect) apply(c.effect);
            if (c.lines) walkN(c.lines, depth + 1);
          }
        }
      };
      // 与引擎一致：NPC 交谈计数 +1（物件不计数）
      if (dlgToNpc[k]) S.talked[dlgToNpc[k]] = (S.talked[dlgToNpc[k]] || 0) + 1;
      walkN(D.dialogs[k](S) || [], 0);
      lastGain = gain;
    }
    if (lastGain > 0) err(`对白 ${k} 在第 5 次交谈时仍可获得心志（+${lastGain}），存在重复刷取问题`);
  });
})();

/* ---------- 3. 自动通关模拟 ---------- */
console.log('== 3. 自动通关模拟 ==');
const VISIT = { exploredPortals: new Set() };

function simulate(policy, seed) {
  let st = 1234567 + seed * 7919;
  const r = () => { st = (st * 1103515245 + 12345) % 2147483648; return st / 2147483648; };

  S0 = baseState();
  S0.name = '小陶';
  const ended = { id: null };
  const visitedEnter = new Set();
  let guard = 0;

  function applyE(e) {
    let travel = null;
    if (e.stats) for (const k in e.stats) S0.stats[k] = (S0.stats[k] || 0) + e.stats[k];
    if (e.flag) S0.flags[e.flag] = 1;
    if (e.item && S0.items.indexOf(e.item) < 0) S0.items.push(e.item);
    if (e.objective) S0.objective = e.objective;
    if (e.card !== undefined && e.card !== null) S0.chapter = e.card;
    if (e.map) travel = e.map.to;
    if (e.ending) ended.id = 'ENDING';
    return travel;
  }

  function runLines(lines) {
    let travel = null;
    for (const node of lines) {
      if (node.effect) { const t = applyE(node.effect); if (t) travel = t; }
      if (node.choices) {
        let idx = 0;
        if (policy === 'random') idx = Math.floor(r() * node.choices.length);
        else if (policy === 'max') {
          let best = -1e9;
          node.choices.forEach((c, i) => {
            const s = (c.effect && c.effect.stats) || {};
            const v = (s.ren || 0) + (s.zhen || 0) + (s.chuang || 0);
            if (v > best) { best = v; idx = i; }
          });
        } else if (policy === 'last') idx = node.choices.length - 1;
        const c = node.choices[idx];
        if (c.effect) { const t = applyE(c.effect); if (t) travel = t; }
        if (c.lines) { const t = runLines(c.lines); if (t) travel = t; }
      }
    }
    return travel;
  }

  const sig = () => JSON.stringify([S0.flags, S0.items, S0.stats, S0.objective]);

  function playMap(id) {
    const m = D.maps[id];
    if (!m) { err(`模拟：地图不存在 ${id}`); return null; }
    S0.map = id;
    if (D.enter[id] && !visitedEnter.has('e' + id)) {
      visitedEnter.add('e' + id);
      const t = runLines(D.dialogs[D.enter[id]](S0) || []);
      if (t && t !== id) return t;
    }
    let progress = true, loops = 0;
    while (progress && loops++ < 120) {
      progress = false;
      const targets = [];
      (m.objects || []).forEach(o => { if (o.dialog) targets.push({ k: o.dialog }); });
      (m.npcs || []).forEach(n => { if (!n.condition || n.condition(S0)) targets.push({ k: n.dialog, id: n.id }); });
      for (const t0 of targets) {
        const before = sig();
        if (t0.id) S0.talked[t0.id] = (S0.talked[t0.id] || 0) + 1;   // 与引擎 talkTo 行为一致
        const t = runLines(D.dialogs[t0.k](S0) || []);
        if (t && t !== id) return t;
        if (sig() !== before) progress = true;
      }
    }
    return null;
  }

  let cur = 'library';
  let steps = 0;
  while (steps++ < 40 && !ended.id) {
    const travel = playMap(cur);
    if (travel) { cur = travel; continue; }
    // 探索尚未走过的传送门
    const m = D.maps[cur];
    const portal = (m.objects || []).find(o => o.portal && !VISIT.exploredPortals.has(cur + '->' + o.portal.to + seed));
    if (portal) {
      VISIT.exploredPortals.add(cur + '->' + portal.portal.to + seed);
      const t = playMap(portal.portal.to);
      if (t) { cur = t; } else { cur = cur; }
      continue;
    }
    break;
  }
  return { ended: !!ended.id, chapter: S0.chapter, stats: S0.stats, items: S0.items.length, map: cur };
}

const results = [];
for (let s = 0; s < 120; s++) {
  const policy = s < 60 ? 'random' : (s < 90 ? 'max' : 'last');
  const res = simulate(policy, s);
  results.push({ policy, ...res });
  if (!res.ended) err(`第 ${s} 次模拟（${policy}）未能抵达结局，卡在章节 ${res.chapter} / 地图 ${res.map}`);
}

const ok = results.filter(r => r.ended).length;
console.log(`   模拟 ${results.length} 次，通关 ${ok} 次`);
const stat = results.filter(r => r.ended).reduce((a, r) => {
  a.ren += r.stats.ren; a.zhen += r.stats.zhen; a.chuang += r.stats.chuang; a.items += r.items;
  return a;
}, { ren: 0, zhen: 0, chuang: 0, items: 0 });
const n = Math.max(1, ok);
console.log(`   平均心志：仁 ${(stat.ren / n).toFixed(1)} / 真 ${(stat.zhen / n).toFixed(1)} / 创 ${(stat.chuang / n).toFixed(1)}，平均收集 ${(stat.items / n).toFixed(1)} 件`);

/* ---------- 4. 收尾 ---------- */
console.log('== 4. 结论 ==');
if (warns.length) { console.log(`警告 ${warns.length} 条：`); [...new Set(warns)].forEach(w => console.log('  ⚠ ' + w)); }
if (errors.length) {
  console.log(`错误 ${errors.length} 条：`);
  [...new Set(errors)].slice(0, 60).forEach(e => console.log('  ✗ ' + e));
  process.exit(1);
} else {
  console.log(`✓ 全部校验通过（对白调用 ${calls} 次，地图 ${Object.keys(D.maps).length} 张，对白 ${allKeys.length} 段，章节 ${D.chapters.length} 章，结局 ${D.endings.length} 种）`);
}
