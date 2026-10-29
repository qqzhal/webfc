// sidebar/ct2.js — 天使之翼2（Captain Tsubasa 2）自定义音乐增强
// 依赖：sidebar.js（左侧悬浮条框架）、js/gme_player.js（GME 的 wasm 播放器）、
//       music/music_config.js（$0700 编号 → NSF 曲目映射）、music/*.js（NSF 数据）
// 原理：每帧轮询核心的 $0700（通过核心导出 _ejs_read_ram），命中映射就把游戏内部 BGM
//       停掉（_ejs_write_ram(0x700,1)）并让 GME 播放对应 NSF；音效仍由游戏 APU 正常发声。
(function () {
  'use strict';
  if (!window.Sidebar) { console.warn('[CT2] Sidebar 未加载'); return; }

  var MOD_ID = 'ct2';
  var MAPPERS = [74, 195, 198];        // 天使之翼2 的几种汉化/改版
  // 随机播放的去重方式（「随」按钮）：
  //   'code' = 按编号去重（默认）：最近 2 次随机到的「代码」不重复
  //   'tune' = 按曲子去重：最近 2 次播过的「曲子（path#index）」不重复；
  //            适合同一首曲子有多个编号（如 1001~1009 都指向同一首）的情况
  var DEDUPE_MODE = 'tune';
  // 只在 DEDUPE_MODE === 'tune' 时生效：同一首曲子有多个编号时，是否「每个曲子等概率」
  //   true  = 先把候选按曲子分组，再等概率选曲子（多个编号不会拉高该曲的概率）
  //   false = 直接按编号等概率抽（同一曲的多个编号会叠加权重，让这首更容易被抽到）
  var TUNE_UNIQUE = false;
  // 「曲」按钮下面的副标签（未映射编号）是否显示：
  //   false = 用样式隐藏（默认）；true = 显示，可在 SETTINGS_SUB_CSS 里写自己的样式
  var SHOW_SETTINGS_SUB = false;
  var SETTINGS_SUB_CSS = '';   // 例："#sb-ct2-settings .sb-sub{font-size:10px;color:#ffd54a}"

  // ---------- 随机播放（「随」） ----------
  // 池子：music/music_config.js 里从 ["CE", …] 到 ["C2", …] 这一段（按文本顺序，含首尾）的 BGM 代码，
  // 共 85 个（已排除 type:"se"）。游戏要播这些曲子时，改成从池里随机挑一首。
  // 「最近 2 次随机到的」会进 RAND.recent，挑选时排除，避免连着两首一样。
  //
  // 想加自己的曲子：$0700 只会写 0x00~0xFF（两位十六进制），所以自选编号用「游戏绝不会命中的写法」，
  // 例如 "999" / "1000"~"1999"（3~4 位数字）。做法：
  //   1) 在 music_config.js 里加一条：["999", {"path":"music/xxx.js","index":3,"type":"bgm","name":"","note":"自选1"}],
  //   2) 把 '999' 追加到下面 RAND_POOL 数组末尾（数组里不要重复）。
  // 这样它永远不会被游戏触发，只会在随机时被选中播放（「曲」面板里也能手动点播试听）。
  var RAND_POOL = [
		'3C',//圣保罗音乐
		'39',//南葛
		'3F',//日本
		'35',//1~5巴西联赛音乐
		//'40',//6弗拉门戈音乐
		'34',//7~11日本高中联赛音乐
		//'37',//12东邦音乐，猛虎压境
		'3B',//13~16邀请赛
		'3A',//17+亚洲突围音乐
		//'36',//27法国音乐，埃菲尔攻击
		//'3D',//31阿根廷音乐
		//'38',//32德国
		//'3E',//33巴西
		'32',//比赛5分钟倒计时音乐，最后关头
		
		//////////////////////
		'CE', '77', '73', 'BC', 'BA', '76', '33', '91', 'A5', 'C3', 
		'BB', 'C4', 'C6', 'CA', 'CC', 'CD', '78', 'C1', 'B3',
		'7C', '7A', '83', '7B', '79', '87', '7F', '95', '96', '80',
		'97', '93', 'A7', '7D', '98', '99', '9A', '9F', 'A0',
		'4B', '54', '5A', '59', '9D', 'C5', '9E', '86', 'BE', '7E', 'C9', 'D1',
		'90', 'A1', '9C', '9B', 'CF', 'BF', '84', '8C', '8F', 'D9', '8E', '74',
		'8B', 'D5', '82', 'DA', 'A9', 'AF', 'AA', 'AB', 'AC', 'A6', '81', 'B9',
		'C2',

		//////////////////////
		'1001','1002','1003','1004','1005','1006','1007','1008','1009',//游戏里绝对不会命中的，给随机歌曲丰富曲目用
  
		// 0x72~0xFE 里原先空缺的代码（填充后与 1001~1009 同一批曲目），追加进池子一起随机
		'72', '75', '85', '88', '89', '92', '94', '8A', '8D', 'A2', 'A3', 'A4',
		'A8', 'AD', 'AE', 'B0', 'B1', 'B2', 'B4', 'B5', 'B6', 'B7', 'B8', 'BD',
		'C0', 'C7', 'C8', 'CB', 'D0', 'D2', 'D3', 'D4', 'D6', 'D7', 'D8', 'DB',
		'DC', 'DD', 'DE', 'DF', 'E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7',
		'E8', 'E9', 'EA', 'EB', 'EC', 'ED', 'EE', 'EF', 'F0', 'F1', 'F2', 'F3',
		'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'FA', 'FB', 'FC', 'FD', 'FE',
  ];
  var RAND = {
    on: false,
    mode: DEDUPE_MODE,        // 取自上面的 DEDUPE_MODE 常量
    recent: [],
    KEY: 'ct2-random',
    modeText: function () { return this.mode === 'tune' ? '按曲子' : '按编号'; },
    setMode: function (m) {
      m = m === 'tune' ? 'tune' : 'code';
      if (m === this.mode) return this.mode;
      this.mode = m;
      // 切换后只保留当前正在播的那首，避免马上重复
      var seed = this.mode === 'tune' ? curTune : curCode;
      this.recent = seed ? [seed] : [];
      try { if (window.EJS_emulator && EJS_emulator.displayMessage) EJS_emulator.displayMessage('随机去重方式：' + this.modeText()); } catch (e) {}
      log('dedupe mode', m);
      return this.mode;
    },
    load: function () {
      try { this.on = localStorage.getItem(this.KEY) === '1'; } catch (e) { this.on = false; }
    },
    save: function () {
      try { localStorage.setItem(this.KEY, this.on ? '1' : '0'); } catch (e) {}
    },
    // 曲子标识：同一首曲子可能有多个代码（例如 1001~1009 都指同一首）
    tuneOf: function (code) {
      var m = map && map[code];
      if (!m || !m.path) return null;
      return String(m.path) + '#' + (m.index || 0);
    },
    pick: function (excludeCode) {
      var self = this;
      function build(relaxRecent) {
        return RAND_POOL.filter(function (c) {
          if (c === excludeCode) return false;
          var t = self.tuneOf(c);
          if (!t) return false;
          var key = self.mode === 'tune' ? t : c;      // 按曲子 / 按编号
          if (!relaxRecent && self.recent.indexOf(key) !== -1) return false;
          return true;
        });
      }
      var cand = build(false);
      if (!cand.length) cand = build(true);          // 池子太小：放宽「最近 2 首」
      if (!cand.length) cand = RAND_POOL.slice();
      if (this.mode === 'tune' && TUNE_UNIQUE) {
        // 每个曲子等概率：先按曲子分组，均匀选一首，再从该曲的编号里随机取一个
        var groups = {};
        for (var i = 0; i < cand.length; i++) {
          var t = self.tuneOf(cand[i]);
          if (!t) continue;
          if (!groups[t]) groups[t] = [];
          groups[t].push(cand[i]);
        }
        var tunes = Object.keys(groups);
        if (tunes.length) {
          var pickTune = tunes[Math.floor(Math.random() * tunes.length)];
          var codes = groups[pickTune];
          return codes[Math.floor(Math.random() * codes.length)];
        }
      }
      return cand[Math.floor(Math.random() * cand.length)];
    },
    // recent 里存的是「曲子」而不是代码：path#index
    remember: function (tune) {
      if (!tune) return;
      if (this.recent[this.recent.length - 1] === tune) return;   // 同一首连续播不重复记录
      this.recent.push(tune);
      while (this.recent.length > 2) this.recent.shift();
    }
  };
  var STOP_ADDR = 0x0700;

  var enabled = false;
  var map = null;                       // hex code -> {path,index,type,note,name}
  var list = [];                        // BGM 列表（按 code 排序）
  var gme = null;                       // { Module, ctx, node, bufferPtr, dataPtr }
  var nsfCache = {};                    // path -> Uint8Array
  var lastRaw = -1;
  var watchMode = false;
  var evCount = 0, lastEv = -1, evVals = [], stopWrites = 0;
  var lastWriteVal = -1, lastUnmapped = '', seenUnmapped = [], writeLog = [];   // 最近一次非 0 的 $0700 写入 / 未映射值   // 核心写监视是否启用（优先），否则退回每帧读值
  var curCode = null;
  var curName = '';
  var curFile = '', curTrack = 0;
  var curTune = '';                     // 当前曲子的 path#index（随机去重用）
  var rafId = 0;
  var loading = null;

  function log() { try { console.log.apply(console, ['[CT2]'].concat([].slice.call(arguments))); } catch (e) {} }
  function coreModule() {
    try { return window.EJS_emulator && EJS_emulator.gameManager && EJS_emulator.gameManager.Module; } catch (e) { return null; }
  }
  function readRam(a) {
    var M = coreModule();
    try { return M && M._ejs_read_ram ? M._ejs_read_ram(a) : -1; } catch (e) { return -1; }
  }
  function writeRam(a, v) {
    var M = coreModule();
    try { if (M && M._ejs_write_ram) M._ejs_write_ram(a, v); } catch (e) {}
  }
  function hex(v) { return ('0' + (v & 0xFF).toString(16).toUpperCase()).slice(-2); }

  // ---------- 按游戏记忆开关（localStorage，键为 ROM 名） ----------
  function gameKey() {
    var name = '';
    try {
      var c = (window.EJS_emulator && EJS_emulator.config) || {};
      name = String(c.gameName || '');
      if (!name) {
        var u = String(c.gameUrl || '');
        if (u && u.indexOf('blob:') !== 0 && u.indexOf('data:') !== 0) {
          name = u.split('/').pop().split('?')[0].replace(/\.[^.]+$/, '');
        }
      }
    } catch (e) {}
    if (!name) name = 'mapper' + (Sidebar.getMapper() === null ? '?' : Sidebar.getMapper());
    return 'ct2-music-on:' + name;
  }

  function loadPref() {
    try { return localStorage.getItem(gameKey()) === '1'; } catch (e) { return false; }
  }

  function savePref(on) {
    try { localStorage.setItem(gameKey(), on ? '1' : '0'); } catch (e) {}
  }


  // ---------- 配置与 NSF 数据 ----------
  var loadedScripts = {};   // id -> true（不能用 DOM id 判断：中文文件名做 id 会撞车）
  function loadScript(src, id) {
    return new Promise(function (resolve, reject) {
      if (id && loadedScripts[id]) return resolve();
      var s = document.createElement('script');
      s.src = src;
      if (id) s.id = id;
      s.onload = function () { if (id) loadedScripts[id] = true; resolve(); };
      s.onerror = function () { reject(new Error('load fail ' + src)); };
      document.head.appendChild(s);
    });
  }

  function ensureConfig() {
    if (map) return Promise.resolve(map);
    if (loading) return loading;
    loading = loadScript('music/music_config.js' + (window.MUSIC_CONFIG_VER ? '?v=' + window.MUSIC_CONFIG_VER : ''), 'ct2-music-config').then(function () {
      var cfg = window.musicConfig;
      map = {};
      if (cfg && typeof cfg.forEach === 'function') {
        cfg.forEach(function (v, k) {
          if (!v) return;
          map[String(k).toUpperCase()] = v;
        });
      }
      list = Object.keys(map).filter(function (k) {
        var m = map[k];
        return m && m.path && m.type !== 'se';
      }).sort().map(function (k) {
        return { code: k, path: map[k].path, index: map[k].index || 0, name: map[k].name || '', note: map[k].note || map[k].name || '' };
      });
      log('mappings', Object.keys(map).length, 'bgm', list.length);
      return map;
    });
    return loading;
  }

  function loadNsf(path, varName) {
    var key = path + '|' + (varName || '');
    if (nsfCache[key]) return Promise.resolve(nsfCache[key]);
    // id 用 encodeURIComponent，避免不同中文文件名被清洗成同一个 id
    var id = 'ct2-nsf-' + encodeURIComponent(path);
    // 记录加载前的全局键：有些 NSF 文件的变量名和文件名不一致（如“恶魔城3.js”里是“恶魔城3_空白_”），
    // 加载后通过“新增的全局键”自动识别，避免手工在配置里补 name。
    var before = {};
    try { Object.keys(window).forEach(function (k) { before[k] = 1; }); } catch (e) {}
    return loadScript(path, id).then(function () {
      var base = path.split('/').pop().replace(/\.js$/i, '');
      var names = [];
      if (varName) names.push(varName);
      if (base) names.push(base);
      var d = null, used = '';
      for (var i = 0; i < names.length; i++) {
        if (window[names[i]]) { d = window[names[i]]; used = names[i]; break; }
      }
      if (!d) {
        try {
          var cands = Object.keys(window).filter(function (k) { return !before[k]; });
          for (var j = 0; j < cands.length; j++) {
            var v = window[cands[j]];
            if (v && (v instanceof Uint8Array || Array.isArray(v)) && v.length > 128) {
              d = v; used = cands[j]; break;
            }
          }
        } catch (e) {}
      }
      if (!d) throw new Error('变量缺失 ' + names.join(' / '));
      var bytes = d instanceof Uint8Array ? d : new Uint8Array(d);
      nsfCache[key] = bytes;
      log('nsf', path, '->', used, bytes.length + ' bytes');
      return bytes;
    });
  }

  // ---------- GME（在隔离作用域里加载，避免和 EJS 的 Module/HEAPU8 冲突） ----------
  function ensureGme() {
    if (gme && gme.Module) return Promise.resolve(gme);
    if (!gme) gme = {};
    if (gme.loading) return gme.loading;
    gme.loading = fetch('js/gme_player.js', { cache: 'force-cache' })
      .then(function (r) { return r.text(); })
      .then(function (src) {
        var factory = new Function(src + '\nreturn { M: Module, heap: function(){ return HEAPU8; }, heap16: function(){ return HEAP16; } };');
        var holder = factory();
        var M = holder.M;
        gme.Module = M;
        gme.heap = holder.heap;
        gme.heap16 = holder.heap16;
        return new Promise(function (resolve, reject) {
          var t0 = Date.now();
          (function wait() {
            if (M && M._init_gme && M.calledRun) return resolve();
            if (Date.now() - t0 > 20000) return reject(new Error('GME 初始化超时'));
            setTimeout(wait, 50);
          })();
        });
      })
      .then(function () {
        var M = gme.Module;
        gme.ctx = new (window.AudioContext || window.webkitAudioContext)();
        // 自动恢复上次开关时没有用户手势，AudioContext 可能处于 suspended：首次交互时恢复
        (function hookResume() {
          var resume = function () { try { if (gme.ctx && gme.ctx.state === 'suspended') gme.ctx.resume(); } catch (e) {} };
          ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, resume, { passive: true }); });
        })();
        gme.bufferPtr = M.ccall('get_buffer', 'number', [], []);
        gme.dataPtr = M.ccall('get_data_buffer', 'number', [], []);
        log('GME ready', M.ccall('get_track_count', 'number', [], []) + ' tracks');
        return gme;
      });
    return gme.loading;
  }

  function stopNode() {
    if (gme && gme.node) {
      try { gme.node.disconnect(); } catch (e) {}
      gme.node = null;
    }
  }

  function playData(bytes, track, code, note, file) {
    return ensureGme().then(function () {
      var M = gme.Module;
      if (!gme.node) {
        // 先停旧 node，避免叠加
        stopNode();
        var size = 4096;
        var node = gme.ctx.createScriptProcessor(size, 0, 2);
        node.onaudioprocess = function (ev) {
          var out = ev.outputBuffer, L = out.getChannelData(0), R = out.getChannelData(1);
          var r = 0;
          var pk = 0;
          try { r = M.ccall('play_gme', 'number', ['number'], [size]); } catch (e) { r = -1; }
          if (r !== 0) { stopNode(); return; }
          var buf = gme.heap16 ? gme.heap16() : null;
          var start = (gme.bufferPtr || 0) >> 1;
          var data;
          try {
            data = buf ? buf.subarray(start, start + size * 2)
                       : new Int16Array(gme.heap().buffer, gme.bufferPtr, size * 2);
          } catch (e) { return; }
          for (var i = 0; i < size; i++) {
            var l = data[i * 2] / 32767, rr = data[i * 2 + 1] / 32767;
            var al = l < 0 ? -l : l;
            if (al > pk) pk = al;
            L[i] = l < -1 ? -1 : (l > 1 ? 1 : l);
            R[i] = rr < -1 ? -1 : (rr > 1 ? 1 : rr);
          }
          gme.peak = pk;
        };
        var gain = gme.ctx.createGain();
        gain.gain.value = 0.9;
        node.connect(gain);
        gain.connect(gme.ctx.destination);
        gme.node = node;
      }
      if (gme.ctx.state === 'suspended') gme.ctx.resume();
      var res = M.ccall('resize_data_buffer', 'number', ['number'], [bytes.length]);
      if (res !== 0) throw new Error('resize_data_buffer 失败');
      gme.dataPtr = M.ccall('get_data_buffer', 'number', [], []);
      var heap = gme.heap();
      for (var i = 0; i < bytes.length; i++) heap[gme.dataPtr + i] = bytes[i];
      var ok = M.ccall('init_gme', 'number', ['number', 'number', 'number'], [bytes.length, track | 0, gme.ctx.sampleRate]);
      if (ok !== 0) throw new Error('init_gme 失败 ' + ok);
      gme.bufferPtr = M.ccall('get_buffer', 'number', [], []);
      // 随机去重按「曲子」（path#index）记录：不管这曲是随机来的还是游戏直接命中的，都算“最近播过”
      curTune = String(file || '') + '#' + (track | 0);
      RAND.remember(RAND.mode === 'tune' ? curTune : code);
      curCode = code;
      curName = note || '';
      curFile = file ? String(file).split('/').pop() : '';
      curTrack = track | 0;
      Sidebar.setLabel(MOD_ID, 'music', (code || '--'));
      Sidebar.closePanel();
      log('play', code, track, note);
    });
  }

  function playMapping(m, opts) {
    if (!m || !m.path) return Promise.resolve();
    var skipStop = opts && opts.skipStop;
    // 每次换外部曲目都要重新给游戏发“停止内部 BGM”命令：
    // 游戏在场景切换时会重新写 $0700 启动它自己的音乐，只在第一首时停一次的话，
    // 后面内部音乐就会一直在外部音乐底下小声播（听起来像被覆盖）。
    if (!skipStop) {
      writeRam(STOP_ADDR, 0x01);
      lastRaw = 0x01;
      stopWrites++;
    }
    return loadNsf(m.path, m.name || m.variable || null).then(function (bytes) {
      return playData(bytes, m.index || 0, m.code, m.note || m.name, m.path);
    }).catch(function (e) { console.error('[CT2] 播放失败', e); });
  }


  // 把「游戏想播的代码」换成池里随机一首；不在池里或找不到映射就返回 null（保持原样）
  function randMapping(triggerH) {
    if (!RAND.on || RAND_POOL.indexOf(triggerH) === -1) return null;
    var tried = [];
    for (var i = 0; i < 10; i++) {
      var code = RAND.pick(triggerH);
      if (tried.indexOf(code) !== -1) break;
      tried.push(code);
      var m = map && map[code];
      if (m && m.path && m.type !== 'se') {
        m.code = code;
        return { code: code, m: m };
      }
    }
    return null;
  }

  function stopMusic() {
    stopNode();
    curCode = null;
    curName = '';
    curFile = '';
    curTrack = 0;
    curTune = '';
    Sidebar.setLabel(MOD_ID, 'music', '关');
    lastRaw = readRam(STOP_ADDR);
  }

  // ---------- $0700 轮询 ----------
  // 记录任意非 0 的 $0700 写入（写入日志），但「曲」按钮只显示“未映射”的值：
  // 命中映射的 BGM/SE 不更新副标签，避免音效让数字一直跳。
  function noteRawWrite(v) {
    if (!v) return;
    var h = hex(v);
    var m = map && map[h];
    // 0x01 是「停止上一首」标记（游戏写它表示静音/切场），单独标出来，别混进"未映射"
    var type = m ? (m.type === 'se' ? 'SE' : 'BGM') : (v === 0x01 ? 'STOP' : '未映射');
    lastWriteVal = v;
    if (!writeLog.length || writeLog[0].h !== h) {
      writeLog.unshift({ h: h, type: type });
      if (writeLog.length > 20) writeLog.pop();
    }
    if (!m && v !== 0x01) {          // 0x01 是停止标记，不算"未映射"
      lastUnmapped = h;
      Sidebar.setLabel(MOD_ID, 'settings', h);
      if (seenUnmapped.indexOf(h) === -1) {
        seenUnmapped.push(h);
        if (seenUnmapped.length > 24) seenUnmapped.shift();
      }
    }
    if (panel && panel.style.display !== 'none') renderPanel();
  }

  function handleValue(v) {
    if (!enabled) return;
    if (v === 0x01) { if (curCode) stopMusic(); return; }
    var h = hex(v);
    var m = map && map[h];
    if (m && m.path) {
      if (m.type === 'se') return;               // 音效交给游戏 APU，不动外部 BGM
      var rr = randMapping(h);                   // 池内曲子：随机换一首（最近 2 首不重复）
      if (rr) { h = rr.code; m = rr.m; }
      if (curCode === h) return;                 // 同一首不重播
      m.code = h;
      playMapping(m, { skipStop: false });       // 每次切换都重发停止命令，避免内部 BGM 叠加
      return;
    }
    // 未映射：>=0x32 视为 BGM 指令，默认不打断当前外部音乐
  }

  function loop() {
    if (!enabled) { rafId = 0; return; }
    if (watchMode) {
      var M = coreModule();
      if (M && M._ejs_watch_pop) {
        for (var i = 0; i < 64; i++) {
          var ev = M._ejs_watch_pop();
          if (ev < 0) break;
          var va = (ev >> 8) & 0xFFFF;
          if (va === STOP_ADDR) {
            evCount++;
            lastEv = ev & 0xFF;
            if (lastEv) {
              evVals.push(lastEv); if (evVals.length > 40) evVals.shift();
              noteRawWrite(lastEv);
            }
            handleValue(lastEv);
          }
        }
      }
    } else {
      var v = readRam(STOP_ADDR);
      if (v >= 0 && v !== lastRaw) { lastRaw = v; if (v) noteRawWrite(v); handleValue(v); }
    }
    rafId = requestAnimationFrame(loop);
  }

  function startPolling() {
    if (rafId) return;
    var M = coreModule();
    watchMode = !!(M && M._ejs_watch_enable && M._ejs_watch_pop);
    if (watchMode) {
      try { M._ejs_watch_enable(STOP_ADDR, STOP_ADDR); } catch (e) { watchMode = false; }
    }
    lastRaw = readRam(STOP_ADDR);
    rafId = requestAnimationFrame(loop);
  }

  function stopWatching() {
    var M = coreModule();
    if (watchMode && M && M._ejs_watch_disable) { try { M._ejs_watch_disable(); } catch (e) {} }
    watchMode = false;
  }

  // ---------- UI ----------
  function enableMusic() {
    ensureConfig().then(function () {
      // 不兜底：$0700 当前没有映射就静音等待，等游戏自己写场景 BGM（A 方案）。
      // 注意 $0700=0 只在启动/静默时出现，不能拿来当“列表第一首”的默认值。
      var v = readRam(STOP_ADDR);
      var h = hex(v);
      var m = (map && map[h] && map[h].path && map[h].type !== 'se') ? map[h] : null;
      if (m) {
        var rr = randMapping(h);
        if (rr) { h = rr.code; m = rr.m; }
        m.code = h;
        playMapping(m);
      }
      else if (!curCode) { Sidebar.setLabel(MOD_ID, 'music', '待'); }
      startPolling();
    });
  }

  function toggleMusic() {
    enabled = !enabled;
    Sidebar.setOn(MOD_ID, 'music', enabled);
    savePref(enabled);
    if (!enabled) { stopMusic(); stopWatching(); Sidebar.closePanel(); return; }
    enableMusic();
  }


  function toggleRand() {
    RAND.on = !RAND.on;
    RAND.save();
    if (RAND.on) {
      var seed = RAND.mode === 'tune' ? curTune : curCode;   // 刚打开：别马上又抽到当前这首
      RAND.recent = seed ? [seed] : [];
    }
    Sidebar.setOn(MOD_ID, 'rand', RAND.on);
    Sidebar.setLabel(MOD_ID, 'rand', RAND.on ? '开' : '关');
    var t = '随机播放：' + (RAND.on ? '开（' + RAND_POOL.length + ' 首池子，' + RAND.modeText() + '去重）' : '关');
    try { if (window.EJS_emulator && EJS_emulator.displayMessage) EJS_emulator.displayMessage(t); } catch (e) {}
    log('rand', RAND.on ? 'on' : 'off');
  }

  function showList() {
    ensureConfig().then(function () {
      var items = list.map(function (it) {
        return { code: it.code, note: it.note, current: it.code === curCode, _m: it };
      });
      Sidebar.openPanel('天使之翼2 自定义音乐', items, function (it) {
        playMapping(it._m, { skipStop: false });
      });
    });
  }

  function step(dir) {
    ensureConfig().then(function () {
      if (!list.length) return;
      var idx = -1;
      for (var i = 0; i < list.length; i++) if (list[i].code === curCode) { idx = i; break; }
      idx = (idx + dir + list.length) % list.length;
      playMapping(list[idx]);
    });
  }

  // ---------- 自定义音乐设置面板（列表 + 试听） ----------
  var P_CSS = `
  #ct2Set{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(90vw,380px);max-height:74vh;
    background:rgba(10,14,22,.97);border:1px solid rgba(255,255,255,.25);border-radius:12px;color:#eee;z-index:10070;
    display:none;flex-direction:column;box-shadow:0 12px 40px rgba(0,0,0,.65);font:13px/1.45 system-ui,sans-serif;overflow:hidden}
  #ct2Set .h{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.12);flex:0 0 auto}
  #ct2Set .h b{flex:1;color:#ffd54a;font-size:14px}
  #ct2Set .x{cursor:pointer;padding:2px 9px;border-radius:6px;background:rgba(255,255,255,.12);user-select:none}
  #ct2Set .x:active{transform:scale(.95)}
  #ct2Set .st{padding:8px 12px;color:#bbb;font-size:12px;border-bottom:1px solid rgba(255,255,255,.08);flex:0 0 auto}
  #ct2Set .st em{color:#7cc7ff;font-style:normal}
  #ct2Set .search{margin:8px 12px;padding:6px 8px;border-radius:7px;border:1px solid rgba(255,255,255,.2);flex:0 0 auto;
    background:rgba(255,255,255,.08);color:#fff;font-size:13px;outline:none}
  #ct2Set .log{flex:0 0 auto;min-height:34px;max-height:112px;overflow:auto;padding:6px 12px;border-bottom:1px solid rgba(255,255,255,.08);
    font:12px/1.6 ui-monospace,Consolas,monospace;color:#9aa;word-break:break-all}
  /* 手机（短边 ≤768，含横屏）不显示"最近写入日志" */
  #ct2Set.ct2-mobile .log{display:none}
  #ct2Set .list{flex:1 1 auto;min-height:100px;overflow:auto;padding:2px 6px 8px}
  #ct2Set .row{display:flex;gap:8px;align-items:center;padding:7px 8px;border-radius:7px;cursor:pointer}
  #ct2Set .row:hover{background:rgba(255,255,255,.1)}
  #ct2Set .row.cur{background:rgba(255,152,0,.22)}
  #ct2Set .code{font-family:monospace;color:#7cc7ff;min-width:30px}
  #ct2Set .src{font-family:monospace;color:#ffd54a;min-width:112px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #ct2Set .note{flex:1;color:#9aa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
  #ct2Set .play{color:#ffd54a;font-size:12px}
  #ct2Set .empty{color:#888;padding:10px;text-align:center}
  `;
  var panel = null, panelStatus = null, panelLog = null, panelList = null, panelSearch = null, panelFilter = '';

  function injectPanelCss() {
    if (document.getElementById('ct2-set-style')) return;
    var st = document.createElement('style');
    st.id = 'ct2-set-style';
    st.textContent = P_CSS;
    document.head.appendChild(st);
  }

  function ensurePanel() {
    if (panel) return panel;
    injectPanelCss();
    panel = document.createElement('div');
    panel.id = 'ct2Set';
    panel.innerHTML = '<div class="h"><b>天使之翼2 · 自定义音乐设置</b><span class="x" id="ct2SetClose">关闭</span></div>' +
      '<div class="st" id="ct2SetStatus"></div>' +
      '<div class="log" id="ct2SetLog"></div>' +
      '<input class="search" id="ct2SetSearch" placeholder="搜索曲目编号或名称，例如 58 / 片头">' +
      '<div class="list" id="ct2SetList"></div>';
    document.body.appendChild(panel);
    panelStatus = panel.querySelector('#ct2SetStatus');
    panelLog = panel.querySelector('#ct2SetLog');
    panelList = panel.querySelector('#ct2SetList');
    panelSearch = panel.querySelector('#ct2SetSearch');
    panel.querySelector('#ct2SetClose').addEventListener('click', function () { panel.style.display = 'none'; });
    panelSearch.addEventListener('input', function () {
      panelFilter = panelSearch.value.trim().toLowerCase();
      renderPanel();
    });
    return panel;
  }

  function renderPanel() {
    if (!panel) return;
    var srcNow = curFile ? (curFile + ' #' + curTrack) : '--';
    var status = '自动切换：' + (enabled ? '<em>开</em>' : '<em>关</em>') +
      '　共 ' + list.length + ' 首<br>' +
      '当前：编号 <em>' + (curCode || '--') + '</em>' +
      '　音轨 <em>' + srcNow + '</em>' +
      (curName ? '<br><span style="color:#9aa">' + curName + '</span>' : '') +
      '<br>最近写入：<em>' + (lastWriteVal >= 0 ? ('0x' + hex(lastWriteVal)) : '--') + '</em>' +
      (lastWriteVal >= 0 ? '（' + ((map && map[hex(lastWriteVal)]) ? (map[hex(lastWriteVal)].type === 'se' ? 'SE' : 'BGM') : '未映射') + '）' : '') +
      (seenUnmapped.length ? '<br>未映射值：<em>' + seenUnmapped.join(' ') + '</em>' : '');
    panelStatus.innerHTML = status;
    if (panelLog) {
      if (!writeLog.length) panelLog.textContent = '最近写入日志：（暂无）';
      else panelLog.innerHTML = '最近写入日志（新→旧）：<br>' + writeLog.map(function (e) {
        var c = e.type === 'STOP' ? '#e0a06a' : (e.type === '未映射' ? '#ffb74d' : (e.type === 'SE' ? '#9aa' : '#7cc7ff'));
        return '<span style="color:' + c + '">0x' + e.h + ' ' + e.type + '</span>';
      }).join(' · ');
    }

    var html = '';
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var fname = String(it.path).split('/').pop();
      if (panelFilter) {
        var hay = (it.code + ' ' + fname + ' #' + it.index + ' ' + String(it.note || '')).toLowerCase();
        if (hay.indexOf(panelFilter) === -1) continue;
      }
      n++;
      html += '<div class="row' + (it.code === curCode ? ' cur' : '') + '" data-i="' + i + '" title="' + it.path + '">' +
        '<span class="code">' + it.code + '</span>' +
        '<span class="src"></span>' +
        '<span class="note"></span>' +
        '<span class="play">试听 ▶</span></div>';
    }
    if (!n) html = '<div class="empty">没有匹配的曲目</div>';
    panelList.innerHTML = html;
    var notes = panelList.querySelectorAll('.note');
    var srcs = panelList.querySelectorAll('.src');
    var rows = panelList.querySelectorAll('.row');
    for (var k = 0; k < rows.length; k++) {
      var idx = +rows[k].getAttribute('data-i');
      var it2 = list[idx];
      srcs[k].textContent = String(it2.path).split('/').pop() + ' #' + it2.index;
      notes[k].textContent = it2.note || '';
      (function (mi) {
        rows[k].addEventListener('click', function () { previewTrack(list[mi]); });
      })(idx);
    }
  }

  function previewTrack(it) {
    if (!it || !it.path) return;
    ensureConfig().then(function () {
      return playMapping({ path: it.path, index: it.index || 0, code: it.code, note: it.note, name: it.name },
        { skipStop: !enabled });
    }).then(function () {
      renderPanel();
    }).catch(function (e) { console.error('[CT2] 试听失败', e); });
  }

  // 手机判定与悬浮条一致：短边 ≤768（竖屏/横屏都算）
  function isMobilePanel() {
    return Math.min(window.innerWidth, window.innerHeight) <= 768;
  }
  function syncPanelLayout() {
    if (!panel) return;
    panel.classList.toggle("ct2-mobile", isMobilePanel());
  }
  // 旋转屏幕/改窗口大小时跟着切换（面板开着才需要处理）
  window.addEventListener("resize", function () { if (panel && panel.style.display !== "none") syncPanelLayout(); });
  window.addEventListener("orientationchange", function () { if (panel) syncPanelLayout(); });

  function openSettings() {
    ensurePanel();
    panel.style.display = 'flex';
    syncPanelLayout();
    ensureConfig().then(function () { renderPanel(); });
  }

  // 「曲」按钮副标签的样式：SHOW_SETTINGS_SUB=false 时隐藏，true 时用 SETTINGS_SUB_CSS（留空则用框架默认样式）
  (function settingsSubStyle() {
    var s = document.createElement("style");
    s.id = "ct2-settings-sub-style";
    s.textContent = SHOW_SETTINGS_SUB ? SETTINGS_SUB_CSS : "#sb-ct2-settings .sb-sub{display:none}";
    (document.head || document.documentElement).appendChild(s);
  })();

  Sidebar.register({
    id: MOD_ID,
    mappers: MAPPERS,
    buttons: [
      { id: 'music', label: '音', sub: '关', title: '自定义音乐：开/关（GME 播放 NSF）', onClick: toggleMusic },
      { id: 'settings', label: '曲', sub: '--', title: '自定义音乐设置（曲目列表 / 试听）', onClick: openSettings },
      { id: 'rand', label: '随', sub: '关', title: '随机播放：开/关（游戏要播池内曲子时随机换一首，最近 2 首不重复）', onClick: toggleRand }
      // 后续给 特殊板卡 扩展操作时，在这里继续加按钮即可（框架自动渲染、自动折叠）。
      // 手动选曲/切歌仍保留在代码里（showList / step），需要时再挂回按钮。
    ],
    onStart: function (mapper) {
      log('mapper', mapper, 'ready', 'pref=' + loadPref(), 'rand=' + RAND.on);
      RAND.load();
      Sidebar.setOn(MOD_ID, 'rand', RAND.on);
      Sidebar.setLabel(MOD_ID, 'rand', RAND.on ? '开' : '关');
      if (loadPref() && !enabled) {
        enabled = true;
        Sidebar.setOn(MOD_ID, 'music', true);
        setTimeout(enableMusic, 600);   // 等 EJS 内存导出就绪
      }
    },
    onHide: function () { if (enabled) toggleMusic(); }
  });

  // 调试/自检钩子（不影响正常逻辑）
  window.__CT2 = {
    state: function () {
      return {
        enabled: enabled, curCode: curCode, curName: curName,
        hasNode: !!(gme && gme.node), ctx: (gme && gme.ctx ? gme.ctx.state : null),
        mappings: map ? Object.keys(map).length : 0, bgm: list.length,
        prefKey: gameKey(), prefOn: loadPref(), watch: watchMode, evCount: evCount, lastEv: lastEv, evVals: evVals.slice(-12), stopWrites: stopWrites, peak: +(gme && gme.peak || 0).toFixed(3), raw700: readRam(STOP_ADDR), randOn: RAND.on, randMode: RAND.mode, randRecent: RAND.recent.slice(), randPool: RAND_POOL.length, curTune: curTune
      };
    },
    rand: {
      pool: function () { return RAND_POOL.slice(); },
      recent: function () { return RAND.recent.slice(); },
      pick: function (exclude) { return RAND.pick(exclude, null); },
      set: function (on) { if (!!on !== RAND.on) toggleRand(); return RAND.on; },
      on: function () { return RAND.on; },
      mode: function () { return RAND.mode; },
      setMode: function (m) { return RAND.setMode(m); },
      setRecent: function (arr) { RAND.recent = (arr || []).slice(); return RAND.recent.slice(); },
      tuneUnique: function () { return TUNE_UNIQUE; },
      tuneCount: function () {
        var seen = {}, n = 0;
        for (var i = 0; i < RAND_POOL.length; i++) {
          var t = RAND.tuneOf(RAND_POOL[i]);
          if (t && !seen[t]) { seen[t] = 1; n++; }
        }
        return n;
      }
    },
    simulate: function (v) { handleValue(v); },
    mappingOf: function (code) { return map ? map[code] : null; }
  };
})();
