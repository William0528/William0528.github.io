/* ===========================================================
 * 《行知·晓庄》游戏引擎
 * 纯原生 JS，无任何依赖，双击 index.html 即可运行
 * =========================================================== */
(function () {
  'use strict';

  var D = window.STORY;
  if (!D) { alert('剧情数据 story.js 未能加载。'); return; }

  /* ---------------- 常量 ---------------- */
  var SAVE_KEY = 'xingzhi-xiaozhuang.save.v1';
  var DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  var BLOCKED = '#T~HCSB=PGXDW'.split('');

  var TILES = {
    '#': { cls: 'wall' },
    '.': { cls: '' },
    ',': { cls: 'path' },
    'T': { cls: 'grass', ic: '🌳' },
    '~': { cls: 'water' },
    'H': { cls: 'room', ic: '🏠' },
    'C': { cls: 'wood', ic: '🪑' },
    'B': { cls: 'book', ic: '📚' },
    'S': { cls: 'stone', ic: '🗿' },
    '=': { cls: 'wood', ic: '🪵' },
    'P': { cls: 'grass', ic: '🪴' },
    'G': { cls: 'grass', ic: '🌾' },
    'D': { cls: 'wood', ic: '🚪' },
    'W': { cls: 'room', ic: '🪟' },
    'X': { cls: 'stone', ic: '⛩️' },
    'F': { cls: 'grass', ic: '🌸' }
  };

  /* ---------------- 运行时状态 ---------------- */
  var S = null;
  var curMap = null;
  var cols = 0, rows = 0;
  var moving = false;
  var held = null;
  var overlayOpen = false;
  var sfxOn = true;
  var actx = null;
  var npcEls = [], objEls = [], playerEl = null;
  var typing = null;
  var DQ = { stack: [], active: false, waitingChoice: false };

  /* ---------------- 小工具 ---------------- */
  function $(sel) { return document.querySelector(sel); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }

  function newState(name) {
    return {
      name: name || '小陶',
      chapter: 0,
      map: 'library',
      x: 8, y: 5, facing: 'down',
      stats: { ren: 1, zhen: 1, chuang: 1 },
      flags: {}, items: [], talked: {}, seen: {},
      objective: '　',
      startedAt: Date.now(),
      endingId: null
    };
  }

  /* ---------------- 音效（WebAudio 合成，无外部素材） ---------------- */
  function sfx(kind) {
    if (!sfxOn) return;
    try {
      if (!actx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        actx = new AC();
      }
      if (actx.state === 'suspended') actx.resume();
      var t0 = actx.currentTime;
      var notes = { tick: [1320, 0.03], blip: [660, 0.07], good: [660, 0.09, 880, 0.09, 1174, 0.16], chime: [784, 0.12, 988, 0.12, 1319, 0.34] }[kind] || [660, 0.06];
      var master = actx.createGain();
      master.gain.value = kind === 'tick' ? 0.025 : 0.07;
      master.connect(actx.destination);
      var when = 0;
      for (var i = 0; i < notes.length; i += 2) {
        var f = notes[i], dur = notes[i + 1];
        var o = actx.createOscillator();
        var g = actx.createGain();
        o.type = kind === 'tick' ? 'square' : 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0, t0 + when);
        g.gain.linearRampToValueAtTime(1, t0 + when + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0008, t0 + when + dur);
        o.connect(g); g.connect(master);
        o.start(t0 + when); o.stop(t0 + when + dur + 0.03);
        when += dur * 0.82;
      }
    } catch (e) { /* 静默失败 */ }
  }

  /* ---------------- 提示气泡 ---------------- */
  function toast(msg, cls) {
    var box = $('#toasts');
    var d = document.createElement('div');
    d.className = 'toast' + (cls ? ' ' + cls : '');
    d.textContent = msg;
    box.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 2400);
  }

  function toastStat(key, delta) {
    var nm = D.statShort[key] || key;
    toast((delta > 0 ? '+' + delta + ' ' : delta + ' ') + nm + '　' + (D.statNames[key] || ''), 'good');
    var nodes = document.querySelectorAll('#hud-stats .stat');
    var order = ['ren', 'zhen', 'chuang'];
    var idx = order.indexOf(key);
    if (nodes[idx]) {
      nodes[idx].classList.remove('up');
      void nodes[idx].offsetWidth;
      nodes[idx].classList.add('up');
    }
  }

  /* ---------------- 存档 ---------------- */
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, S: S, t: Date.now() })); } catch (e) {}
  }
  function readSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /* ---------------- HUD ---------------- */
  function updateHud() {
    var ch = D.chapters[S.chapter] || D.chapters[0];
    $('#hud-chapter').textContent = ch.no + ' · ' + ch.title;
    $('#hud-objective').textContent = S.objective || '　';
    var order = ['ren', 'zhen', 'chuang'];
    var html = '';
    for (var i = 0; i < order.length; i++) {
      var k = order[i];
      html += '<div class="stat"><b>' + (S.stats[k] || 0) + '</b><i>' + (D.statShort[k] || k) + '</i></div>';
    }
    $('#hud-stats').innerHTML = html;
    $('#map-name').textContent = curMap ? curMap.name : '';
  }

  /* ---------------- 地图构建 ---------------- */
  function normalizeMap(m) {
    var w = 0, i;
    for (i = 0; i < m.tiles.length; i++) w = Math.max(w, m.tiles[i].length);
    var out = [];
    for (i = 0; i < m.tiles.length; i++) {
      var row = m.tiles[i];
      while (row.length < w) row += '#';
      out.push(row);
    }
    m._tiles = out;
    m._w = w;
    m._h = out.length;
    return m;
  }

  function tileAt(x, y) {
    if (!curMap || x < 0 || y < 0 || x >= cols || y >= rows) return '#';
    return curMap._tiles[y][x];
  }

  function objectAt(x, y) {
    var list = curMap.objects || [];
    for (var i = 0; i < list.length; i++) if (list[i].x === x && list[i].y === y) return list[i];
    return null;
  }

  function npcAt(x, y) {
    var list = curMap.npcs || [];
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n.x === x && n.y === y && visible(n)) return n;
    }
    return null;
  }

  function visible(n) {
    return !n.condition || !!n.condition(S);
  }

  function isBlocked(x, y, ignoreNpc) {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return true;
    if (BLOCKED.indexOf(tileAt(x, y)) >= 0) return true;
    if (objectAt(x, y)) return true;
    if (!ignoreNpc && npcAt(x, y)) return true;
    return false;
  }

  function spriteEl(cls, emoji, label) {
    var d = document.createElement('div');
    d.className = 'sprite ' + cls;
    d.innerHTML = '<span class="mark">▼</span>' +
                  '<span class="body">' + emoji + '</span>' +
                  (label ? '<span class="tag">' + esc(label) + '</span>' : '');
    return d;
  }

  function place(el, x, y) {
    el.style.width = (100 / cols) + '%';
    el.style.height = (100 / rows) + '%';
    el.style.left = (x * 100 / cols) + '%';
    el.style.top = (y * 100 / rows) + '%';
  }

  function buildStage() {
    var stage = $('#stage');
    stage.innerHTML = '';
    cols = curMap._w;
    rows = curMap._h;
    stage.style.setProperty('--cols', cols);
    stage.style.setProperty('--rows', rows);

    var layer = document.createElement('div');
    layer.id = 'map-layer';
    layer.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    layer.style.gridTemplateRows = 'repeat(' + rows + ', 1fr)';
    var html = '';
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        var ch = curMap._tiles[y][x];
        var t = TILES[ch] || TILES['.'];
        html += '<div class="tile ' + t.cls + '">' +
                (t.ic ? '<span class="ic">' + t.ic + '</span>' : '') + '</div>';
      }
    }
    layer.innerHTML = html;
    stage.appendChild(layer);

    var sl = document.createElement('div');
    sl.id = 'sprite-layer';
    stage.appendChild(sl);

    refreshSprites();
  }

  function refreshSprites() {
    var sl = $('#sprite-layer');
    if (!sl) return;
    sl.innerHTML = '';
    npcEls = []; objEls = [];

    (curMap.objects || []).forEach(function (o) {
      var el = spriteEl('obj', o.emoji || '❓', o.name);
      place(el, o.x, o.y);
      sl.appendChild(el);
      objEls.push({ ref: o, el: el });
    });

    (curMap.npcs || []).forEach(function (n) {
      if (!visible(n)) return;
      var el = spriteEl('npc', n.emoji || '🧑', n.name);
      place(el, n.x, n.y);
      sl.appendChild(el);
      npcEls.push({ ref: n, el: el });
    });

    playerEl = spriteEl('player', '🧑‍🎓', S.name);
    place(playerEl, S.x, S.y);
    sl.appendChild(playerEl);

    updateMarks();
  }

  function interactTarget() {
    var d = DIRS[S.facing] || [0, 1];
    var cand = [[S.x + d[0], S.y + d[1]], [S.x, S.y]];
    for (var i = 0; i < cand.length; i++) {
      var x = cand[i][0], y = cand[i][1];
      var n = npcAt(x, y);
      if (n) return { kind: 'npc', ref: n, x: x, y: y };
      var o = objectAt(x, y);
      if (o) return { kind: 'obj', ref: o, x: x, y: y };
    }
    return null;
  }

  function updateMarks() {
    if (!playerEl) return;
    place(playerEl, S.x, S.y);
    var tgt = interactTarget();
    function mark(list, kind) {
      list.forEach(function (o) {
        var near = tgt && tgt.kind === kind && tgt.ref === o.ref;
        var dist = Math.abs(o.ref.x - S.x) + Math.abs(o.ref.y - S.y);
        o.el.classList.toggle('active', !!near);
        o.el.classList.toggle('near', dist <= 2);
      });
    }
    mark(objEls, 'obj');
    mark(npcEls, 'npc');
  }

  /* ---------------- 移动 ---------------- */
  function move(dir) {
    if (!DQ.active && !overlayOpen && !moving) {
      S.facing = dir;
      var d = DIRS[dir];
      var nx = S.x + d[0], ny = S.y + d[1];
      if (!isBlocked(nx, ny)) {
        S.x = nx; S.y = ny;
        moving = true;
        updateMarks();
        setTimeout(function () { moving = false; }, 105);
      } else {
        updateMarks();
      }
    }
  }

  function interact() {
    if (DQ.active || overlayOpen) return;
    var t = interactTarget();
    if (!t) { toast('这里没什么可看的。'); return; }
    if (t.kind === 'npc') {
      S.talked[t.ref.id] = (S.talked[t.ref.id] || 0) + 1;
      playDialog(resolve(t.ref.dialog));
    } else {
      useObject(t.ref);
    }
  }

  function useObject(o) {
    if (o.portal) {
      sfx('blip');
      closeDialogNow();
      enterMap(o.portal.to, o.portal.spawn);
      return;
    }
    if (o.dialog) { playDialog(resolve(o.dialog)); return; }
    toast(o.name + '：没有反应。');
  }

  /* ---------------- 对话 ---------------- */
  function resolve(keyOrLines) {
    if (keyOrLines == null) return [];
    if (Array.isArray(keyOrLines)) return keyOrLines;
    if (typeof keyOrLines === 'function') return keyOrLines(S) || [];
    var f = D.dialogs[keyOrLines];
    if (!f) { console.warn('缺少对白：', keyOrLines); return []; }
    return (typeof f === 'function' ? f(S) : f) || [];
  }

  function playDialog(lines) {
    if (!lines || !lines.length) return;
    DQ.stack.push({ lines: lines.slice(), i: 0 });
    if (!DQ.active) {
      DQ.active = true;
      $('#dialog').classList.remove('hidden');
      advanceDialog();
    }
  }

  function advanceDialog() {
    var guard = 0;
    while (DQ.stack.length && guard++ < 5000) {
      var f = DQ.stack[DQ.stack.length - 1];
      if (f.i < f.lines.length) {
        var node = f.lines[f.i++];
        var r = node.effect ? applyEffect(node.effect) : null;
        if (r === 'stop') return;
        if (!node.text && !node.choices && !node.head) continue;
        renderNode(node);
        return;
      }
      DQ.stack.pop();
    }
    closeDialogNow();
    refreshSprites();
    save();
  }

  function renderNode(node) {
    var whoEl = $('#dlg-who'), textEl = $('#dlg-text'),
        chEl = $('#dlg-choices'), moreEl = $('#dlg-more');

    chEl.classList.add('hidden');
    chEl.innerHTML = '';
    moreEl.classList.add('hidden');

    var who = node.who || '';
    if (!who || who === '旁白') {
      whoEl.classList.add('hidden');
      textEl.classList.add('narrator');
    } else {
      whoEl.textContent = who;
      whoEl.classList.remove('hidden');
      whoEl.classList.toggle('narrator', who === '系统');
      textEl.classList.remove('narrator');
    }

    if (typing && typing.timer) clearTimeout(typing.timer);
    typing = { full: String(node.text || ''), el: textEl, i: 0, done: false, node: node, timer: null };
    textEl.textContent = '';
    sfx('blip');
    typeTick();
  }

  function typeTick() {
    if (!typing) return;
    var t = typing;
    if (t.i >= t.full.length) {
      t.done = true;
      typing = null;
      onTyped(t.node);
      return;
    }
    t.i += 2;
    t.el.textContent = t.full.slice(0, t.i);
    t.timer = setTimeout(typeTick, 26);
  }

  function finishTyping() {
    if (!typing) return;
    if (typing.timer) clearTimeout(typing.timer);
    var node = typing.node;
    typing.el.textContent = typing.full;
    typing = null;
    onTyped(node);
  }

  function onTyped(node) {
    if (node.choices && node.choices.length) {
      showChoices(node);
    } else {
      $('#dlg-more').classList.remove('hidden');
    }
  }

  function showChoices(node) {
    DQ.waitingChoice = true;
    var box = $('#dlg-choices');
    box.innerHTML = '';
    box.classList.remove('hidden');
    if (node.head) {
      var h = document.createElement('div');
      h.className = 'quiz-head';
      h.textContent = node.head;
      box.appendChild(h);
    }
    node.choices.forEach(function (c, idx) {
      var b = document.createElement('button');
      b.className = 'choice' + (node.quiz ? ' quiz-q' : '');
      b.innerHTML = '<span class="key">' + (node.quiz ? 'ABCD'[idx] || '·' : '·') + '</span>' + esc(c.text);
      b.addEventListener('click', function (ev) { ev.stopPropagation(); pickChoice(c); });
      box.appendChild(b);
    });
    $('#dlg-more').classList.add('hidden');
  }

  function pickChoice(c) {
    if (!DQ.waitingChoice) return;
    DQ.waitingChoice = false;
    $('#dlg-choices').classList.add('hidden');
    sfx('blip');
    var r = c.effect ? applyEffect(c.effect) : null;
    if (r === 'stop') return;
    if (c.lines && c.lines.length) DQ.stack.push({ lines: c.lines.slice(), i: 0 });
    advanceDialog();
  }

  function advance() {
    if (!DQ.active || DQ.waitingChoice) return;
    if (typing) { finishTyping(); return; }
    advanceDialog();
  }

  function closeDialogNow() {
    if (typing && typing.timer) clearTimeout(typing.timer);
    typing = null;
    DQ.stack = [];
    DQ.active = false;
    DQ.waitingChoice = false;
    $('#dialog').classList.add('hidden');
    $('#dlg-choices').classList.add('hidden');
    $('#dlg-choices').innerHTML = '';
  }

  /* ---------------- 效果 ---------------- */
  function applyEffect(e) {
    if (!e) return null;

    var changed = [];
    if (e.stats) {
      for (var k in e.stats) {
        if (!e.stats.hasOwnProperty(k)) continue;
        S.stats[k] = (S.stats[k] || 0) + e.stats[k];
        changed.push([k, e.stats[k]]);
      }
    }
    if (e.flag) S.flags[e.flag] = 1;
    if (e.item && S.items.indexOf(e.item) < 0) {
      S.items.push(e.item);
      toast('收入行知书卷 · ' + e.item, 'item');
      sfx('chime');
    } else if (e.item) {
      sfx('chime');
    }
    if (e.objective) {
      S.objective = e.objective;
    }
    if (e.sfx) sfx(e.sfx);
    updateHud();
    for (var i = 0; i < changed.length; i++) toastStat(changed[i][0], changed[i][1]);
    if (e.objective) toast('目标：' + e.objective);

    var hasCard = (e.card !== undefined && e.card !== null);

    if (e.map) {
      var dest = e.map;
      closeDialogNow();
      if (hasCard) {
        enterMap(dest.to, dest.spawn, { silent: true });
        showChapterCard(e.card, function () { maybeEnterDialog(dest.to); });
      } else {
        closeDialogNow();
        setTimeout(function () { enterMap(dest.to, dest.spawn); }, 360);
      }
      return 'stop';
    }
    if (hasCard) { showChapterCard(e.card, null); }
    if (e.ending) {
      closeDialogNow();
      showEnding();
      return 'stop';
    }
    return null;
  }

  /* ---------------- 地图切换 ---------------- */
  function enterMap(id, spawn, opts) {
    opts = opts || {};
    var m = D.maps[id];
    if (!m) { console.warn('缺少地图：', id); return; }
    curMap = normalizeMap(m);
    S.map = id;
    var sp = spawn || m.spawn;
    S.x = sp[0]; S.y = sp[1];
    S.facing = 'down';
    buildStage();
    updateHud();
    if (!opts.silent) maybeEnterDialog(id);
    save();
  }

  function maybeEnterDialog(id) {
    var key = D.enter[id];
    if (!key || S.seen['enter_' + id]) return;
    S.seen['enter_' + id] = 1;
    setTimeout(function () {
      if (DQ.active || overlayOpen) { setTimeout(function () { playDialog(resolve(key)); }, 400); return; }
      playDialog(resolve(key));
    }, 320);
  }

  /* ---------------- 覆盖层 ---------------- */
  function ovOpen(html) {
    overlayOpen = true;
    held = null;
    $('#overlay-box').innerHTML = html;
    $('#overlay').classList.remove('hidden');
  }
  function ovClose() {
    overlayOpen = false;
    $('#overlay').classList.add('hidden');
    $('#overlay-box').innerHTML = '';
  }

  function sealHtml(text) {
    var s = String(text).replace(/\s/g, '');
    var out;
    if (s.length >= 4) out = s.slice(0, 2) + '<br>' + s.slice(2, 4);
    else out = s.split('').join('<br>');
    return '<span>' + out + '</span>';
  }

  function showChapterCard(idx, onClose) {
    var ch = D.chapters[idx];
    if (!ch) { if (onClose) onClose(); return; }
    S.chapter = idx;
    updateHud();
    ovOpen(
      '<div class="chapter-card">' +
        '<div class="seal">' + sealHtml('行知') + '</div>' +
        '<div class="no">' + esc(ch.no) + '</div>' +
        '<h2>' + esc(ch.title) + '</h2>' +
        '<div class="yr">' + esc(ch.yr) + '</div>' +
        '<div class="desc">' + nl2br(ch.desc) + '</div>' +
        '<div class="quote">' + esc(ch.quote) + '</div>' +
        '<div class="ov-actions"><button class="btn btn-main" id="ov-next">继　续</button></div>' +
      '</div>'
    );
    sfx('good');
    $('#ov-next').addEventListener('click', function () {
      ovClose();
      if (onClose) onClose();
    });
  }

  function showEnding() {
    var e = null, i;
    for (i = 0; i < D.endings.length; i++) {
      if (D.endings[i].cond(S)) { e = D.endings[i]; break; }
    }
    if (!e) e = D.endings[D.endings.length - 1];
    S.endingId = e.id;
    save();

    var body = '<div class="ov-text">';
    for (i = 0; i < e.lines.length; i++) body += '<p>' + esc(e.lines[i]) + '</p>';
    body += '</div>';

    ovOpen(
      '<div class="ending-seal"><div class="seal">' + sealHtml(e.seal) + '</div></div>' +
      '<h3 class="ov-title">结　局 · ' + esc(e.label) + '</h3>' +
      '<p class="ov-sub">陶行知先生诞辰 135 周年</p>' +
      body +
      '<div class="ending-stats">' +
        '<div><b>' + (S.stats.ren || 0) + '</b><i>仁 · 爱满天下</i></div>' +
        '<div><b>' + (S.stats.zhen || 0) + '</b><i>真 · 教人求真</i></div>' +
        '<div><b>' + (S.stats.chuang || 0) + '</b><i>创 · 创造之始</i></div>' +
      '</div>' +
      '<p class="ov-text" style="text-align:center">行知书卷收集：' + S.items.length + ' / ' + Object.keys(D.relics).length + '</p>' +
      '<div class="ov-actions">' +
        '<button class="btn btn-main" id="ov-again">再走一遍这条路</button>' +
        '<button class="btn" id="ov-scrolls">翻看行知书卷</button>' +
        '<button class="btn" id="ov-home">回到标题</button>' +
      '</div>'
    );
    sfx('chime');
    $('#ov-again').addEventListener('click', function () { ovClose(); gotoTitle(); });
    $('#ov-scrolls').addEventListener('click', function () { showRelics(); });
    $('#ov-home').addEventListener('click', function () { ovClose(); gotoTitle(); });
  }

  function showRelics() {
    var keys = Object.keys(D.relics);
    var html = '<h3 class="ov-title">行 知 书 卷</h3>' +
               '<p class="ov-sub">已收集 ' + S.items.length + ' / ' + keys.length + '</p>' +
               '<ul class="scroll-list">';
    var got = 0;
    keys.forEach(function (k) {
      if (S.items.indexOf(k) >= 0) {
        got++;
        html += '<li><span class="em">' + (D.relics[k].em || '📜') + '</span><span><b>' + esc(k) + '</b><br>' + esc(D.relics[k].desc) + '</span></li>';
      }
    });
    if (!got) html += '<li class="empty">还没有收集到任何信物。走进故事里，它们会自己找上你。</li>';
    html += '</ul><div class="ov-actions"><button class="btn btn-main" id="ov-back">返　回</button></div>';
    ovOpen(html);
    $('#ov-back').addEventListener('click', function () { ovClose(); if (DQ.active) { /* 回到对话 */ } });
  }

  function showHowto() {
    var html = '<h3 class="ov-title">玩 法 说 明</h3><p class="ov-sub">行知 · 晓庄</p><div class="ov-text">';
    D.howto.forEach(function (l) { html += '<p>' + esc(l) + '</p>'; });
    html += '</div><div class="ov-actions"><button class="btn btn-main" id="ov-back">明白了</button></div>';
    ovOpen(html);
    $('#ov-back').addEventListener('click', ovClose);
  }

  function toggleMenu() {
    if (overlayOpen) { ovClose(); return; }
    var saved = readSave();
    ovOpen(
      '<h3 class="ov-title">行 知 · 晓 庄</h3>' +
      '<p class="ov-sub">' + esc(S.name) + '　|　' + esc((D.chapters[S.chapter] || {}).no || '') + '</p>' +
      '<div class="ov-actions">' +
        '<button class="btn btn-main" id="m-resume">继续游戏</button>' +
        '<button class="btn" id="m-save">保存进度</button>' +
        '<button class="btn" id="m-load"' + (saved ? '' : ' disabled') + '>读取进度</button>' +
        '<button class="btn" id="m-relics">行知书卷（' + S.items.length + '）</button>' +
        '<button class="btn" id="m-how">玩法说明</button>' +
        '<button class="btn" id="m-sfx">音效：' + (sfxOn ? '开' : '关') + '</button>' +
        '<button class="btn" id="m-title">回到标题</button>' +
      '</div>'
    );
    $('#m-resume').addEventListener('click', ovClose);
    $('#m-save').addEventListener('click', function () { save(); toast('进度已保存'); sfx('good'); });
    $('#m-load').addEventListener('click', function () {
      var d = readSave();
      if (!d) { toast('没有找到存档'); return; }
      S = d.S;
      ovClose();
      $('#title').classList.remove('active');
      $('#game').classList.add('active');
      enterMap(S.map, [S.x, S.y], { silent: true });
      maybeEnterDialog(S.map);
      toast('已读取进度');
    });
    $('#m-relics').addEventListener('click', showRelics);
    $('#m-how').addEventListener('click', showHowto);
    $('#m-sfx').addEventListener('click', function () {
      sfxOn = !sfxOn;
      if (sfxOn) sfx('good');
      toggleMenu();
      toggleMenu();
    });
    $('#m-title').addEventListener('click', function () { ovClose(); gotoTitle(); });
  }

  /* ---------------- 流程 ---------------- */
  function petals() {
    var box = document.querySelector('.petals');
    if (!box) return;
    var n = 16;
    for (var i = 0; i < n; i++) {
      var p = document.createElement('div');
      p.className = 'petal';
      p.style.left = (Math.random() * 100) + '%';
      p.style.animationDuration = (9 + Math.random() * 10) + 's';
      p.style.animationDelay = (-Math.random() * 14) + 's';
      var s = 6 + Math.random() * 9;
      p.style.width = s + 'px';
      p.style.height = s + 'px';
      p.style.opacity = (0.35 + Math.random() * 0.5).toFixed(2);
      box.appendChild(p);
    }
  }

  function startGame(name) {
    S = newState(name);
    $('#title').classList.remove('active');
    $('#game').classList.add('active');
    ovClose();
    enterMap('library');
  }

  function continueGame() {
    var d = readSave();
    if (!d || !d.S) { toast('没有找到存档'); return; }
    S = d.S;
    if (!S.stats) S.stats = { ren: 1, zhen: 1, chuang: 1 };
    $('#title').classList.remove('active');
    $('#game').classList.add('active');
    ovClose();
    enterMap(S.map || 'library', [S.x, S.y], { silent: true });
    maybeEnterDialog(S.map || 'library');
    toast('继续你的旅程');
  }

  function gotoTitle() {
    closeDialogNow();
    ovClose();
    $('#game').classList.remove('active');
    $('#title').classList.add('active');
    refreshContinueBtn();
  }

  function refreshContinueBtn() {
    var b = $('#btn-continue');
    if (!b) return;
    var d = readSave();
    if (d && d.S) {
      b.disabled = false;
      b.textContent = '继续上次的旅程（' + (d.S.name || '小陶') + ' · ' + ((D.chapters[d.S.chapter] || {}).no || '') + '）';
    } else {
      b.disabled = true;
      b.textContent = '继续上次的旅程（暂无存档）';
    }
  }

  /* ---------------- 输入 ---------------- */
  function bindInput() {
    window.addEventListener('keydown', function (ev) {
      var k = ev.key;

      if (overlayOpen) {
        if (k === 'Enter' || k === ' ' || k === 'Escape') {
          ev.preventDefault();
          var btn = document.querySelector('#overlay-box .btn-main') || document.querySelector('#overlay-box .btn');
          if (btn) btn.click();
        }
        return;
      }

      if (k === ' ' || k === 'Enter') { ev.preventDefault(); advance(); return; }
      if (k === 'Escape') { ev.preventDefault(); toggleMenu(); return; }
      if (k === 'e' || k === 'E' || k === 'f' || k === 'F') { ev.preventDefault(); interact(); return; }

      var dir = null;
      if (k === 'ArrowUp' || k === 'w' || k === 'W') dir = 'up';
      else if (k === 'ArrowDown' || k === 's' || k === 'S') dir = 'down';
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A') dir = 'left';
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') dir = 'right';
      if (dir) {
        ev.preventDefault();
        if (ev.repeat) return;
        held = dir;
        move(dir);
      }
    });

    window.addEventListener('keyup', function (ev) {
      var k = ev.key, dir = null;
      if (k === 'ArrowUp' || k === 'w' || k === 'W') dir = 'up';
      else if (k === 'ArrowDown' || k === 's' || k === 'S') dir = 'down';
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A') dir = 'left';
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') dir = 'right';
      if (dir && held === dir) held = null;
    });

    setInterval(function () {
      if (held && !DQ.active && !overlayOpen && !moving) move(held);
    }, 150);

    document.querySelectorAll('#pad .pad-btn').forEach(function (b) {
      var fire = function (ev) {
        ev.preventDefault();
        if (b.dataset.act === 'act') interact();
        else move(b.dataset.dir);
      };
      b.addEventListener('click', fire);
      b.addEventListener('touchstart', fire, { passive: false });
    });

    $('#dlg-panel').addEventListener('click', function () { advance(); });
    $('#btn-menu').addEventListener('click', toggleMenu);
  }

  /* ---------------- boot ---------------- */
  function boot() {
    petals();
    refreshContinueBtn();

    $('#btn-new').addEventListener('click', function () {
      var v = ($('#inp-name').value || '').trim();
      if (!v) v = '小陶';
      startGame(v);
    });
    $('#btn-continue').addEventListener('click', continueGame);
    $('#btn-how').addEventListener('click', showHowto);

    $('#inp-name').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); $('#btn-new').click(); }
    });

    bindInput();
  }

  window.Game = { boot: boot, state: function () { return S; } };
})();
