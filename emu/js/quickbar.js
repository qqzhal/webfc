// quickbar.js — 悬浮快捷档条独立模块（从 emu/index.html 抽离）
// 包含：悬浮条样式与 DOM、槽位存读档（QUICK）、云同步（CLOUD）、全屏切换、数字键 1/2/3 拦截。
// 依赖：页面已载入 EmulatorJS（window.EJS_emulator）；EC 面板按钮调用 window.ECCheat.open（ec-cheat.js）。
// 对外接口：QuickBar.onGameStart() —— 由 emu/index.html 的 EJS_onGameStart 回调调用。
(function () {
  'use strict';

  // ========== 样式注入 ==========
  var style = document.createElement("style");
  style.textContent = `
#fcQuickBar {
  position: fixed;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: none;
  flex-direction: column;
  gap: 8px;
  padding: 4px;
  box-sizing: border-box;
  z-index: 10060;
  max-height: calc(100vh - 88px);
  overflow-y: auto;
  overscroll-behavior: contain;
  user-select: none;
  -webkit-user-select: none;
}

#fcQuickBar .qk-btn {
  width: 46px;
  height: 46px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(16, 22, 32, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.32);
  border-radius: 10px;
  color: #fff;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.36);
  transition: background .15s ease, transform .08s ease;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

#fcQuickBar .qk-btn:hover { background: rgba(60, 74, 96, 0.85); }

#fcQuickBar .qk-btn:active { transform: scale(0.94); }

#fcQuickBar .qk-char { font-size: 15px; font-weight: 700; line-height: 1; pointer-events: none; }

#fcQuickBar .qk-sub {
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  color: #ffd54a;
  margin-top: 3px;
  pointer-events: none;
}

#fcQuickBar .qk-btn.qk-flash-save { background: rgba(46, 204, 113, 0.9); border-color: #2ecc71; }

#fcQuickBar .qk-btn.qk-flash-load { background: rgba(52, 152, 219, 0.9); border-color: #3498db; }

#fcQuickBar .qk-btn.qk-flash-slot { background: rgba(255, 213, 74, 0.35); border-color: #ffd54a; }

#fcQuickBar .qk-btn.qk-fs-active { background: rgba(46, 107, 255, 0.85); border-color: #2e6bff; }

#fcQuickBar .qk-btn.qk-speed-on { background: rgba(255, 152, 0, 0.88); border-color: #ff9800; color: #1b1b1b; }

#fcQuickBar .qk-btn.qk-speed-on .qk-sub { color: #1b1b1b; }

#fcQuickBar .qk-btn.qk-busy {
  opacity: 0.55;
  cursor: progress;
  animation: qk-pulse 1s ease-in-out infinite;
}

@keyframes qk-pulse { 50% { border-color: #fff; } }

#fcQuickBar.qk-horizontal {
  right: 64px;
  top: 8px;
  transform: none;
  flex-direction: row-reverse;
  max-width: calc(100vw - 72px);
  max-height: none;
  overflow-x: auto;
  overflow-y: visible;
  padding: 2px;
  -webkit-overflow-scrolling: touch;
}

#fcQuickToggle.qk-top-right {
  right: 10px;
  top: 52px; /* 避开 EmulatorJS 右上角的菜单按钮 */
  transform: none;
}

/* 横屏：右上角那一排按钮更多（菜单/全屏等），折叠态「档」再往下让开一些 */
@media (orientation: landscape) {
  #fcQuickToggle.qk-top-right {
    top: 50px;
  }
}

#fcQkToast { position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%);
  padding: 9px 16px; border-radius: 10px; background: rgba(16,22,32,.94); color: #fff;
  border: 1px solid rgba(255,255,255,.28); font: 13px/1.4 system-ui,sans-serif; z-index: 10070;
  pointer-events: none; opacity: 0; transition: opacity .18s; max-width: 80vw; text-align: center; }
#fcQkToast.qk-show { opacity: 1; }
#fcQuickBar.qk-idle #qkSave, #fcQuickBar.qk-idle #qkLoad,
#fcQuickBar.qk-idle #qkSlot, #fcQuickBar.qk-idle #qkCheat { opacity: .45; }
#fcQuickToggle {
  position: fixed;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 46px;
  height: 46px;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(16, 22, 32, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.32);
  border-radius: 10px;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.36);
  z-index: 10061;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  -webkit-user-select: none;
}
  `;
  document.head.appendChild(style);

  // ========== DOM 创建 ==========
  var bar = document.createElement("div");
  bar.id = "fcQuickBar";
  // 按钮顺序：收 / 存 / 读 / 槽 / 传 / 取 / 金 / 屏
  bar.innerHTML = `
    <div class="qk-btn" id="qkCollapse" title="收起"><span class="qk-char">收</span></div>
    <div class="qk-btn" id="qkSave" title="快速存档到当前槽位"><span class="qk-char">存</span><span class="qk-sub">1</span></div>
    <div class="qk-btn" id="qkLoad" title="快速读取当前槽位"><span class="qk-char">读</span><span class="qk-sub">2</span></div>
    <div class="qk-btn" id="qkSlot" title="切换槽位"><span class="qk-char">槽</span><span class="qk-sub" id="qkSlotNum">1</span></div>
    <div class="qk-btn" id="qkCloudUp" title="上传槽位存档和SRAM到云端"><span class="qk-char">传</span></div>
    <div class="qk-btn" id="qkCloudDown" title="从云端下载存档覆盖本地"><span class="qk-char">取</span></div>
    <div class="qk-btn" id="qkCheat" title="EC 金手指面板"><span class="qk-char">金</span></div>
    <div class="qk-btn" id="qkSpeed" title="切换游戏速度：1x / 1.5x / 3x"><span class="qk-char">速</span><span class="qk-sub" id="qkSpeedNum">1x</span></div>
    <div class="qk-btn" id="qkFs" title="进入全屏（隐藏浏览器地址栏）"><span class="qk-char">屏</span></div>
  `;
  document.body.appendChild(bar);

  var toggleBtn = document.createElement("div");
  toggleBtn.id = "fcQuickToggle";
  toggleBtn.title = "展开快捷存档按钮";
  toggleBtn.textContent = "档";
  document.body.appendChild(toggleBtn);

  var qkSaveBtn = document.getElementById("qkSave");
  var qkLoadBtn = document.getElementById("qkLoad");
  var qkSlotBtn = document.getElementById("qkSlot");
  var qkSlotNumEl = document.getElementById("qkSlotNum");
  var qkFsBtn = document.getElementById("qkFs");
  var qkSpeedBtn = document.getElementById("qkSpeed");
  var qkSpeedNumEl = document.getElementById("qkSpeedNum");

  function qkFlash(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, 450);
  }

  function qkUpdateSlotBadge() {
    if (qkSlotNumEl) qkSlotNumEl.textContent = QUICK.slot;
  }

  function gmOK() {
    return window.EJS_emulator && EJS_emulator.started && EJS_emulator.gameManager;
  }
  // 站内自绘提示（游戏没启动时 EmulatorJS 的 displayMessage 不存在，提示会丢）
  var qkToastEl = null;
  function qkToast(t) {
    if (!qkToastEl) { qkToastEl = document.createElement("div"); qkToastEl.id = "fcQkToast"; document.body.appendChild(qkToastEl); }
    qkToastEl.textContent = t;
    qkToastEl.classList.add("qk-show");
    clearTimeout(qkToast._t);
    qkToast._t = setTimeout(function () { qkToastEl.classList.remove("qk-show"); }, 2200);
  }

  function msg(t) {
    if (window.EJS_emulator && window.EJS_emulator.displayMessage) { window.EJS_emulator.displayMessage(t); return; }
    qkToast(t);
  }

  // ========== 快捷存读档（持久化层） ==========
  // 槽位数据写入 EmulatorJS 自己的 EmulatorJS-states 库（fcquick-* 键），
  // 元数据（各槽保存时间）同库 fcquick-meta-<游戏名>。核心每帧不会丢，刷新页面也保留。
  var QUICK = {
    db: null,
    gameName: "",
    slot: 1,
    metaKey: function () { return "fcquick-meta-" + this.gameName; },
    store: function () {
      if (!this.db) this.db = new window.EJS_STORAGE("EmulatorJS-states", "states");
      return this.db;
    },
    slotKey: function () { return "fcquick-slot-" + this.gameName; },
    readMeta: function () {
      var key = this.metaKey();
      return CLOUD.idbEnsure("EmulatorJS-states", "states").then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(["states"], "readonly");
          var req = tx.objectStore("states").get(key);
          tx.oncomplete = function () {
            db.close();
            try { resolve(req.result ? JSON.parse(req.result) : {}); } catch (e) { resolve({}); }
          };
          tx.onerror = function () { db.close(); reject(tx.error || new Error("读取失败")); };
        });
      });
    },
    writeMeta: function (meta) {
      var key = this.metaKey();
      return CLOUD.idbEnsure("EmulatorJS-states", "states").then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(["states"], "readwrite");
          tx.objectStore("states").put(JSON.stringify(meta), key);
          tx.oncomplete = function () { db.close(); resolve(); };
          tx.onerror = function () { db.close(); reject(tx.error || new Error("写入失败")); };
        });
      });
    },
    fmtTime: function (ts) {
      var d = new Date(ts);
      function p(n) { return n < 10 ? "0" + n : "" + n; }
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
    },
    init: function (gameName) {
      this.gameName = gameName;
      var saved = 1;
      try { saved = parseInt(localStorage.getItem(this.slotKey()), 10) || 1; } catch (e) {}
      this.slot = saved;
      var self = this;
      // 默认选中有存档的槽：上次的槽仍有存档则保持；
      // 否则自动跳到保存时间最新的有档槽（无时间记录时取编号最大）。
      self.readMeta().then(function (meta) {
        return CLOUD.idbEnsure("EmulatorJS-states", "states").then(function (db) {
          return CLOUD.idbEntries(db, "states").then(function (entries) {
            db.close();
            return { meta: meta, entries: entries };
          });
        });
      }).then(function (r) {
        var re = new RegExp("^fcquick-" + gameName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-slot(\\d+)$");
        var slots = [];
        r.entries.forEach(function (en) {
          var m = re.exec(String(en.key));
          if (m) slots.push(parseInt(m[1], 10));
        });
        if (!slots.length) return;
        function hasSlot(n) { return slots.indexOf(n) !== -1; }
        var target;
        if (hasSlot(self.slot)) {
          target = self.slot;
        } else {
          var withTime = slots.filter(function (n) { return r.meta[n]; });
          if (withTime.length) {
            withTime.sort(function (a, b) { return r.meta[b] - r.meta[a]; });
            target = withTime[0];
          } else {
            target = Math.max.apply(null, slots);
          }
        }
        if (target && target !== self.slot) {
          self.slot = target;
          try { localStorage.setItem(self.slotKey(), String(target)); } catch (e) {}
          qkUpdateSlotBadge();
        }
      }).catch(function () { /* 检查失败保持默认槽 */ });
    },
    shotKey: function (slot) { return "fcshot-" + this.gameName + "-slot" + slot; },
    // 抓当前画面缩成小图（JPEG dataURL，约 5~20KB）；失败返回 null，不影响存档
    // 注意：不能直接对 #game canvas 做 drawImage —— EmulatorJS 用 WebGL 渲染，
    // 帧结束后绘图缓冲被清空，抓出来是全黑。必须走 emulator.screenshot()（它内部处理了）。
    captureShot: function (cb) {
      var done = false;
      function finish(url) { if (done) return; done = true; cb && cb(url || null); }
      function shrink(blobOrCanvas) {
        try {
          if (!blobOrCanvas) return finish(null);
          var W = 180;
          function draw(img) {
            var iw = img.width || img.naturalWidth || 0;
            var ih = img.height || img.naturalHeight || 0;
            if (!iw || !ih) return finish(null);
            var H = Math.max(1, Math.round(ih * W / iw));
            var c2 = document.createElement("canvas");
            c2.width = W; c2.height = H;
            c2.getContext("2d").drawImage(img, 0, 0, W, H);
            finish(c2.toDataURL("image/jpeg", 0.6));
          }
          if (blobOrCanvas instanceof Blob) {
            createImageBitmap(blobOrCanvas).then(draw).catch(function () { finish(null); });
          } else {
            draw(blobOrCanvas);
          }
        } catch (e) { finish(null); }
      }
      try {
        var E = window.EJS_emulator;
        if (E && typeof E.screenshot === "function") {
          setTimeout(function () { finish(null); }, 3000);   // 兜底：3s 没回调就放弃
          E.screenshot(function (blob) { shrink(blob); }, "canvas", "png", 1);
          return;
        }
      } catch (e) {}
      try {
        shrink(document.querySelector("#game canvas") || document.querySelector("canvas"));
      } catch (e) { finish(null); }
    },
    save: function () {
      var gm = window.EJS_emulator && window.EJS_emulator.gameManager;
      if (!gm || !this.gameName) { msg("请先载入游戏"); return; }
      var slot = this.slot;
      try {
        var data = gm.getState();
        if (!data) return;
        this.store().put("fcquick-" + this.gameName + "-slot" + slot, data);
        var selfShot = this;
        this.captureShot(function (url) {
          if (url) selfShot.store().put(selfShot.shotKey(slot), url);
        });
        var self = this;
        this.readMeta().then(function (meta) {
          meta[slot] = Date.now();
          return self.writeMeta(meta);
        }).catch(function () {});
        window.EJS_emulator.displayMessage("已将状态保存到插槽 " + slot);
        qkFlash(qkSaveBtn, "qk-flash-save");
      } catch (e) {
        window.EJS_emulator.displayMessage("保存状态失败");
      }
    },
    load: function () {
      var gm = window.EJS_emulator && window.EJS_emulator.gameManager;
      if (!gm || !this.gameName) { msg("请先载入游戏"); return; }
      var slot = this.slot;
      this.store().get("fcquick-" + this.gameName + "-slot" + slot).then(function (rec) {
        if (!rec) {
          window.EJS_emulator.displayMessage("插槽 " + slot + " 没有存档");
          return;
        }
        QUICK.readMeta().then(function (meta) {
          var ts = meta[slot];
          try {
            if (gm.clearEJSResetTimer) gm.clearEJSResetTimer();
            gm.loadState(rec);
            window.EJS_emulator.displayMessage("已从插槽 " + slot + " 加载状态" + (ts ? "（" + QUICK.fmtTime(ts) + " 保存）" : ""));
            qkFlash(qkLoadBtn, "qk-flash-load");
          } catch (e) {
            window.EJS_emulator.displayMessage("加载状态失败");
          }
        });
      });
    },
    nextSlot: function () {
      this.slot = this.slot >= 9 ? 1 : this.slot + 1;
      try { localStorage.setItem(this.slotKey(), String(this.slot)); } catch (e) {}
      window.EJS_emulator.displayMessage("状态槽 " + this.slot);
      qkUpdateSlotBadge();
      qkFlash(qkSlotBtn, "qk-flash-slot");
    }
  };

  // 数字键 1/2/3 拦截（存/读/切槽）。事件在到达 EmulatorJS 前被捕获，
  // 改走 QUICK 持久化槽位（EmulatorJS 内置快捷键槽位刷新即丢，故不使用）。
  document.addEventListener("keydown", function (e) {
    if (!gmOK()) return;
    if (e.target && e.target.closest && e.target.closest("input,textarea,select")) return;
    var kc = e.keyCode;
    if (kc !== 49 && kc !== 50 && kc !== 51) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (kc === 49) QUICK.save();
    else if (kc === 50) QUICK.load();
    else QUICK.nextSlot();
  }, true);
  document.addEventListener("keyup", function (e) {
    if (!gmOK()) return;
    var kc = e.keyCode;
    if (kc === 49 || kc === 50 || kc === 51) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);

  // ========== 云存档同步 ==========
  // 上传/下载范围：槽位快照（fcquick-* 键）+ 时间元数据（fcquick-meta-*）+ SRAM（/data/saves）。
  var CLOUD = {
    api: (function () {
      try { return localStorage.getItem("cloudSyncUrl") || "../同步接口"; } catch (e) { return "../同步接口"; }
    })(),
    busy: false,
    token: function () {
      try { return localStorage.getItem("syncToken") || ""; } catch (e) { return ""; }
    },
    msg: function (t) { msg(t); },
    setBusy: function (on) {
      this.busy = on;
      var up = document.getElementById("qkCloudUp");
      var down = document.getElementById("qkCloudDown");
      if (up) up.classList.toggle("qk-busy", on);
      if (down) down.classList.toggle("qk-busy", on);
    },
    request: function (action, method, body) {
      var opt = { method: method || "GET", headers: { "X-Sync-Token": this.token() } };
      if (body !== undefined) {
        opt.headers["Content-Type"] = "application/json";
        opt.body = JSON.stringify(body);
      }
      return fetch(this.api + "?action=" + action, opt).then(function (r) {
        return r.json().then(function (j) {
          if (!j.ok) throw new Error(j.error || ("HTTP " + r.status));
          return j;
        }, function () {
          throw new Error("服务器返回非 JSON（HTTP " + r.status + "）");
        });
      });
    },
    idbEnsure: function (name, store) {
      return new Promise(function (resolve, reject) {
        var req = indexedDB.open(name);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        };
        req.onsuccess = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(store)) {
            var ver = db.version + 1;
            db.close();
            var req2 = indexedDB.open(name, ver);
            req2.onupgradeneeded = function (e2) {
              var db2 = e2.target.result;
              if (!db2.objectStoreNames.contains(store)) db2.createObjectStore(store);
            };
            req2.onsuccess = function (e2) { resolve(e2.target.result); };
            req2.onerror = function () { reject(req2.error || new Error("IndexedDB 打开失败")); };
            return;
          }
          resolve(db);
        };
        req.onerror = function () { reject(req.error || new Error("IndexedDB 打开失败")); };
      });
    },
    idbEntries: function (db, store) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([store], "readonly");
        var out = [];
        var req = tx.objectStore(store).openCursor();
        req.onsuccess = function (e) {
          var c = e.target.result;
          if (!c) return;
          out.push({ key: c.key, value: c.value });
          c.continue();
        };
        tx.oncomplete = function () { resolve(out); };
        tx.onerror = function () { reject(tx.error || new Error("读取失败")); };
      });
    },
    u8ToB64: function (u8) {
      var CH = 0x8000, s = "";
      for (var i = 0; i < u8.length; i += CH) {
        s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
      }
      return btoa(s);
    },
    b64ToU8: function (b64) {
      var s = atob(b64), u8 = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
      return u8;
    },
    upload: function () {
      if (CLOUD.busy) return;
      if (!CLOUD.token()) { CLOUD.msg("云同步未配置秘钥"); return; }
      CLOUD.setBusy(true);
      Promise.all([
        CLOUD.idbEnsure("EmulatorJS-states", "states").then(function (db) {
          return CLOUD.idbEntries(db, "states").then(function (entries) { db.close(); return entries; });
        }),
        CLOUD.idbEnsure("/data/saves", "FILE_DATA").then(function (db) {
          return CLOUD.idbEntries(db, "FILE_DATA").then(function (entries) { db.close(); return entries; });
        }),
      ]).then(function (res) {
        var items = [];
        // 先扫一遍已有哪些状态槽位：截图只跟着存在的状态走，孤儿截图不传（并顺手删掉）
        var stateSet = {}, orphanShots = [];
        res[0].forEach(function (en) {
          var k = String(en.key);
          var mSt = /^fcquick-(?!meta-)(.+)-slot(\d+)$/.exec(k);
          if (mSt) stateSet[mSt[1] + "#" + mSt[2]] = true;
        });
        res[0].forEach(function (en) {
          var k = String(en.key);
          var mMeta = /^fcquick-meta-(.+)$/.exec(k);
          if (mMeta && typeof en.value === "string") {
            items.push({
              saveKey: k,
              kind: "meta",
              romName: mMeta[1],
              slot: null,
              u8: new TextEncoder().encode(en.value),
            });
            return;
          }
          var mShot = /^fcshot-(.+)-slot(\d+)$/.exec(k);
          if (mShot && typeof en.value === "string") {
            if (!stateSet[mShot[1] + "#" + mShot[2]]) { orphanShots.push(k); return; }
            items.push({ saveKey: k, kind: "shot", romName: mShot[1], slot: mShot[2], u8: new TextEncoder().encode(en.value) });
            return;
          }
          var m = /^fcquick-(.+)-slot(\d+)$/.exec(k);
          if (!m || !(en.value instanceof Uint8Array)) return;
          items.push({ saveKey: k, kind: "state", romName: m[1], slot: m[2], u8: en.value });
        });
        res[1].forEach(function (en) {
          var k = String(en.key);
          if (k.indexOf("/data/saves/") !== 0) return;
          var v = en.value;
          var u8 = v instanceof Uint8Array ? v : (v instanceof ArrayBuffer ? new Uint8Array(v) : null);
          if (!u8) return;
          items.push({
            saveKey: k,
            kind: "sram",
            romName: k.replace(/^\/data\/saves\//, "").replace(/\.[^.]+$/, ""),
            slot: null,
            u8: u8,
          });
        });
        if (orphanShots.length) {
          CLOUD.idbEnsure("EmulatorJS-states", "states").then(function (db) {
            var tx = db.transaction(["states"], "readwrite");
            var st = tx.objectStore("states");
            orphanShots.forEach(function (k) { st.delete(k); });
            tx.oncomplete = function () { db.close(); };
          }).catch(function () {});
        }
        if (!items.length) {
          CLOUD.setBusy(false);
          CLOUD.msg("云同步：本地没有可上传的存档");
          return;
        }
        var keys = items.map(function (it) { return it.saveKey; });
        var i = 0;
        CLOUD.msg("云同步：开始上传 " + items.length + " 条...");
        (function next() {
          if (i >= items.length) {
            CLOUD.setBusy(false);
            qkFlash(document.getElementById("qkCloudUp"), "qk-flash-save");
            CLOUD.msg("云同步：上传完成，共 " + items.length + " 条");
            return;
          }
          var it = items[i];
          var isFinal = i === items.length - 1;
          var body = {
            items: [{ saveKey: it.saveKey, kind: it.kind, romName: it.romName, slot: it.slot, data: CLOUD.u8ToB64(it.u8) }],
          };
          if (isFinal) { body.keys = keys; body.final = true; }
          CLOUD.request("upload", "POST", body).then(function () {
            i++;
            CLOUD.msg("云同步：上传中 " + i + "/" + items.length + " ...");
            next();
          }).catch(function (e) {
            CLOUD.setBusy(false);
            CLOUD.msg("云同步：上传失败 " + e.message);
          });
        })();
      }).catch(function (e) {
        CLOUD.setBusy(false);
        CLOUD.msg("云同步：读取本地存档失败 " + e.message);
      });
    },
    download: function () {
      if (CLOUD.busy) return;
      if (!CLOUD.token()) { CLOUD.msg("云同步未配置秘钥"); return; }
      if (!confirm("从云端下载会覆盖本浏览器的全部槽位存档和 SRAM（不影响正在运行的游戏），继续？")) return;
      CLOUD.setBusy(true);
      CLOUD.msg("云同步：正在下载...");
      CLOUD.request("download").then(function (j) {
        var items = j.items || [];
        if (!items.length) {
          CLOUD.setBusy(false);
          CLOUD.msg("云同步：服务器上还没有存档");
          return;
        }
        return Promise.all([
          CLOUD.idbEnsure("EmulatorJS-states", "states"),
          CLOUD.idbEnsure("/data/saves", "FILE_DATA"),
        ]).then(function (dbs) {
          var nState = 0, nSram = 0, nShot = 0;
          // 不能在 cursor 遍历删除的同一事务里 put 新记录——cursor 会看到
          // 遍历期间新插入的记录并误删。先只读收集旧键，再开新事务删+写。
          function collectKeys(db, store, filter) {
            return new Promise(function (resolve, reject) {
              var tx = db.transaction([store], "readonly");
              var keys = [];
              var cr = tx.objectStore(store).openCursor();
              cr.onsuccess = function (e) {
                var c = e.target.result;
                if (!c) return;
                if (filter(String(c.key))) keys.push(c.key);
                c.continue();
              };
              tx.oncomplete = function () { resolve(keys); };
              tx.onerror = function () { reject(tx.error || new Error("读取失败")); };
            });
          }
          return Promise.all([
            collectKeys(dbs[0], "states", function (k) { return /^(fcquick-|fcshot-)/.test(k); }),
            collectKeys(dbs[1], "FILE_DATA", function (k) { return k.indexOf("/data/saves/") === 0; }),
          ]).then(function (keyLists) {
            var p1 = new Promise(function (resolve, reject) {
              var tx = dbs[0].transaction(["states"], "readwrite");
              var st = tx.objectStore("states");
              keyLists[0].forEach(function (k) { st.delete(k); });
              items.forEach(function (it) {
                if (!it.data) return;
                if (it.kind === "meta") {
                  st.put(new TextDecoder().decode(CLOUD.b64ToU8(it.data)), it.saveKey);
                  return;
                }
                if (it.kind === "shot") {
                  st.put(new TextDecoder().decode(CLOUD.b64ToU8(it.data)), it.saveKey);
                  nShot++;
                  return;
                }
                if (it.kind !== "state") return;
                st.put(CLOUD.b64ToU8(it.data), it.saveKey);
                nState++;
              });
              tx.oncomplete = function () { dbs[0].close(); resolve(); };
              tx.onerror = function () { reject(tx.error || new Error("写入失败")); };
            });
            var p2 = new Promise(function (resolve, reject) {
              var tx = dbs[1].transaction(["FILE_DATA"], "readwrite");
              var st = tx.objectStore("FILE_DATA");
              keyLists[1].forEach(function (k) { st.delete(k); });
              items.forEach(function (it) {
                if (it.kind !== "sram" || !it.data) return;
                st.put(CLOUD.b64ToU8(it.data), it.saveKey);
                nSram++;
              });
              tx.oncomplete = function () { dbs[1].close(); resolve(); };
              tx.onerror = function () { reject(tx.error || new Error("写入失败")); };
            });
            return Promise.all([p1, p2]);
          }).then(function () {
            CLOUD.setBusy(false);
            qkFlash(document.getElementById("qkCloudDown"), "qk-flash-load");
            CLOUD.msg("云同步：已下载 " + items.length + " 条（槽位 " + nState + "、SRAM " + nSram + "、截图 " + nShot + "），重新载入游戏后生效");
          });
        });
      }).catch(function (e) {
        CLOUD.setBusy(false);
        CLOUD.msg("云同步：下载失败 " + e.message);
      });
    },
  };

  // ========== 游戏速度（1x / 1.5x / 3x 点击循环） ==========
  // EmulatorJS 自带的「加速」是按住才生效（虚拟手柄 b_speed_fast）。
  // 这里用核心的 fast-forward 开关做“常驻倍速”：设置 ff-ratio 后打开
  // toggleFastForward(1)，松手也不会掉回 1x。时序照抄 EmulatorJS 设置面板
  // handleSpecialOptions('ff-ratio')：先关、写 ratio、隔一拍再开，
  // 否则 runloop 的边沿检测会把这次切换吃掉（实测同步调用 3x 只跑出 1.5x）。
  var SPEED = {
    ratio: 1,
    baseRatio: null,   /* 长按「加速」用的原始 ff-ratio（EmulatorJS 默认 3.0） */
    KEY: "fc-speed-ratio",
    STEPS: [1, 1.5, 3],
    timer: null,
    load: function () {
      try {
        var v = parseFloat(localStorage.getItem(this.KEY));
        if (this.STEPS.indexOf(v) !== -1) this.ratio = v;
      } catch (e) {}
    },
    save: function () {
      try { localStorage.setItem(this.KEY, String(this.ratio)); } catch (e) {}
    },
    /* 记录 EmulatorJS 自己的「快进倍率」设置，回 1x 时要还回去，
       否则长按「加速」会变成 1 倍（等于失效） */
    captureBase: function () {
      if (this.baseRatio !== null) return;
      var v = null;
      try {
        v = window.EJS_emulator && EJS_emulator.getSettingValue
          ? EJS_emulator.getSettingValue("ff-ratio") : null;
      } catch (e) {}
      if (v === "unlimited") { this.baseRatio = 0; return; }
      var f = parseFloat(v);
      this.baseRatio = (isFinite(f) && f > 0) ? f : 3; /* EJS 默认 3.0 */
    },
    text: function (r) { return r === 1 ? "1x" : (r === 1.5 ? "1.5x" : "3x"); },
    gm: function () {
      return (window.EJS_emulator && EJS_emulator.started && EJS_emulator.gameManager)
        ? EJS_emulator.gameManager : null;
    },
    render: function () {
      if (!qkSpeedBtn) return;
      if (qkSpeedNumEl) qkSpeedNumEl.textContent = this.text(this.ratio);
      qkSpeedBtn.classList.toggle("qk-speed-on", this.ratio !== 1);
      qkSpeedBtn.title = "切换游戏速度（当前 " + this.text(this.ratio) + "，点击循环 1x → 1.5x → 3x）";
      // 倍速由本按钮接管时，屏蔽长按加速键，避免松手时把常驻倍速关掉
      var fast = document.querySelector(".ejs_virtualGamepad_bottom .b_speed_fast");
      if (fast) {
        fast.style.pointerEvents = this.ratio !== 1 ? "none" : "";
        fast.style.opacity = this.ratio !== 1 ? "0.35" : "";
      }
    },
    apply: function () {
      this.render();
      var gm = this.gm(), e = window.EJS_emulator;
      if (!gm || !e) return;
      if (this.ratio === 1) {
        e.isFastForward = false;
        this.captureBase();
        try {
          gm.toggleFastForward(0);
          gm.setFastForwardRatio(this.baseRatio === null ? 3 : this.baseRatio);
        } catch (x) {}
        return;
      }
      if (e.isFastForward) { try { gm.toggleFastForward(0); } catch (x) {} }
      e.isFastForward = true;
      try { gm.setFastForwardRatio(this.ratio); } catch (x) {}
      var self = this;
      clearTimeout(this.timer);
      this.timer = setTimeout(function () {
        if (self.ratio === 1 || !window.EJS_emulator || !EJS_emulator.isFastForward) return;
        try { EJS_emulator.gameManager.toggleFastForward(1); } catch (x) {}
      }, 30);
    },
    cycle: function () {
      var i = this.STEPS.indexOf(this.ratio);
      this.ratio = this.STEPS[(i + 1) % this.STEPS.length];
      this.save();
      this.apply();
      msg("游戏速度 " + this.text(this.ratio));
    },
    /* 档位加减（小键盘 +/-）：到顶/到底就停住，不循环 */
    step: function (dir) {
      var i = this.STEPS.indexOf(this.ratio);
      var j = i + (dir > 0 ? 1 : -1);
      if (j < 0 || j >= this.STEPS.length) {
        msg("游戏速度已是 " + this.text(this.ratio));
        return;
      }
      this.ratio = this.STEPS[j];
      this.save();
      this.apply();
      msg("游戏速度 " + this.text(this.ratio));
    },
    init: function () {
      this.load();
      this.captureBase();
      var self = this;
      setTimeout(function () { self.apply(); }, 500);
      if (this._hooked) return;
      this._hooked = true;
      // 暂停/继续、切后台回来时 runloop 会复位 fastmotion，这里补回
      try {
        var origPlay = window.EJS_emulator && EJS_emulator.play && EJS_emulator.play.bind(EJS_emulator);
        if (origPlay) {
          EJS_emulator.play = function () {
            origPlay();
            setTimeout(function () { SPEED.apply(); }, 200);
          };
        }
      } catch (e) {}
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) setTimeout(function () { SPEED.apply(); }, 400);
      });
    }
  };

  // 小键盘 +/- 切换倍速档位（+ 升档、- 降档；到顶/到底停住）。
  // 必须在 EmulatorJS 之前拦下来：默认设置里 小键盘+/- 绑的是 EJS 的“快进/快退”输入，
  // 不拦的话按 + 会被 EJS 当成按住快进，和右侧「速」按钮的常驻倍速打架。
  function qkIsNumpadSpeedKey(e) {
    return e.code === "NumpadAdd" || e.code === "NumpadSubtract" ||
      e.keyCode === 107 || e.keyCode === 109;
  }
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target && e.target.closest && e.target.closest("input,textarea,select")) return;
    if (!qkIsNumpadSpeedKey(e)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (!gmOK()) return;
    SPEED.step((e.code === "NumpadAdd" || e.keyCode === 107) ? 1 : -1);
  }, true);
  document.addEventListener("keyup", function (e) {
    if (!qkIsNumpadSpeedKey(e)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);

  // ========== 悬浮条布局 / 折叠 ==========
  var qkStarted = false;

  function qkIsMobileLayout() {
    return Math.min(window.innerWidth, window.innerHeight) <= 768;
  }

  // 没有同步秘钥（localStorage.syncToken）时，隐藏「传 / 取」两个按钮
  function qkHasToken() {
    try { return !!(localStorage.getItem("syncToken") || "").trim(); } catch (e) { return false; }
  }
  function qkSyncCloudVisibility() {
    var has = qkHasToken();
    var up = document.getElementById("qkCloudUp");
    var down = document.getElementById("qkCloudDown");
    if (up) up.style.display = has ? "" : "none";
    if (down) down.style.display = has ? "" : "none";
  }

  function qkApplyLayout() {
    if (!qkStarted) return;
    var mobile = qkIsMobileLayout();
    var collapsed;
    try { collapsed = localStorage.getItem("fcquick-bar-collapsed"); } catch (e) { collapsed = null; }
    if (collapsed === null || collapsed === undefined) collapsed = mobile ? "1" : "0"; // 从未手动切换：手机默认折叠
    var isCollapsed = collapsed === "1";
    bar.classList.toggle("qk-horizontal", mobile);
    toggleBtn.classList.toggle("qk-top-right", mobile);
    bar.style.display = isCollapsed ? "none" : "flex";
    toggleBtn.style.display = isCollapsed ? "flex" : "none";
    qkSyncCloudVisibility();
  }

  function qkSetCollapsed(v) {
    try {
      localStorage.setItem("fcquick-bar-collapsed", v ? "1" : "0");
      localStorage.setItem("fcquick-bar-user-toggled", "1");
    } catch (e) {}
    qkApplyLayout();
  }

  function qkShow() {
    qkStarted = true;
    qkApplyLayout();
  }

  // 未载入游戏时也显示悬浮条：云同步「传 / 取」不依赖游戏，先进游戏再同步太别扭。
  // 此时 存 / 读 / 金 点了会提示「请先载入游戏」，传 / 取 / 屏 / 收 正常可用。
  function qkShowIdle() {
    qkStarted = true;
    qkApplyLayout();
    if (bar) bar.classList.add("qk-idle");
  }

  window.addEventListener("resize", qkApplyLayout);
  window.addEventListener("orientationchange", qkApplyLayout);

  toggleBtn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    qkSetCollapsed(false);
  });
  document.getElementById("qkCollapse").addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    qkSetCollapsed(true);
  });

  // ========== 全屏切换 ==========
  function qkIsFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  function qkToggleFullscreen() {
    if (qkIsFullscreen()) {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) { var ret = exit.call(document); if (ret && ret.catch) ret.catch(function () {}); }
      return;
    }
    var target = document.getElementById("game-wrap") || document.documentElement;
    var req = target.requestFullscreen || target.webkitRequestFullscreen;
    if (!req) {
      msg("当前浏览器不支持网页全屏");
      return;
    }
    var ret2 = req.call(target);
    if (ret2 && ret2.catch) ret2.catch(function () { msg("进入全屏被浏览器拒绝"); });
  }
  function qkRefreshFsState() {
    var on = qkIsFullscreen();
    qkFsBtn.classList.toggle("qk-fs-active", on);
    qkFsBtn.title = on ? "退出全屏" : "进入全屏（隐藏浏览器地址栏）";
    // 全屏时浏览器只渲染「全屏元素」子树里的内容，而快捷条挂在 <body> 下，
    // 进入全屏后会被一起藏掉 —— 所以把它挪进全屏元素里，退出时再挪回 body。
    qkSyncFullscreenHost();
  }

  function qkSyncFullscreenHost() {
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    var host = fsEl || document.body;
    if (bar.parentNode !== host) host.appendChild(bar);
    if (toggleBtn.parentNode !== host) host.appendChild(toggleBtn);
  }
  qkFsBtn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    qkToggleFullscreen();
  });
  document.addEventListener("fullscreenchange", qkRefreshFsState);
  document.addEventListener("webkitfullscreenchange", qkRefreshFsState);

  // ========== 按钮绑定 ==========
  qkSaveBtn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); QUICK.save(); });
  qkLoadBtn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); QUICK.load(); });
  qkSlotBtn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); QUICK.nextSlot(); });
  document.getElementById("qkCloudUp").addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    CLOUD.upload();
  });
  document.getElementById("qkCloudDown").addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    CLOUD.download();
  });
  document.getElementById("qkCheat").addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (window.ECCheat) ECCheat.open();
    else msg("EC 金手指模块未加载");
  });
  qkSpeedBtn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    SPEED.cycle();
  });

  // ========== 对外接口 ==========

  // 秘钥可能在别的标签页（同步接口）里设置，回到前台或 storage 变化时刷新
  document.addEventListener("visibilitychange", function () { if (!document.hidden) qkSyncCloudVisibility(); });
  window.addEventListener("focus", qkSyncCloudVisibility);
  window.addEventListener("storage", function (e) { if (!e || e.key === "syncToken" || e.key === null) qkSyncCloudVisibility(); });

  window.QuickBar = {
    slot: 1,
    onGameStart: function () {
      // 游戏启动：初始化槽位（自动选中有档槽）、徽标、显示悬浮条
      var gameName = "";
      try {
        var c = EJS_emulator.config || {};
        gameName = String(c.gameName || "");
      } catch (e) {}
      if (bar) bar.classList.remove("qk-idle");
      QUICK.init(gameName);
      qkUpdateSlotBadge();
      qkShow();
      SPEED.init();
    },
    save: function () { QUICK.save(); },
    load: function () { QUICK.load(); },
    nextSlot: function () { QUICK.nextSlot(); },
    cycleSpeed: function () { SPEED.cycle(); },
    show: function () { qkShow(); },
    showIdle: function () { qkShowIdle(); },
    upload: function () { CLOUD.upload(); },
    download: function () { CLOUD.download(); },
    toggleFullscreen: function () { qkToggleFullscreen(); },
  };
})();
