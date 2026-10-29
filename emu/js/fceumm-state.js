/*
 * fceumm-state.js — WebFC 服务端「导入V」用的浏览器版转换库（自动生成，勿手改）
 * 生成源：Other/261027-fcstateswap/lib/fcsfmt.js + fceumm_schema.json
 * 重新生成：node build_browser_lib.js
 *
 * 暴露 window.FceummState = { FCS_VERSION, unwrap, wrapRastate, parseFcs, webStateToFcs }
 * 只包含 FCS 解析 / RASTATE 容器 / web 通用状态 -> FCEUmm FCS 的构造；
 * VirtuaNES .st0 的解析在 vnesconv.js（window.VnesConv）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FceummState = factory();
})(typeof self !== 'undefined' ? self : this, function () {
/*
 * fcsfmt.js — FCEUmm/FCEUX 状态字节流（FCS）与 WebFC 备份外层 RASTATE 容器的
 *             纯格式层：解析、构造、RASTATE 剥壳/套壳。
 *             不依赖任何外部模块（浏览器里可直接内联，见 build_browser_lib.js）。
 *
 * FCS 字节流（fceumm 0.98.13 系，真机存档实测）：
 *   16 字节头：'F','C','S',0xFF, u32le totalsize, u32le version(=9813)
 *   之后：反复 { u8 type; u32le size; data[size] }
 *     type 1=CPU 2=CPU附加 3=PPU 4=手柄 5=APU 0x10=mapper
 *   data 内：反复 { char desc[4]（右补\0）; u32le size; data[size] }
 *
 * RASTATE 容器（WebFC 备份下载里见到的外层）：
 *   'RASTATE'(7) + 0x01 + 'MEM ' + u32le size + <FCS> + 4 对齐补 0 + 'END ' + u32le 0
 */
'use strict';

var FCS_VERSION = 9813;
var RA_MAGIC = 'RASTATE';

// ---------------- 基础工具 ----------------
function u16le(b, o) { return b[o] | (b[o + 1] << 8); }
function u32le(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
function w16le(b, o, v) { b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; }
function w32le(b, o, v) { b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; b[o + 2] = (v >> 16) & 0xff; b[o + 3] = (v >> 24) & 0xff; }

function toU8(buf) {
  if (buf instanceof Uint8Array) return buf;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buf)) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return new Uint8Array(buf);
}
function b64decode(s) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  var bin = atob(s), u = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function ascii(u8, off, n) {
  var s = '';
  for (var i = 0; i < n; i++) s += String.fromCharCode(u8[off + i]);
  return s;
}

// ---------------- 模板（从真实 fceumm 存档提取；非映射字段用它的值当“安全默认值”） ----------------
var SCHEMA = {"fcsVersion":9813,"chunkOrder":[1,2,3,4,5,16],"fields":{"1":[{"n":"PC","s":2},{"n":"A","s":1},{"n":"X","s":1},{"n":"Y","s":1},{"n":"S","s":1},{"n":"P","s":1},{"n":"DB","s":1},{"n":"RAM","s":2048}],"2":[{"n":"JAMM","s":1},{"n":"IQLB","s":4},{"n":"ICoa","s":4},{"n":"ICou","s":4},{"n":"TSBS","s":8},{"n":"MooP","s":1}],"3":[{"n":"NTAR","s":2048},{"n":"PRAM","s":32},{"n":"SPRA","s":256},{"n":"PPUR","s":4},{"n":"KOOK","s":1},{"n":"DEAD","s":1},{"n":"PSPL","s":1},{"n":"XOFF","s":1},{"n":"VTGL","s":1},{"n":"RADD","s":2},{"n":"TADD","s":2},{"n":"VBUF","s":1},{"n":"PGEN","s":1}],"4":[{"n":"JYRB","s":2},{"n":"JOYS","s":4},{"n":"LSTS","s":1}],"5":[{"n":"FHCN","s":4},{"n":"FCNT","s":1},{"n":"PSG","s":16},{"n":"ENCH","s":1},{"n":"IQFM","s":1},{"n":"NREG","s":2},{"n":"TRIM","s":1},{"n":"TRIC","s":1},{"n":"E0SP","s":1},{"n":"E1SP","s":1},{"n":"E2SP","s":1},{"n":"E0MO","s":1},{"n":"E1MO","s":1},{"n":"E2MO","s":1},{"n":"E0D1","s":1},{"n":"E1D1","s":1},{"n":"E2D1","s":1},{"n":"E0DV","s":1},{"n":"E1DV","s":1},{"n":"E2DV","s":1},{"n":"LEN0","s":4},{"n":"LEN1","s":4},{"n":"LEN2","s":4},{"n":"LEN3","s":4},{"n":"SWEE","s":2},{"n":"CRF1","s":4},{"n":"CRF2","s":4},{"n":"SWCT","s":2},{"n":"SIRQ","s":1},{"n":"5ACC","s":4},{"n":"5BIT","s":1},{"n":"5ADD","s":4},{"n":"5SIZ","s":4},{"n":"5SHF","s":1},{"n":"5VDM","s":1},{"n":"5VSP","s":1},{"n":"5SZL","s":1},{"n":"5ADL","s":1},{"n":"5FMT","s":1},{"n":"RWDA","s":1},{"n":"SAC1","s":4},{"n":"SAC2","s":4},{"n":"RCD1","s":4},{"n":"RCD2","s":4},{"n":"TRIS","s":4},{"n":"TACC","s":4},{"n":"NACC","s":4},{"n":"CBC1","s":4},{"n":"CBC2","s":4},{"n":"CBC3","s":4},{"n":"CBC4","s":4},{"n":"CBC5","s":4},{"n":"SNTS","s":4},{"n":"TSOF","s":4},{"n":"WLC1","s":4},{"n":"WLC2","s":4},{"n":"WLC3","s":4},{"n":"WLC4","s":4},{"n":"FAC1","s":8},{"n":"FAC2","s":8},{"n":"TCOU","s":4},{"n":"WAVE","s":128}],"16":[{"n":"WRAM","s":16384},{"n":"REGS","s":8},{"n":"CMD","s":1},{"n":"A000","s":1},{"n":"A001","s":1},{"n":"IRQR","s":1},{"n":"IRQC","s":1},{"n":"IRQL","s":1},{"n":"IRQA","s":1},{"n":"CHRR","s":4096},{"n":"M5KX","s":4096}]},"defaultsB64":{"2":"SkFNTQEAAAAASVFMQgQAAAAAAAAASUNvYQQAAAABAAAASUNvdQQAAACA////VFNCUwgAAAB8LdQOAAAAAE1vb1ABAAAAIQ==","4":"SllSQgIAAAAIAEpPWVMEAAAAAAAAAExTVFMBAAAAAA==","5":"RkhDTgQAAADQDwIARkNOVAEAAAABUFNHABAAAAAwCA2ZMAgamjAAChkwCA+YRU5DSAEAAAAPSVFGTQEAAAABTlJFRwIAAADHeFRSSU0BAAAAAFRSSUMBAAAAAEUwU1ABAAAAAEUxU1ABAAAAAEUyU1ABAAAAAEUwTU8BAAAAA0UxTU8BAAAAA0UyTU8BAAAAA0UwRDEBAAAAAUUxRDEBAAAAAUUyRDEBAAAAAUUwRFYBAAAADUUxRFYBAAAADUUyRFYBAAAADkxFTjAEAAAAEgAAAExFTjEEAAAAEgAAAExFTjIEAAAAAAAAAExFTjMEAAAAEgAAAFNXRUUCAAAAAABDUkYxBAAAAA0BAABDUkYyBAAAABoCAABTV0NUAgAAAAEBU0lSUQEAAAAANUFDQwQAAAAGAAAANUJJVAEAAAAFNUFERAQAAACGQAAANVNJWgQAAAAAAAAANVNIRgEAAAAANVZETQEAAAAANVZTUAEAAAAANVNaTAEAAAAMNUFETAEAAAAANUZNVAEAAAAPUldEQQEAAABcU0FDMQQAAACqaJgAU0FDMgQAAADWUv8FUkNEMQQAAAADAAAAUkNEMgQAAAABAAAAVFJJUwQAAAAOAAAAVEFDQwQAAABAPckATkFDQwQAAAB45u8RQ0JDMQQAAAAFAAAAQ0JDMgQAAAAFAAAAQ0JDMwQAAAAFAAAAQ0JDNAQAAAAFAAAAQ0JDNQQAAAAFAAAAU05UUwQAAAAAAAAAVFNPRgQAAAALAAAAV0xDMQQAAAAACAAAV0xDMgQAAAAACAAAV0xDMwQAAAABAAAAV0xDNAQAAAAACAAARkFDMQgAAACALt9OAAAAAEZBQzIIAAAAAfj///////9UQ09VBAAAAAMAAABXQVZFgAAAAC4JAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"},"jyrbB64":"CAA=","ppuDefaults":{"KOOK":"AA==","DEAD":"AA==","PSPL":"AA==","PGEN":"AA=="},"a001B64":"LA=="};
var DEFAULTS = {};
(function () {
  for (var k in SCHEMA.defaultsB64) DEFAULTS[+k] = b64decode(SCHEMA.defaultsB64[k]);
  DEFAULTS.ppu = {};
  for (var k2 in SCHEMA.ppuDefaults) DEFAULTS.ppu[k2] = b64decode(SCHEMA.ppuDefaults[k2]);
  DEFAULTS.jyrb = b64decode(SCHEMA.jyrbB64);
  DEFAULTS.a001 = b64decode(SCHEMA.a001B64);
})();

// ---------------- RASTATE 容器 ----------------
function findFcsOffset(u8) {
  var lim = Math.min(u8.length - 3, 64);
  for (var i = 0; i < lim; i++) {
    if (u8[i] === 0x46 && u8[i + 1] === 0x43 && u8[i + 2] === 0x53 && u8[i + 3] === 0xFF) return i;
  }
  return -1;
}

// 剥掉 RASTATE 外壳（如果存在）；返回 { fcs, wrapped }
function unwrap(u8) {
  u8 = toU8(u8);
  if (u8.length >= 8 && ascii(u8, 0, 7) === RA_MAGIC) {
    var off = findFcsOffset(u8);
    if (off < 0) throw new Error('RASTATE 容器里没找到 FCS 状态数据');
    var memOff = 8;                       // 'RASTATE'(7) + 1 字节版本号
    if (ascii(u8, memOff, 4) !== 'MEM ') throw new Error('RASTATE 容器缺少 MEM 块');
    var size = u32le(u8, memOff + 4);
    if (off + size > u8.length) throw new Error('RASTATE MEM 块长度越界');
    return { fcs: u8.subarray(off, off + size), wrapped: true };
  }
  return { fcs: u8, wrapped: false };
}

// 给 FCS 套回 RASTATE 外壳（与 WebFC 备份文件逐字节同构）
function wrapRastate(fcs) {
  fcs = toU8(fcs);
  var pad = (4 - (fcs.length % 4)) % 4;
  var out = new Uint8Array(7 + 1 + 4 + 4 + fcs.length + pad + 8);
  var o = 0, i;
  for (i = 0; i < 7; i++) out[o++] = RA_MAGIC.charCodeAt(i);
  out[o++] = 0x01;
  out[o++] = 0x4D; out[o++] = 0x45; out[o++] = 0x4D; out[o++] = 0x20; // 'MEM '
  w32le(out, o, fcs.length); o += 4;
  out.set(fcs, o); o += fcs.length;
  o += pad;                                   // 已全部是 0
  out[o++] = 0x45; out[o++] = 0x4E; out[o++] = 0x44; out[o++] = 0x20; // 'END '
  w32le(out, o, 0);
  return out;
}

// ---------------- FCS 解析 ----------------
function parseFcs(input) {
  var u8 = toU8(input);
  var res = unwrap(u8);
  var st = res.fcs;
  if (st.length < 16 || ascii(st, 0, 3) !== 'FCS') throw new Error('不是 fceumm/FCEUX 状态（缺少 FCS 标识）');
  if (st[3] !== 0xFF) throw new Error('暂不支持压缩型 FCSX 存档（0x' + st[3].toString(16) + '）');
  var total = u32le(st, 4);
  var version = u32le(st, 8);
  if (16 + total > st.length) throw new Error('FCS 状态长度越界（' + total + ' > ' + (st.length - 16) + '）');
  var off = 16, end = 16 + total, chunks = [];
  while (off < end) {
    if (off + 5 > end) throw new Error('chunk 头越界 @0x' + off.toString(16));
    var type = st[off], size = u32le(st, off + 1);
    if (off + 5 + size > end) throw new Error('chunk 数据越界 type=0x' + type.toString(16));
    chunks.push({ type: type, data: st.subarray(off + 5, off + 5 + size) });
    off += 5 + size;
  }
  return { version: version, chunks: chunks, fcs: st, wrapped: res.wrapped };
}

// ---------------- web 通用状态 -> FCS ----------------
function sformat(parts) {
  var total = 0, i;
  for (i = 0; i < parts.length; i++) total += 8 + parts[i][1].length;
  var out = new Uint8Array(total), o = 0;
  for (i = 0; i < parts.length; i++) {
    var name = parts[i][0], data = parts[i][1];
    for (var k = 0; k < 4; k++) out[o++] = k < name.length ? name.charCodeAt(k) : 0;
    w32le(out, o, data.length); o += 4;
    out.set(data, o); o += data.length;
  }
  return out;
}
function chunk(type, payload) {
  var out = new Uint8Array(5 + payload.length);
  out[0] = type;
  w32le(out, 1, payload.length);
  out.set(payload, 5);
  return out;
}
function copyInto(dst, arr, len) {
  if (!arr) return dst;
  var n = Math.min(len || dst.length, arr.length, dst.length);
  for (var i = 0; i < n; i++) dst[i] = arr[i] & 0xff;
  return dst;
}

function webStateToFcs(state) {
  if (!state || !state.cpu || !state.ppu || !state.mapper) throw new Error('状态对象不完整（缺 cpu/ppu/mapper）');
  var cpu = state.cpu, ppu = state.ppu, m = state.mapper;
  var parts = [];

  // ---- 1: SFCPU ----
  var pc = new Uint8Array(2); w16le(pc, 0, (cpu.br && cpu.br[0] || 0) & 0xffff);
  var r = cpu.r || [0, 0, 0, 0];
  var pReg = 0x20 | ((cpu.n ? 1 : 0) << 7) | ((cpu.v ? 1 : 0) << 6) | ((cpu.d ? 1 : 0) << 3) |
             ((cpu.i ? 1 : 0) << 2) | ((cpu.z ? 1 : 0) << 1) | (cpu.c ? 1 : 0);
  var ram = new Uint8Array(0x800);
  copyInto(ram, state.ram || [], 0x800);
  parts.push(chunk(1, sformat([
    ['PC', pc],
    ['A', new Uint8Array([(r[0] || 0) & 0xff])],
    ['X', new Uint8Array([(r[1] || 0) & 0xff])],
    ['Y', new Uint8Array([(r[2] || 0) & 0xff])],
    ['S', new Uint8Array([(r[3] || 0) & 0xff])],
    ['P', new Uint8Array([pReg])],
    ['DB', new Uint8Array([0])],
    ['RAM', ram]
  ])));

  // ---- 2: SFCPUC（web 无对应，取模板默认值：计数都是“立即触发 IRQ 检查”的安全态）----
  parts.push(chunk(2, DEFAULTS[2]));

  // ---- 3: PPU ----
  var ppu0 = ((ppu.generateNmi ? 1 : 0) << 7) | ((ppu.spriteHeight === 16 ? 1 : 0) << 5) |
             ((ppu.bgPatternBase ? 1 : 0) << 4) | ((ppu.spritePatternBase ? 1 : 0) << 3) |
             ((ppu.vramIncrement ? 1 : 0) << 2);
  var ppu1 = ((ppu.emphasis || 0) << 5) | ((ppu.sprRendering ? 1 : 0) << 4) | ((ppu.bgRendering ? 1 : 0) << 3) |
             ((ppu.sprInLeft ? 1 : 0) << 2) | ((ppu.bgInLeft ? 1 : 0) << 1) | (ppu.greyScale ? 1 : 0);
  var ppu2 = ((ppu.inVblank ? 1 : 0) << 7) | ((ppu.spriteZero ? 1 : 0) << 6) | ((ppu.spriteOverflow ? 1 : 0) << 5);
  var ntar = new Uint8Array(0x800); copyInto(ntar, m.ppuRam || [], 0x800);
  var pram = new Uint8Array(0x20); copyInto(pram, ppu.paletteRam || [], 0x20);
  var spra = new Uint8Array(0x100); copyInto(spra, ppu.oamRam || [], 0x100);
  var radd = new Uint8Array(2); w16le(radd, 0, (ppu.v || 0) & 0x7fff);
  var tadd = new Uint8Array(2); w16le(tadd, 0, (ppu.t || 0) & 0x7fff);
  var xoff = new Uint8Array([(ppu.x || 0) & 7]);
  var vtgl = new Uint8Array([ppu.w ? 1 : 0]);
  var vbuf = new Uint8Array([(ppu.readBuffer || 0) & 0xff]);
  parts.push(chunk(3, sformat([
    ['NTAR', ntar],
    ['PRAM', pram],
    ['SPRA', spra],
    ['PPUR', new Uint8Array([ppu0, ppu1, ppu2, (ppu.oamAddress || 0) & 0xff])],
    ['KOOK', DEFAULTS.ppu.KOOK],
    ['DEAD', DEFAULTS.ppu.DEAD],
    ['PSPL', DEFAULTS.ppu.PSPL],
    ['XOFF', xoff],
    ['VTGL', vtgl],
    ['RADD', radd],
    ['TADD', tadd],
    ['VBUF', vbuf],
    ['PGEN', DEFAULTS.ppu.PGEN]
  ])));

  // ---- 4: 手柄 ----
  parts.push(chunk(4, sformat([
    ['JYRB', DEFAULTS.jyrb],
    ['JOYS', new Uint8Array([
      (state.latchedControl1State || 0) & 0xff,
      (state.latchedControl2State || 0) & 0xff, 0, 0])],
    ['LSTS', new Uint8Array([state.controllerLatched ? 1 : 0])]
  ])));

  // ---- 5: APU（web 无对应；模板是同一核心运行时抓到的合法 APU 快照）----
  parts.push(chunk(5, DEFAULTS[5]));

  // ---- 0x10: mapper（特殊板卡/198 卡带的 SFMDATA）----
  var wram = new Uint8Array(0x4000); copyInto(wram, m.prgRam || [], 0x4000);
  var chrr = new Uint8Array(0x1000); copyInto(chrr, m.chrRam || [], 0x1000);
  var m5kx = new Uint8Array(0x1000); copyInto(m5kx, m.extraPrgRam || [], 0x1000);
  var regs = new Uint8Array(8); copyInto(regs, m.bankRegs || [], 8);
  parts.push(chunk(0x10, sformat([
    ['WRAM', wram],
    ['REGS', regs],
    ['CMD', new Uint8Array([((m.regSelect || 0) & 7) | ((m.prgMode ? 1 : 0) << 6) | ((m.chrMode ? 1 : 0) << 7)])],
    ['A000', new Uint8Array([(m.mirroring || 0) & 1])],
    ['A001', DEFAULTS.a001],
    ['IRQR', new Uint8Array([m.reloadIrq ? 1 : 0])],
    ['IRQC', new Uint8Array([m.irqCounter || 0])],
    ['IRQL', new Uint8Array([m.irqLatch || 0])],
    ['IRQA', new Uint8Array([m.irqEnabled ? 1 : 0])],
    ['CHRR', chrr],
    ['M5KX', m5kx]
  ])));

  var total = 0, i;
  for (i = 0; i < parts.length; i++) total += parts[i].length;
  var out = new Uint8Array(16 + total);
  out[0] = 0x46; out[1] = 0x43; out[2] = 0x53; out[3] = 0xFF;   // 'FCS' + 0xFF
  w32le(out, 4, total);
  w32le(out, 8, FCS_VERSION);
  var o = 16;
  for (i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
  return out;
}

return {
  FCS_VERSION: FCS_VERSION,
  unwrap: unwrap,
  wrapRastate: wrapRastate,
  parseFcs: parseFcs,
  webStateToFcs: webStateToFcs
};

});
