// sidebar.js — 左侧功能悬浮条框架（按 mapper 注册的游戏增强功能）
// 用法：在 emu/js/sidebar/<game>.js 里调用
//   Sidebar.register({ id:'ct2-music', mappers:[74,195,198], buttons:[{id:'music',label:'音',title:'...',onClick:fn}] })
// 框架负责：样式、mapper 检测、只在匹配的 mapper 上显示、折叠/展开。
// 与右侧 quickbar.js 相互独立，互不影响。
(function () {
  'use strict';

  var STYLE_ID = 'ejs-sidebar-style';
  var COLLAPSE_KEY = 'ejs-sidebar-collapsed';
  var CSS = `
  #ejsSidebar{position:fixed;left:6px;top:50%;transform:translateY(-50%);display:none;flex-direction:column;gap:8px;
    padding:4px;box-sizing:border-box;z-index:10060;max-height:calc(100vh - 88px);overflow-y:auto;overscroll-behavior:contain;
    user-select:none;-webkit-user-select:none}
  #ejsSidebar .sb-btn{width:46px;height:46px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;
    background:rgba(16,22,32,.72);border:1px solid rgba(255,255,255,.32);border-radius:10px;color:#fff;cursor:pointer;
    box-shadow:0 4px 16px rgba(0,0,0,.36);transition:background .15s ease,transform .08s ease;touch-action:manipulation;
    -webkit-tap-highlight-color:transparent}
  #ejsSidebar .sb-btn:hover{background:rgba(60,74,96,.85)}
  #ejsSidebar .sb-btn:active{transform:scale(.94)}
  #ejsSidebar .sb-btn.sb-on{background:rgba(255,152,0,.88);border-color:#ff9800;color:#1b1b1b}
  #ejsSidebar .sb-char{font-size:15px;font-weight:700;line-height:1;pointer-events:none}
  #ejsSidebar .sb-sub{font-size:11px;font-weight:700;line-height:1;color:#ffd54a;margin-top:3px;pointer-events:none}
  #ejsSidebar .sb-btn.sb-on .sb-sub{color:#1b1b1b}
  #ejsSidebar .sb-sep{height:1px;background:rgba(255,255,255,.18);margin:2px 4px}
  #ejsSidebar .sb-collapse{background:rgba(30,40,56,.9);border-color:rgba(255,255,255,.22)}
  /* 手机/横屏：像右侧 quickbar 一样变成横向一排（左上角） */
  #ejsSidebar.sb-horizontal{left:6px;top:8px;transform:none;flex-direction:row;
    max-width:calc(100vw - 72px);max-height:none;overflow-x:auto;overflow-y:visible;padding:2px;
    -webkit-overflow-scrolling:touch}
  #ejsSidebarToggle{position:fixed;left:10px;top:52px;width:46px;height:46px;display:none;
    align-items:center;justify-content:center;background:rgba(16,22,32,.72);border:1px solid rgba(255,255,255,.32);
    border-radius:10px;color:#fff;font-size:16px;font-weight:700;cursor:pointer;z-index:10060;
    box-shadow:0 4px 16px rgba(0,0,0,.36);user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
  #ejsSidebarToggle:active{transform:scale(.94)}
  /* 桌面端：和右侧「档」一样垂直居中（右侧档是 top:50% + translateY(-50%)），左右对称 */
  #ejsSidebarToggle.sb-vcenter{left:6px;top:50%;transform:translateY(-50%)}
  @media (orientation: landscape){#ejsSidebarToggle{top:50px}}
  #ejsSidePanel{position:fixed;left:64px;top:50%;transform:translateY(-50%);width:230px;max-height:60vh;overflow:auto;
    background:rgba(12,16,24,.94);border:1px solid rgba(255,255,255,.22);border-radius:10px;color:#fff;z-index:10061;
    display:none;padding:8px;box-sizing:border-box;box-shadow:0 8px 28px rgba(0,0,0,.5);font:13px/1.5 system-ui,sans-serif}
  #ejsSidePanel .sbp-title{font-weight:700;margin:2px 4px 8px;color:#ffd54a}
  #ejsSidePanel .sbp-item{padding:6px 8px;border-radius:6px;cursor:pointer;display:flex;gap:8px;align-items:center}
  #ejsSidePanel .sbp-item:hover{background:rgba(255,255,255,.12)}
  #ejsSidePanel .sbp-item.sbp-cur{background:rgba(255,152,0,.25)}
  #ejsSidePanel .sbp-code{font-family:monospace;color:#7cc7ff;min-width:30px}
  #ejsSidePanel .sbp-note{color:#ddd;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  `;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  var modules = [];
  var barEl = null;
  var toggleEl = null;
  var panelEl = null;
  var currentMapper = null;
  var started = false;

  function log(m) { try { console.log('[Sidebar] ' + m); } catch (e) {} }

  // ---- iNES 头解析：只取 mapper，不需要完整 ROM ----
  function parseMapper(bytes) {
    if (!bytes || bytes.length < 16) return null;
    if (bytes[0] !== 0x4E || bytes[1] !== 0x45 || bytes[2] !== 0x53 || bytes[3] !== 0x1A) return null;
    var lo = (bytes[6] >> 4) & 0x0F;
    var hi = bytes[7] & 0xF0;
    return lo | hi;
  }

  function noteRomHeader(file) {
    if (!file || !file.size || file.size < 16) return;
    try {
      file.slice(0, 16).arrayBuffer().then(function (buf) {
        var m = parseMapper(new Uint8Array(buf));
        if (m !== null) {
          window.__romHeaderMapper = m;
          log('rom header mapper = ' + m);
          if (started && currentMapper === null) { currentMapper = m; show(); }
        }
      }).catch(function () {});
    } catch (e) {}
  }

  // 站点所有加载方式最终都会 URL.createObjectURL(file)：文件选择、缓存列表(IndexedDB→File) 都走这里。
  // 在这里顺手抓 16 字节头，比事后猜 gameUrl 可靠。
  (function hookObjectUrl() {
    if (window.__ejsSidebarUrlHooked) return;
    window.__ejsSidebarUrlHooked = true;
    var orig = URL.createObjectURL;
    if (!orig) return;
    URL.createObjectURL = function (obj) {
      try { if (obj && obj.size >= 16) noteRomHeader(obj); } catch (e) {}
      return orig.apply(URL, arguments);
    };
  })();

  function readHeaderFromUrl(url) {
    if (!url) return Promise.resolve(null);
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      return parseMapper(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)));
    });
  }

  function detectMapper() {
    // 优先用加载 ROM 时抓到的头（缓存/本地文件都能抓到）
    if (window.__romHeaderMapper !== undefined && window.__romHeaderMapper !== null) {
      return Promise.resolve(window.__romHeaderMapper);
    }
    var e = window.EJS_emulator;
    var urls = [];
    try {
      var c = (e && e.config) || {};
      [c.gameUrl, c.gameURL, c.url, e && e.gameUrl, window.EJS_gameUrl].forEach(function (u) {
        if (typeof u === 'string' && u && urls.indexOf(u) === -1) urls.push(u);
      });
    } catch (err) {}
    var i = 0;
    function next() {
      if (i >= urls.length) return Promise.resolve(null);
      var u = urls[i++];
      return readHeaderFromUrl(u).catch(function () { return next(); });
    }
    return next().then(function (m) {
      if (m !== null) return m;
      try {
        var f = document.querySelector('#romInput') && document.querySelector('#romInput').files[0];
        if (f && f.size >= 16) {
          return f.slice(0, 16).arrayBuffer().then(function (b) { return parseMapper(new Uint8Array(b)); });
        }
      } catch (e) {}
      return null;
    });
  }

  // ---------- 折叠/展开 ----------
  function isMobileLayout() { return Math.min(window.innerWidth, window.innerHeight) <= 768; }

  function applyLayout() {
    if (!barEl) return;
    if (toggleEl) toggleEl.style.display = 'none';
    barEl.style.display = 'none';
    var collapsed;
    try { collapsed = localStorage.getItem(COLLAPSE_KEY); } catch (e) { collapsed = null; }
    if (collapsed === null || collapsed === undefined) collapsed = isMobileLayout() ? '1' : '0'; // 手机默认折叠
    var isCollapsed = collapsed === '1';
    barEl.classList.toggle('sb-horizontal', isMobileLayout());
    if (toggleEl) toggleEl.classList.toggle('sb-vcenter', !isMobileLayout());
    barEl.style.display = isCollapsed ? 'none' : 'flex';
    if (toggleEl) toggleEl.style.display = isCollapsed ? 'flex' : 'none';
    if (isCollapsed && panelEl) panelEl.style.display = 'none';
  }

  function setCollapsed(v) {
    try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch (e) {}
    applyLayout();
  }

  function ensureToggle() {
    if (toggleEl) return toggleEl;
    toggleEl = document.createElement('div');
    toggleEl.id = 'ejsSidebarToggle';
    toggleEl.title = '展开左侧功能按钮';
    toggleEl.textContent = 'EX';
    toggleEl.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      setCollapsed(false);
    });
    document.body.appendChild(toggleEl);
    return toggleEl;
  }

  function buildBar(mods) {
    if (barEl) return;
    barEl = document.createElement('div');
    barEl.id = 'ejsSidebar';

    // 收起按钮（框架自带，永远第一个）
    var collapse = document.createElement('div');
    collapse.className = 'sb-btn sb-collapse';
    collapse.id = 'sb-collapse';
    collapse.title = '收起左侧按钮';
    collapse.innerHTML = '<span class="sb-char">收</span>';
    collapse.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      setCollapsed(true);
    });
    barEl.appendChild(collapse);

    mods.forEach(function (mod, mi) {
      if (mi > 0) {
        var sep = document.createElement('div');
        sep.className = 'sb-sep';
        barEl.appendChild(sep);
      }
      (mod.buttons || []).forEach(function (b) {
        var el = document.createElement('div');
        el.className = 'sb-btn';
        el.id = 'sb-' + mod.id + '-' + b.id;
        el.title = b.title || '';
        el.innerHTML = '<span class="sb-char"></span>' + (b.sub ? '<span class="sb-sub"></span>' : '');
        el.querySelector('.sb-char').textContent = b.label || '·';
        if (b.sub) el.querySelector('.sb-sub').textContent = b.sub;
        el.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          try { b.onClick && b.onClick(el); } catch (e) { console.error(e); }
        });
        b._el = el;
        barEl.appendChild(el);
      });
      mod._bar = barEl;
    });
    document.body.appendChild(barEl);
    ensureToggle();
  }

  function ensurePanel() {
    if (panelEl) return panelEl;
    panelEl = document.createElement('div');
    panelEl.id = 'ejsSidePanel';
    document.body.appendChild(panelEl);
    return panelEl;
  }

  var api = {
    register: function (mod) {
      if (!mod || !mod.id) return;
      modules.push(mod);
      if (started && currentMapper !== null && matches(mod, currentMapper)) show();
    },
    setLabel: function (modId, btnId, sub) {
      var el = document.getElementById('sb-' + modId + '-' + btnId);
      var s = el && el.querySelector('.sb-sub');
      if (s) s.textContent = sub;
      else if (el) el.querySelector('.sb-char').textContent = sub;
    },
    setOn: function (modId, btnId, on) {
      var el = document.getElementById('sb-' + modId + '-' + btnId);
      if (el) el.classList.toggle('sb-on', !!on);
    },
    openPanel: function (titleHtml, items, onPick) {
      var p = ensurePanel();
      p.innerHTML = '';
      var t = document.createElement('div');
      t.className = 'sbp-title';
      t.innerHTML = titleHtml;
      p.appendChild(t);
      (items || []).forEach(function (it) {
        var row = document.createElement('div');
        row.className = 'sbp-item' + (it.current ? ' sbp-cur' : '');
        row.innerHTML = '<span class="sbp-code"></span><span class="sbp-note"></span>';
        row.querySelector('.sbp-code').textContent = it.code || '';
        row.querySelector('.sbp-note').textContent = it.note || '';
        row.addEventListener('click', function () { onPick && onPick(it); });
        p.appendChild(row);
      });
      p.style.display = 'block';
      return p;
    },
    closePanel: function () {
      if (panelEl) panelEl.style.display = 'none';
    },
    collapse: function (v) { setCollapsed(v !== false); },
    isCollapsed: function () {
      try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (e) { return false; }
    },
    getMapper: function () { return currentMapper; },
    isStarted: function () { return started; }
  };

  function matches(mod, mapper) {
    if (!mod.mappers) return true;
    return mod.mappers.indexOf(mapper) !== -1;
  }

  function show() {
    injectStyle();
    var mods = modules.filter(function (m) { return matches(m, currentMapper); });
    if (!mods.length) return;
    if (!barEl) buildBar(mods);
    ensureToggle();
    applyLayout();
    mods.forEach(function (m) { try { m.onShow && m.onShow(); } catch (e) { console.error(e); } });
  }

  function hide() {
    if (barEl) barEl.style.display = 'none';
    if (toggleEl) toggleEl.style.display = 'none';
    if (panelEl) panelEl.style.display = 'none';
    modules.forEach(function (m) { try { m.onHide && m.onHide(); } catch (e) {} });
  }

  function tick() {
    var e = window.EJS_emulator;
    if (e && e.started) {
      started = true;
      clearInterval(timer);
      detectMapper().then(function (m) {
        currentMapper = (m === null ? null : m);
        log('mapper = ' + m);
        if (m !== null) show();
        modules.forEach(function (mod) { try { mod.onStart && mod.onStart(m); } catch (err) { console.error(err); } });
      });
      return;
    }
    if (!e && started) { started = false; }
  }

  injectStyle();
  window.Sidebar = api;

  // 兜底：站点文件选择路径
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t || t.id !== 'romInput' || !t.files || !t.files[0]) return;
    noteRomHeader(t.files[0]);
  }, true);

  window.__romHeaderMapper = window.__romHeaderMapper === undefined ? null : window.__romHeaderMapper;

  window.addEventListener('resize', function () { if (barEl) applyLayout(); });
  window.addEventListener('orientationchange', function () { if (barEl) applyLayout(); });

  var timer = setInterval(tick, 400);
  tick();
})();
