// ===================================================================
//  「档」本地存档管理（独立模块，四站通用）
//
//  - 在右侧悬浮条「槽」后面插入一个「档」按钮
//  - 点开是本地槽位存档列表：读取 / 删除（含缩略图与保存时间）
//  - 不修改 quickbar.js：只读取它写进 IndexedDB 的记录
//  - 站点差异（fc / gba / sfc / md 的键前缀）自动识别，四个站共用同一份文件
//
//  移除方式：删掉 emu/index.html 里引用本文件的 <script> 即可
// ===================================================================
(function () {
  'use strict';

  var DB_NAME = 'EmulatorJS-states';
  var STORE = 'states';
  var BTN_ID = 'qkSaveMgr';
  var PANEL_ID = 'saveMgrPanel';
  var STYLE_ID = 'saveMgrStyle';

  var panelEl = null;
  var listEl = null;
  var countEl = null;
  var rowsCache = [];

  // 键前缀（fc / gba / sfc / md）不写死：先看悬浮条 id，再从库里的键名推断
  var PREFIX = '';
  var prefixReady = null;

  // ---------- 小工具 ----------
  function fmtSize(n) {
    if (!n && n !== 0) return '—';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + 'M';
    if (n >= 1024) return (n / 1024).toFixed(0) + 'K';
    return n + 'B';
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function currentGame() {
    try {
      var c = (window.EJS_emulator && EJS_emulator.config) || {};
      return String(c.gameName || '');
    } catch (e) { return ''; }
  }
  function toast(text) {
    try {
      if (window.EJS_emulator && EJS_emulator.displayMessage) { EJS_emulator.displayMessage(text); return; }
    } catch (e) {}
    console.log('[存档管理] ' + text);
  }

  function openDB() {
    return new Promise(function (resolve) {
      var req;
      try { req = indexedDB.open(DB_NAME); } catch (e) { return resolve(null); }
      req.onsuccess = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) { db.close(); return resolve(null); }
        resolve(db);
      };
      req.onerror = function () { resolve(null); };
    });
  }

  // ---------- 前缀识别 ----------
  function detectFromDom() {
    try {
      var bar = document.querySelector('[id$="QuickBar"]');
      if (bar && bar.id && /QuickBar$/.test(bar.id)) {
        return bar.id.slice(0, -'QuickBar'.length);
      }
    } catch (e) {}
    return '';
  }
  function detectFromDb() {
    return openDB().then(function (db) {
      if (!db) return '';
      return new Promise(function (resolve) {
        var found = '';
        var tx = db.transaction([STORE], 'readonly');
        var cur = tx.objectStore(STORE).openCursor();
        cur.onsuccess = function (e) {
          var c = e.target.result;
          if (!c) { db.close(); resolve(found); return; }
          var m = /^(.+?)quick-(?:meta-.+|[^-]+-slot\d+)$/.exec(String(c.key));
          if (m) { found = m[1]; db.close(); resolve(found); return; }
          c.continue();
        };
        cur.onerror = function () { db.close(); resolve(''); };
      });
    });
  }
  function ensurePrefix() {
    if (PREFIX) return Promise.resolve(PREFIX);
    if (prefixReady) return prefixReady;
    var p = detectFromDom();
    if (p) { PREFIX = p; return Promise.resolve(p); }
    prefixReady = detectFromDb().then(function (x) { PREFIX = x || PREFIX; return PREFIX; });
    return prefixReady;
  }

  // ---------- 读本地存档 ----------
  function readAll() {
    return ensurePrefix().then(function (prefix) {
      if (!prefix) return [];
      return openDB().then(function (db) {
        if (!db) return [];
        return new Promise(function (resolve) {
          var states = {}, shots = {};
          var tx = db.transaction([STORE], 'readonly');
          var cur = tx.objectStore(STORE).openCursor();
          var reState = new RegExp('^' + prefix + 'quick-(.+)-slot(\\d+)$');
          var reShot = new RegExp('^' + prefix + 'shot-(.+)-slot(\\d+)$');
          cur.onsuccess = function (e) {
            var c = e.target.result;
            if (!c) return;
            var key = String(c.key);
            var m = reState.exec(key);
            if (m) {
              var v = c.value;
              states[m[1] + '#' + m[2]] = {
                game: m[1], slot: parseInt(m[2], 10),
                size: (v && v.byteLength) || (v && v.length) || 0
              };
            } else {
              var s = reShot.exec(key);
              if (s && typeof c.value === 'string') shots[s[1] + '#' + s[2]] = c.value;
            }
            c.continue();
          };
          tx.oncomplete = function () {
            var keys = Object.keys(states);
            var games = {};
            keys.forEach(function (k) { games[states[k].game] = true; });
            var names = Object.keys(games);
            if (!names.length) { db.close(); return resolve([]); }
            var metas = {}, pending = names.length;
            function done() {
              db.close();
              resolve(keys.map(function (k) {
                var it = states[k];
                var mm = metas[it.game] || {};
                it.time = mm[it.slot] || 0;
                it.shot = shots[k] || null;
                return it;
              }));
            }
            names.forEach(function (g) {
              openDB().then(function (db2) {
                if (!db2) { if (--pending === 0) done(); return; }
                var t2 = db2.transaction([STORE], 'readonly');
                var rq = t2.objectStore(STORE).get(prefix + 'quick-meta-' + g);
                rq.onsuccess = function () {
                  try { metas[g] = JSON.parse(rq.result) || {}; } catch (x) { metas[g] = {}; }
                  db2.close();
                  if (--pending === 0) done();
                };
                rq.onerror = function () { db2.close(); if (--pending === 0) done(); };
              });
            });
          };
          tx.onerror = function () { db.close(); resolve([]); };
        });
      });
    });
  }

  // ---------- 删除 ----------
  function deleteSave(game, slot) {
    return ensurePrefix().then(function (prefix) {
      return openDB().then(function (db) {
        if (!db) return false;
        return new Promise(function (resolve) {
          var tx = db.transaction([STORE], 'readwrite');
          var st = tx.objectStore(STORE);
          st.delete(prefix + 'quick-' + game + '-slot' + slot);
          st.delete(prefix + 'shot-' + game + '-slot' + slot);
          var metaKey = prefix + 'quick-meta-' + game;
          var g = st.get(metaKey);
          g.onsuccess = function () {
            var meta = {};
            try { meta = JSON.parse(g.result) || {}; } catch (e) {}
            if (meta[slot] !== undefined) {
              delete meta[slot];
              st.put(JSON.stringify(meta), metaKey);
            }
          };
          tx.oncomplete = function () { db.close(); resolve(true); };
          tx.onerror = function () { db.close(); resolve(false); };
        });
      });
    });
  }

  // ---------- 读取到模拟器 ----------
  function loadSave(row) {
    var gm = window.EJS_emulator && EJS_emulator.gameManager;
    if (!gm || !EJS_emulator.started) { toast('请先载入游戏'); return; }
    if (currentGame() !== row.game) {
      toast('当前运行的是《' + (currentGame() || '未载入') + '》，请先载入《' + row.game + '》');
      return;
    }
    ensurePrefix().then(function (prefix) {
      openDB().then(function (db) {
        if (!db) return;
        var tx = db.transaction([STORE], 'readonly');
        var rq = tx.objectStore(STORE).get(prefix + 'quick-' + row.game + '-slot' + row.slot);
        rq.onsuccess = function () {
          db.close();
          if (!rq.result) { toast('槽位 ' + row.slot + ' 没有存档'); return; }
          try {
            if (gm.clearEJSResetTimer) gm.clearEJSResetTimer();
            gm.loadState(rq.result);
            toast('已读取《' + row.game + '》槽位 ' + row.slot);
            closePanel();
          } catch (e) {
            toast('读取失败：' + (e && e.message ? e.message : e));
          }
        };
        rq.onerror = function () { db.close(); toast('读取失败'); };
      });
    });
  }

  // ---------- 面板样式 ----------
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
#saveMgrPanel { position:fixed; inset:0; display:none; z-index:10080; background:rgba(0,0,0,.5); }
#saveMgrPanel.sm-show { display:flex; align-items:center; justify-content:center; }
#saveMgrPanel .sm-card { width:560px; max-width:calc(100vw - 24px); max-height:calc(100vh - 60px); display:flex; flex-direction:column;
  background:rgba(14,20,30,.98); border:1px solid rgba(72,120,220,.45); border-radius:12px; padding:14px 16px;
  box-shadow:0 12px 40px rgba(0,0,0,.7); color:#e8eef5; font:13.5px/1.5 system-ui,-apple-system,"Microsoft YaHei",sans-serif; }
#saveMgrPanel h3 { margin:0 0 4px; font-size:16px; color:#8ab4ff; }
#saveMgrPanel .sm-hint { font-size:12px; color:#8b9bb3; margin-bottom:8px; }
#saveMgrPanel .sm-list { overflow-y:auto; flex:1 1 auto; min-height:80px; }
#saveMgrPanel .sm-game { margin:8px 0 4px; font-size:12.5px; color:#9fb4d0; }
#saveMgrPanel .sm-row { display:flex; align-items:center; gap:10px; padding:7px 6px; border-bottom:1px solid rgba(255,255,255,.06); }
#saveMgrPanel .sm-row:hover { background:rgba(255,255,255,.04); }
#saveMgrPanel .sm-shot { width:56px; height:42px; flex:0 0 auto; border-radius:4px; background:#0b1220; object-fit:cover; }
#saveMgrPanel .sm-meta { flex:1 1 auto; min-width:0; }
#saveMgrPanel .sm-slot { color:#e8eef5; font-weight:600; }
#saveMgrPanel .sm-time { color:#8b9bb3; font-size:12px; }
#saveMgrPanel .sm-btn { padding:4px 10px; border-radius:6px; border:none; cursor:pointer; font-size:12.5px; color:#fff; }
#saveMgrPanel .sm-load { background:#2e6bff; }
#saveMgrPanel .sm-load:disabled { background:#2a3a52; color:#7d8aa0; cursor:not-allowed; }
#saveMgrPanel .sm-del { background:#b3452e; }
#saveMgrPanel .sm-foot { display:flex; justify-content:space-between; align-items:center; margin-top:10px; }
#saveMgrPanel .sm-close { background:#2a3a52; }
#saveMgrPanel .sm-empty { padding:16px 4px; color:#8b9bb3; }
    `;
    document.head.appendChild(st);
  }

  // ---------- 渲染 ----------
  function render() {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!rowsCache.length) {
      var e = document.createElement('div');
      e.className = 'sm-empty';
      e.textContent = '本地还没有槽位存档。进游戏后按「存」或数字键 1 存一次就会出现在这里。';
      listEl.appendChild(e);
      countEl.textContent = '0 个存档';
      return;
    }
    var cur = currentGame();
    var games = [];
    rowsCache.forEach(function (r) { if (games.indexOf(r.game) < 0) games.push(r.game); });
    games.sort();
    var total = 0;
    games.forEach(function (g) {
      var head = document.createElement('div');
      head.className = 'sm-game';
      head.textContent = g + (g === cur ? '（当前游戏）' : '');
      listEl.appendChild(head);
      rowsCache.filter(function (r) { return r.game === g; })
        .sort(function (a, b) { return a.slot - b.slot; })
        .forEach(function (r) {
          total++;
          var row = document.createElement('div');
          row.className = 'sm-row';

          var img = document.createElement('img');
          img.className = 'sm-shot';
          if (r.shot) img.src = r.shot;
          row.appendChild(img);

          var meta = document.createElement('div');
          meta.className = 'sm-meta';
          var s1 = document.createElement('div');
          s1.className = 'sm-slot';
          s1.textContent = '槽位 ' + r.slot + ' · ' + fmtSize(r.size);
          var s2 = document.createElement('div');
          s2.className = 'sm-time';
          s2.textContent = fmtTime(r.time);
          meta.appendChild(s1);
          meta.appendChild(s2);
          row.appendChild(meta);

          var ld = document.createElement('button');
          ld.className = 'sm-btn sm-load';
          ld.textContent = '读取';
          var canLoad = !!cur && cur === r.game && window.EJS_emulator && EJS_emulator.started;
          if (!canLoad) {
            ld.disabled = true;
            ld.title = cur ? '先载入《' + r.game + '》再读取' : '请先载入游戏';
          } else {
            ld.addEventListener('click', function () { loadSave(r); });
          }
          row.appendChild(ld);

          var del = document.createElement('button');
          del.className = 'sm-btn sm-del';
          del.textContent = '删除';
          del.addEventListener('click', function () {
            if (!confirm('删除《' + r.game + '》槽位 ' + r.slot + ' 的本地存档？（含截图与保存时间，不可恢复）')) return;
            del.disabled = true;
            deleteSave(r.game, r.slot).then(function (ok) {
              toast(ok ? '已删除《' + r.game + '》槽位 ' + r.slot : '删除失败');
              refresh();
            });
          });
          row.appendChild(del);

          listEl.appendChild(row);
        });
    });
    countEl.textContent = total + ' 个存档';
  }

  function refresh() {
    return readAll().then(function (rows) {
      rowsCache = rows;
      render();
    });
  }

  // ---------- 面板 ----------
  function ensurePanel() {
    if (panelEl) return;
    ensureStyles();
    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.innerHTML =
      '<div class="sm-card">' +
      '<h3>本地存档</h3>' +
      '<div class="sm-hint">从浏览器 IndexedDB 读取（和悬浮条「存 / 读 / 槽」是同一份数据）</div>' +
      '<div class="sm-list"></div>' +
      '<div class="sm-foot"><span class="sm-hint" id="smCount">—</span>' +
      '<button class="sm-btn sm-close" type="button">关闭</button></div>' +
      '</div>';
    document.body.appendChild(panelEl);
    listEl = panelEl.querySelector('.sm-list');
    countEl = panelEl.querySelector('#smCount');
    panelEl.addEventListener('click', function (e) { if (e.target === panelEl) closePanel(); });
    panelEl.querySelector('.sm-close').addEventListener('click', closePanel);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panelEl && panelEl.classList.contains('sm-show')) closePanel();
    });
  }

  function openPanel() {
    ensurePanel();
    panelEl.classList.add('sm-show');
    ensurePrefix().then(refresh, refresh);
  }
  function closePanel() {
    if (panelEl) panelEl.classList.remove('sm-show');
  }

  // ---------- 插入「档」按钮 ----------
  function insertButton() {
    if (document.getElementById(BTN_ID)) return true;
    var slotBtn = document.getElementById('qkSlot');   // 四个站的按钮 id 都是 qkSlot
    if (!slotBtn || !slotBtn.parentNode) return false;
    var btn = document.createElement('div');
    btn.className = 'qk-btn';
    btn.id = BTN_ID;
    btn.title = '本地存档管理（列表 / 读取 / 删除）';
    btn.innerHTML = '<span class="qk-char">档</span>';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openPanel();
    });
    slotBtn.insertAdjacentElement('afterend', btn);
    return true;
  }

  function init() {
    if (insertButton()) { ensurePrefix(); return; }
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (insertButton()) { ensurePrefix(); clearInterval(t); return; }
      if (tries > 50) clearInterval(t);
    }, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.SaveMgr = { open: openPanel, close: closePanel, refresh: refresh };
})();
