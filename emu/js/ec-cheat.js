// ec-cheat.js — FC 版 EC 金手指支持（解析器移植自 FC emucheat.js，应用层走 EmulatorJS setCheat）
// 用法：把 EC 码文件放到 emu/emucheat/*.cht 并登记到 emucheat/list.json，
//       游戏载入后点悬浮条「金」打开面板：选择 cht → 勾选金手指 → 「应用金手指」生效。
//       （localStorage 记忆 游戏名→cht 关联，下次载入同一游戏自动勾选，仍需点一次应用）
// 原理：EC 码转 fceumm 能识别的 raw 码 "AAAA:VV"（4 位地址 + ':' + 2 位值，8 位写入），
//       经 gameManager.setCheat 交给核心每帧写入。fceumm 的 retro_cheat_set 只认
//       **正好 7 个字符且第 4 位是 ':'** 的串（源码：`codepart_len == 7 && codepart[4]==':'`），
//       所以地址统一补成 4 位十六进制。
//       注意：EC 地址不是直接当 CPU 地址用——0x0800-0x27FF 是卡带 WRAM 的“缓冲偏移”，
//       要 +0x5800 折回 $6000-$7FFF（见下面 ecToCpuAddr；FF2/重装机兵等 cht 全靠这条）。
(function () {
  'use strict';

  // ========== EC cht 解析器（移植自 FC emucheat.js，纯逻辑） ==========

  // EC 码文件编码不统一：UTF-16LE（带 BOM）、GBK/ANSI、UTF-8 都有，按 BOM/试探解码
  function decodeChtText(buffer) {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8);
    if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8);
    if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return new TextDecoder('utf-8').decode(u8);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { /* 非 UTF-8 */ }
    try { return new TextDecoder('gbk').decode(u8); } catch (e) { /* 非 GBK */ }
    return new TextDecoder('utf-8').decode(u8);
  }

  // 解析一组 EC 码串 "addr,v1,v2;addr,v1,v2"：
  // 逗号 = 从地址起连续写多字节，分号 = 多组。
  // 这里保留 cht 里写的原始地址，WRAM 偏移的 +0x5800 折算在 codesToCore 里统一做。
  // ========== 地址处理 ==========
  // EC 的 FC 码地址在多数 cht 里是“内存缓冲偏移”而不是 CPU 地址（参考 NES.emu Cheats.cc，
  // 经最终幻想2 金钱/HP 码实测确认）：
  //   0x0000-0x07FF = 内部 RAM（与 CPU 地址一致）
  //   0x0800-0x27FF = 卡带 WRAM/SRAM，紧跟在内部 RAM 之后连续排布
  //                   → 折算回 CPU 地址要 +0x5800（0x081E → $601E）
  //   >= 0x2800    = 已经是 CPU 地址，原样使用
  // 不折算的话，FF2 这类整份 cht 都在 0x8xx-0x9xx 的游戏会全部写到内部 RAM，
  // 表现就是“金手指部分无效/完全无效”。
  const ADDR_LIMIT = 0x10000;   // 超过 0xFFFF 的码视为无效
  function ecToCpuAddr(a) {
    if (a < 0x800) return a;           // 内部 RAM
    if (a < 0x2800) return a + 0x5800; // 卡带 WRAM → $6000-$7FFF
    return a;                          // 已是 CPU 地址
  }
  function normalizeAddr(addr) {
    return addr >>> 0;
  }
  function parseCodeStr(str, stat) {
    const codes = [];
    for (const seg of str.split(';')) {
      const parts = seg.split(',');
      const addrStr = parts[0].trim();
      if (!addrStr) continue;
      const addr = parseInt(addrStr, 16);
      if (!isFinite(addr) || addr < 0 || addr > 0xffffffff) { stat.skipped++; continue }
      // 这里保留 cht 里写的原始地址，换算在 codesToCore 里做
      for (let i = 1; i < parts.length; i++) {
        const t = parts[i].trim();
        if (!t) continue;
        const v = parseInt(t, 16);
        if (!isFinite(v) || v < 0 || v > 0xff) continue;
        codes.push({ address: addr, offset: i - 1, value: v });
      }
    }
    return codes;
  }

  // 解析整份 cht 文本 → { cheats: [{name, options:[{label, codes}]}], skipped }
  // options[0].label === '' 为开关型（ON= 行）；其余为单选型（「名称=码」行）
  function parseChtText(text) {
    text = String(text).replace(/，/g, ',').replace(/；/g, ';').replace(/＝/g, '=').replace(/　/g, ' ');
    const cheats = [];
    const stat = { skipped: 0 };
    let cur = null;
    for (const raw of String(text).split(/\r\n|\n|\r/)) {
      const line = raw.replace(/^\uFEFF/, '').trim();
      if (!line) continue;
      if (line.charAt(0) === '[' && line.charAt(line.length - 1) === ']') {
        const name = line.slice(1, -1).trim();
        cur = name ? { name: name, options: [] } : null;
        if (cur) cheats.push(cur);
        continue;
      }
      if (!cur) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      const codes = val ? parseCodeStr(val, stat) : [];
      const keyUpper = key.toUpperCase();
      if (/^OFF[0-9]*$/.test(keyUpper)) continue;   // Off 恢复值行：不参与锁定
      if (!codes.length) continue;        // 空码行（GameInfo 等元数据）
      if (/^ON[0-9]*$/.test(keyUpper)) {
        // 开关型：ON / ON2 / ON3… 多行合并到首个空 label 选项
        if (!cur.options.length || cur.options[0].label !== '') cur.options.unshift({ label: '', codes: [] });
        cur.options[0].codes = cur.options[0].codes.concat(codes);
      } else {
        cur.options.push({ label: key, codes: codes });
      }
    }
    return {
      cheats: cheats.filter(function (c) { return c.options.some(function (o) { return o.codes.length; }); }),
      skipped: stat.skipped
    };
  }

  // ========== EC 码 → fceumm 的 PAR 代码串（"AAAAAA:VV"，8 位写入） ==========
  function gmOK() {
    return window.EJS_emulator && EJS_emulator.started && EJS_emulator.gameManager;
  }

  // 每个字节一条 8 位写入码（fceumm 的 raw 码本身就是 8 位写入）。
  // 关键：fceumm 只认"正好 7 个字符 + 第 4 位是 ':''"的串（AAAA:VV），所以地址补 4 位。
  function codesToCore(codes) {
    const out = [];
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      const addr = ecToCpuAddr(normalizeAddr(c.address + c.offset));
      if (addr >= ADDR_LIMIT) continue;   // 超过 0xFFFF 的码跳过
      const hexAddr = ("0000" + addr.toString(16).toUpperCase()).slice(-4);
      const hexV = ("00" + c.value.toString(16).toUpperCase()).slice(-2);
      out.push(hexAddr + ":" + hexV);
    }
    return out;
  }

  // ========== 面板状态 ==========
  var panelEl = null;
  var listEl = null;
  var statusEl = null;
  var selectEl = null;
  var searchEl = null;      // 搜索框
  var countEl = null;       // “匹配 N / 总 M”
  var searchTimer = null;
  var itemsBox = null;
  var GAMES_CHEATS = null; // 解析后的条目 [{name, options, enabled, selected}]
  var currentGame = "";

  function currentGameName() {
    try {
      var c = EJS_emulator.config || {};
      return String(c.gameName || "");
    } catch (e) { return ""; }
  }

  function setStatus(text, cls) {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.className = "ecc-status" + (cls ? " " + cls : "");
    }
  }

  function saveAssoc(name, cht) {
    try {
      var m = JSON.parse(localStorage.getItem("ecc_assoc") || "{}");
      if (cht) m[name] = cht; else delete m[name];
      localStorage.setItem("ecc_assoc", JSON.stringify(m));
    } catch (e) {}
  }
  function getAssoc(name) {
    try { return JSON.parse(localStorage.getItem("ecc_assoc") || "{}")[name] || null; } catch (e) { return null; }
  }

  // ---------- 应用（reset + 重放全部启用条目） ----------
  function applyCheats() {
    if (!gmOK()) { setStatus("请先载入游戏。", "err"); return; }
    if (!GAMES_CHEATS) { setStatus("还没有载入金手指文件。", "err"); return; }
    var gm = EJS_emulator.gameManager;
    gm.resetCheat();
    var idx = 0;
    var applied = 0;
    var MAX = 2000;   // FC 的 cht 常有成百上千字节的批量写入，上限放大
    GAMES_CHEATS.forEach(function (item) {
      if (!item.enabled) return;
      var codes = [];
      if (item.options.length === 1 && item.options[0].label === "") {
        codes = item.options[0].codes;
      } else if (item.selected >= 0 && item.selected < item.options.length) {
        codes = item.options[item.selected].codes;
      }
      codesToCore(codes).forEach(function (one) {
        if (idx < MAX) { gm.setCheat(idx++, 1, one); applied++; }
      });
    });
    setStatus("已应用 " + applied + " 条金手指（核心每帧写入）。刷新页面后需重新应用。", "ok");
    // 方便校准：把实际写下去的地址/值打到控制台（前 8 条）
    try {
      var preview = [];
      GAMES_CHEATS.forEach(function (item) {
        if (!item.enabled || preview.length >= 8) return;
        var codes = (item.options.length === 1 && item.options[0].label === "")
          ? item.options[0].codes
          : (item.selected >= 0 ? item.options[item.selected].codes : []);
        codesToCore(codes).forEach(function (one) {
          if (preview.length < 8) preview.push(one.trim());
        });
      });
      console.log("[EC] 生效代码示例（fceumm raw 码 AAAA:VV）: " + preview.join("  "));
    } catch (e) { }
  }

  function clearCheats() {
    // 仅取消面板勾选；实际生效/清除由「应用金手指」按当前勾选统一处理
    GAMES_CHEATS.forEach(function (item) { item.enabled = false; });
    renderItems();
    setStatus("已取消全部勾选。勾选需要的金手指后点「应用金手指」生效。", "ok");
  }

  // ---------- cht 载入与面板渲染 ----------
  function loadCht(name) {
    if (!name) return;
    setStatus("正在载入 " + name + " ...");
    var _ver = listVerOf(name);
    fetch("emucheat/" + encodeURIComponent(name) + (_ver ? "?v=" + _ver : ""))
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); })
      .then(function (buf) {
        var parsed = parseChtText(decodeChtText(buf));
        if (!parsed.cheats.length) { setStatus(name + " 中没有可用的金手指（跳过 " + parsed.skipped + " 条）。", "err"); return; }
        var game = currentGameName();
        GAMES_CHEATS = parsed.cheats.map(function (c) {
          return {
            name: c.name,
            options: c.options,
            enabled: false,
            selected: 0, // 单选型默认选中第一个选项
          };
        });
        saveAssoc(game, name);
        // 下拉跟着已载入的文件走（手动选、回车载入、自动载入都算）
        if (selectEl) selectEl.value = name;
        renderItems();
        setStatus("已载入 " + name + "：共 " + GAMES_CHEATS.length + " 条金手指。勾选后点「应用金手指」。", "ok");
      })
      .catch(function (e) {
        setStatus("载入失败：" + e.message, "err");
      });
  }

  function renderItems() {
    itemsBox.innerHTML = "";
    GAMES_CHEATS.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "ecc-item";

      var label = document.createElement("label");
      label.className = "ecc-item-label";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!item.enabled;
      cb.addEventListener("change", function () {
        item.enabled = cb.checked;
      });
      label.appendChild(cb);
      var nameSpan = document.createElement("span");
      nameSpan.textContent = item.name;
      label.appendChild(nameSpan);
      row.appendChild(label);

      if (item.options.length > 1) {
        var sel = document.createElement("select");
        item.options.forEach(function (o, oi) {
          var opt = document.createElement("option");
          opt.value = oi;
          opt.textContent = o.label || "(默认)";
          sel.appendChild(opt);
        });
        sel.value = String(item.selected);
        sel.addEventListener("change", function () {
          item.selected = parseInt(sel.value, 10);
        });
        row.appendChild(sel);
      }
      itemsBox.appendChild(row);
    });
  }
  // 清单与 FC 站同一套格式：裸数组 [{name, file, v}]（gen_list.py 生成）；这里同时兼容 {"list":[...]} 和纯文件名字符串
  var LIST_ITEMS = [];
  function listVerOf(file) {
    for (var i = 0; i < LIST_ITEMS.length; i++) {
      if (LIST_ITEMS[i].file === file && LIST_ITEMS[i].v) return LIST_ITEMS[i].v;
    }
    return "";
  }

  // 中文别名 → 英文关键字：emtcheat 目录里 1700 多个 cht 基本都是英文名（Contra (J).cht 这种），
  // 直接打中文搜不到，这里做一层常见译名映射，输入任一侧都能命中。
  var NAME_ALIAS = [
    ["热血足球3", "nekketsu soccer"], ["热血足球", "nekketsu soccer"], ["热血足球联盟", "nekketsu soccer"],
    ["热血物语", "nekketsu monogatari"], ["热血格斗", "nekketsu kakutou"], ["热血进行曲", "nekketu koushin"],
    ["魂斗罗", "contra"], ["超级魂斗罗", "super contra"], ["马里奥", "mario"], ["超级玛丽", "mario"],
    ["塞尔达", "zelda"], ["天使之翼", "captain tsubasa"], ["足球小将", "captain tsubasa"],
    ["最终幻想", "final fantasy"], ["勇者斗恶龙", "dragon quest"], ["吞食天地", "tenchi wo kurau"],
    ["重装机兵", "metal max"], ["冒险岛", "adventure island"], ["双截龙", "double dragon"],
    ["热血", "kunio"], ["忍者龙剑传", "ninja gaiden"], ["赤影战士", "kage"], ["水上魂斗罗", "kage"],
    ["松鼠大作战", "chip 'n dale"], ["三目童子", "mitsume ga tooru"], ["沙罗曼蛇", "salamander"],
    ["绿色兵团", "green beret"], ["恶魔城", "castlevania"], ["洛克人", "mega man"], ["忍者神龟", "teenage mutant"],
    ["街头霸王", "street fighter"], ["快打旋风", "final fight"], ["炸弹人", "bomberman"],
    ["高桥名人", "takahashi"], ["影子传说", "kage no densetsu"], ["火之鸟", "hi no tori"],
    ["宇宙巡航机", "gradius"], ["赤色要塞", "jackal"], ["兵蜂", "twinbee"], ["摩托", "moto"],
    ["越野", "rc pro am"], ["街头快打", "mighty final fight"], ["怒", "ikari"],
    ["游戏王", "yu-gi-oh"], ["机器人大战", "super robot"], ["牧场物语", "harvest moon"],
    ["三国志", "sangokushi"], ["封神榜", "feng shen bang"], ["荆轲新传", "jing ke"],
    ["圣斗士", "saint seiya"], ["北斗神拳", "hokuto no ken"], ["七龙珠", "dragon ball"],
    ["幽游白书", "yu yu hakusho"], ["灌篮高手", "slam dunk"], ["足球", "soccer"]
  ];

  // 单个关键词 → 候选词（原文 + 中文别名的英文/英文别名的中文）
  function expandTerm(term) {
    var out = [term];
    for (var i = 0; i < NAME_ALIAS.length; i++) {
      var cn = NAME_ALIAS[i][0], en = NAME_ALIAS[i][1];
      // 只在“完全等于某个别名”时展开，避免「热血足球3」被拆成 soccer/kunio 反而搜出一堆
      if (term === cn) out.push(en);
      if (term === en) out.push(cn);
    }
    return out;
  }

  // 关键词匹配（拆词 + 加权打分）：
  //   拆词（空格/全角空格）→ 每个词都要命中（AND）→ 完全相等 > 前缀 > 包含，得分累加后排序
  function scoreItem(it, terms) {
    var name = String(it.name || "").toLowerCase();
    var file = String(it.file || "").toLowerCase();
    var cn = String(it.c || "").toLowerCase();
    var tx = String(it.t || "").toLowerCase();
    var score = 0;
    for (var i = 0; i < terms.length; i++) {
      var cands = expandTerm(terms[i]);
      var best = -1;
      for (var c = 0; c < cands.length; c++) {
        var w = cands[c], s = -1;
        if (name === w) s = 100;
        else if (name.indexOf(w) === 0) s = 60;
        else if (name.indexOf(w) >= 0) s = 30;
        else if (cn === w) s = 90;
        else if (cn.indexOf(w) === 0) s = 50;
        else if (cn.indexOf(w) >= 0) s = 25;
        else if (tx.indexOf(w) >= 0) s = 8;
        else if (file.indexOf(w) >= 0) s = 6;
        if (s > best) best = s;
      }
      if (best < 0) return -1;           // 这个词一个候选都没命中就淘汰
      score += best;
    }
    return score;
  }

  function renderOptions(keyword) {
    var kw = String(keyword || "").trim().toLowerCase();
    var terms = kw ? kw.split(/[\s\u3000]+/).filter(Boolean) : [];
    var list = LIST_ITEMS;
    if (terms.length) {
      var hit = [];
      LIST_ITEMS.forEach(function (it) {
        var sc = scoreItem(it, terms);
        if (sc >= 0) hit.push({ it: it, sc: sc });
      });
      hit.sort(function (a, b) { return b.sc - a.sc || a.it.name.localeCompare(b.it.name, "zh-Hans-CN"); });
      list = hit.map(function (x) { return x.it; });
    }
    var keep = selectEl.value;
    var frag = document.createDocumentFragment();
    list.forEach(function (it) {
      var opt = document.createElement("option");
      opt.value = it.file;
      opt.textContent = it.c ? (it.name + " ｜ " + it.c) : it.name;
      frag.appendChild(opt);
    });
    selectEl.innerHTML = "";
    selectEl.appendChild(frag);
    if (keep && list.some(function (it) { return it.file === keep; })) selectEl.value = keep;
    if (countEl) {
      countEl.textContent = terms.length
        ? "匹配 " + list.length + " / " + LIST_ITEMS.length
        : "共 " + LIST_ITEMS.length + " 个游戏";
      countEl.style.color = (terms.length && !list.length) ? "#e0a06a" : "";
    }
  }

  function loadList() {
    fetch("emucheat/list.json?v=" + (window.EC_LIST_VER || "0"))
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) {
        var raw = Array.isArray(j) ? j : ((j && j.list) || []);
        LIST_ITEMS = raw.map(function (it) {
          if (typeof it === "string") return { file: it, name: it.replace(/\.[^.]+$/, ""), v: "" };
          return {
            file: it.file,
            name: it.name || String(it.file).replace(/\.[^.]+$/, ""),
            v: it.v || "",
            c: it.c || "",       // 中文名（来自 cn_index.json）
            t: it.t || ""        // 描述片段
          };
        });
        var game = currentGameName();
        // 全部条目已经就位，交给 renderOptions 渲染（默认全量 + 当前游戏自动选中）
        renderOptions("");
        if (searchEl) { searchEl.disabled = false; searchEl.placeholder = "游戏名/中文名/描述（空格分词），回车载入"; }
        var assoc = getAssoc(game);
        if (assoc && LIST_ITEMS.some(function (it) { return it.file === assoc; })) selectEl.value = assoc;
        else if (game) {
          var auto = LIST_ITEMS.find(function (it) {
            return it.name === game || it.file.replace(/\.[^.]+$/, "") === game ||
              (it.c && it.c.indexOf(game) >= 0);
          });
          if (!auto) {
            // 中文 ROM 名 → 别名英文关键字，找第一个包含它的 cht（Contra (J) / Contra (U) 取前者）
            var g = String(game).toLowerCase();
            var alias = NAME_ALIAS.filter(function (p) { return g.indexOf(p[0]) >= 0; })[0];
            if (alias) {
              var en = alias[1];
              auto = LIST_ITEMS.find(function (it) { return it.name.toLowerCase().indexOf(en) >= 0; });
            }
          }
          if (auto) selectEl.value = auto.file;
        }
      })
      .catch(function () { selectEl.innerHTML = "<option>（清单读取失败）</option>"; });
  }
// ---------- 面板 DOM ----------
  function ensurePanel() {
    if (panelEl) return;
    var style = document.createElement("style");
  style.textContent = `
#eccPanel { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); width:640px; max-width:calc(100vw - 32px); max-height:calc(100vh - 48px);
  display:none; flex-direction:column; z-index:10070; background:rgba(14,20,30,.97); border:1px solid rgba(72,120,220,.4);
  border-radius:12px; padding:16px; box-shadow:0 10px 40px rgba(0,0,0,.7); color:#e8eef5; box-sizing:border-box;
  font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif; }
#eccPanel h3 { margin:0 0 10px; font-size:16px; color:#8ab4ff; }
#eccPanel .ecc-row { display:flex; gap:8px; margin-bottom:8px; align-items:center; }
#eccPanel .ecc-search-row { margin-bottom:6px; }
#eccPanel .ecc-search-row input { flex:1; padding:8px 10px; border:1px solid rgba(72,120,220,.4); border-radius:6px; background:#141c28; color:#e8eef5; font-size:13.5px; min-width:0; }
#eccPanel .ecc-search-row input:focus { border-color:#4a82ff; }
#eccPanel .ecc-search-row input:disabled { opacity:.55; cursor:not-allowed; }
#eccPanel .ecc-count { font-size:12.5px; color:#8b9bb3; white-space:nowrap; }
#eccPanel select, #eccPanel input { flex:1; padding:7px 9px; border:1px solid rgba(72,120,220,.4); border-radius:6px;
  background:#141c28; color:#e8eef5; font-size:13.5px; min-width:0; }
#eccPanel button { padding:7px 14px; border:none; border-radius:6px; color:#fff; font-size:13.5px; cursor:pointer; }
#eccPanel .ecc-load { background:#2e6bff; }
#eccPanel .ecc-apply { background:#2f9e6e; }
#eccPanel .ecc-clear { background:#b3452e; }
#eccPanel .ecc-close { background:#2a3a52; }
#eccItems { overflow-y:auto; flex:1; min-height:160px; margin:8px 0; border:1px solid rgba(72,120,220,.2); border-radius:8px; padding:4px; }
.ecc-item { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 8px; border-bottom:1px dashed rgba(72,120,220,.15); }
.ecc-item-label { display:flex; align-items:center; gap:10px; font-size:14px; cursor:pointer; overflow:hidden; }
.ecc-item-label span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ecc-item select { flex:0 0 auto; max-width:200px; }
.ecc-status { margin-top:8px; padding:8px 10px; border-radius:6px; background:#141c28; border-left:3px solid #6a7886; font-size:12.5px; color:#b7c2cb; min-height:16px; }
.ecc-status.ok { border-left-color:#35c07a; }
.ecc-status.err { border-left-color:#e05555; }
  `;
    document.head.appendChild(style);

    panelEl = document.createElement("div");
    panelEl.id = "eccPanel";
    panelEl.innerHTML =
      '<h3>EC 金手指</h3>' +
      '<div class="ecc-row ecc-search-row">' +
      '<input id="eccSearch" type="search" autocomplete="off" placeholder="搜索游戏名 / 文件名，回车载入" disabled>' +
      '<span class="ecc-count" id="eccCount"></span></div>' +
      '<div class="ecc-row"><select id="eccSelect"></select>' +
      '<button class="ecc-load" id="eccLoadBtn" type="button">载入</button></div>' +
      '<div id="eccItems"></div>' +
      '<div class="ecc-row" style="flex-wrap:wrap;">' +
      '<button class="ecc-apply" id="eccApplyBtn" type="button">应用金手指</button>' +
      '<button class="ecc-clear" id="eccClearBtn" type="button">全部取消</button>' +
      '<button class="ecc-close" id="eccCloseBtn" type="button">关闭</button></div>' +
      '<div class="ecc-status" id="eccStatus">勾选金手指后点「应用金手指」。</div>';
    document.body.appendChild(panelEl);

    selectEl = document.getElementById("eccSelect");
    itemsBox = document.getElementById("eccItems");
    statusEl = document.getElementById("eccStatus");

    searchEl = document.getElementById("eccSearch");
    countEl = document.getElementById("eccCount");
    searchEl.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { renderOptions(searchEl.value); }, 120);
    });
    searchEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(searchTimer);
        renderOptions(searchEl.value);
        if (selectEl.value) loadCht(selectEl.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        searchEl.value = "";
        renderOptions("");
        searchEl.blur();
      }
    });
    document.getElementById("eccLoadBtn").addEventListener("click", function () { loadCht(selectEl.value); });
    document.getElementById("eccApplyBtn").addEventListener("click", applyCheats);
    document.getElementById("eccClearBtn").addEventListener("click", clearCheats);
    document.getElementById("eccCloseBtn").addEventListener("click", function () { panelEl.style.display = "none"; });
    loadList();
  }

  function openPanel() {
    ensurePanel();
    currentGame = currentGameName();
    panelEl.style.display = "flex";
    // 该游戏之前关联过 cht 的话，下拉先切到它（否则列表加载完会自动选中别的同系游戏，
    // 出现“金手指载入对了、下拉却显示另一个文件”的情况）
    var assoc = getAssoc(currentGame);
    if (assoc && selectEl) selectEl.value = assoc;
    if (gmOK() && !GAMES_CHEATS && assoc) loadCht(assoc);
    if (!gmOK()) setStatus("请先载入游戏。", "err");
  }

  // ---------- 控制台工具 ----------
  window.ECCheat = {
    open: openPanel,
    write: function (addrHex, values) { // EC.write('0201F40A','63,63') 一次性写入
      if (!gmOK()) { console.error("游戏未运行"); return; }
      var gm = EJS_emulator.gameManager;
      var codes = parseCodeStr(addrHex + "," + values, { skipped: 0 });
      var list = codesToCore(codes);
      list.forEach(function (one, i) { gm.setCheat(i, 1, one); });
      console.log("已写入 " + codes.length + " 字节（" + list.map(function (s) { return s.trim(); }).join(", ") + "），每帧锁定中。ECCheat.unlock() 解除。");
    },
    unlock: function () {
      if (gmOK()) EJS_emulator.gameManager.resetCheat();
      console.log("已解除全部金手指。");
    },
  };
})();
