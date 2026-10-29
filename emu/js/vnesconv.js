/*
 * vnesconv.js — VirtuaNES/nes.emu(VirtuaNESX) 即时存档(.st0~.st9) 与 本站 web 模拟器存档互转
 *
 * 配套 fc0conv.js（FCEUX .fc0 互转），字段映射思路一致。全部同步实现（.st0 无压缩）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ 排查史与安全默认原则（同 fc0conv.js【事故二】教训，改本文件前必读）
 * ═══════════════════════════════════════════════════════════════════════════
 *   web 没有对应概念的字段不能想当然填 0，要按目标模拟器的复位语义填安全默认值。
 *   VirtuaNES 结构依据：VirtuaNESex_src(20191105)/NES/State.h（结构定义，本工程
 *   内有源码；State.cpp 序列化实现不在源码包中，实际布局已用真实 .st0 逐字节
 *   验证：块大小精确闭合、XRAM/WRAM/CHR RAM 用 FCEUX 已知内容签名定位）。
 *
 * 【本文件实战踩过的坑（全部经真实存档二分定位验证）】
 *   1. SND DATA 全 0 → VirtuaNES 读档花屏：APU 通道状态缺失破坏游戏时序
 *      （注意 VirtuaNES 的帧中断在 CPUSTAT.FrameIRQ，不在 APU 块，与 FCEUX 不同）。
 *      修复：嵌入已知可用的 0x140 字节 APU 状态模板（见 webStateToSt0 的 sndData）。
 *   2. MMU 窗口 1（$2000-3FFF）填 0 → 花屏：特殊板卡 把 XRAM 同时暴露在
 *      $3000-3FFF 与 $5000-5FFF，真实布局 = [RAM 镜像 4K][XRAM 4K]。
 *   3. CPU_MEM_PAGE[6]/[7]（$C000/$E000 固定 PRG 窗）必须 = ROM 实际末二 bank：
 *      VirtuaNES 载入按此元数据从 ROM 复制代码窗。传说之翼 160 bank=158/159、
 *      纵横天下 224 bank=222/223，硬编码任一个都会让另一个花屏。
 *      修复：vnesLastBanks（st0 导入暂存）> header.banks 推导 > 158/159 兜底。
 *   4. CPUSTAT.FrameIRQ 必须写 0x40（$4017 bit6 帧中断抑制）：写 0 → 帧中断
 *      风暴，机制与 fc0conv 事故二同源。
 *   5. loopy_v 写 t 而非 v（帧首状态），减轻读档首帧花屏（重建路径）。
 *   6. PPU_MEM_TYPE=1（CHR RAM 映射页，V 游玩后游戏切到 CHR RAM 画面才出现）
 *      被当作 VRAM 槽消费 1K → nametable/CRAM 数据错位 → 导入 web 读档花屏。
 *      修复：仅 type===128 的槽带 1K 数据（st0ToWebState 解析处）。
 *
 * 【无损往返与已知瑕疵】
 *   - st0 导入时全部块的原始字节暂存于 state.vnesRawBlocks/vnesBlockVers/
 *     vnesRomCrc/vnesLastBanks（web 忽略这些自定义字段，随槽位存于 IndexedDB），
 *     导出时优先原样组装 → st0→web→st0 字节级一致，读档表现与原档完全相同。
 *   - 注意：用户在 web 里运行游戏后重新存档，模拟器重建的状态对象会丢弃这些
 *     自定义字段，此后导出退回重建路径。
 *   - 已知瑕疵（重建路径，web 原生/FCEUX 来源的导出）：读档首帧可能花屏 +
 *     残留音，按键触发画面重绘后自愈。根因是 web 的简化模型（2K 统一 VRAM、
 *     扫描线 PPU、无 CPU 时序计数器）无法表达 VirtuaNES 的全部内部状态
 *     （4 独立 VRAM 缓冲、帧序列器等），属模型差异而非数据丢失，无法在
 *     转换器侧根除。VirtuaNES 读档时若弹"CRC 不一致"提示（web 原生导出无
 *     ROM CRC 所致），点"是"正常载入。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * .st0 格式（#pragma pack(1)，全部小端）
 * ═══════════════════════════════════════════════════════════════════════════
 * 文件头 FILEHDR2（32 字节）：
 *   [0]  ID[12]          "VirtuaNES ST"
 *   [12] Reserved u16    0
 *   [14] BlockVersion u16 0x0200
 *   [16] Ext0 u32        ROM 的 PRG 数据 CRC32（读档校验用；web 状态无 ROM，
 *                        导入时存入 web 状态的 vnesRomCrc 字段，导出时带回）
 *   [20] Ext1 u16 / [22] Ext2 u16 / [24] MovieStep i32 / [28] MovieOffset i32
 * 块结构 BLOCKHDR（16 字节）：ID[8] + Reserved u16 + BlockVersion u16 + BlockSize u32
 *   "REG DATA" ver 0x0210, 96B：
 *     [0..36)  CPUSTAT：PC u16, A,X,Y,S,P, I(中断挂起), FrameIRQ, FrameIRQ_occur,
 *              FrameIRQ_count, FrameIRQ_type, FrameIRQ_cycles i32, DMA_cycles i32,
 *              emul_cycles i64, base_cycles i64（64 字节 union 其余补 0）
 *     [64..96) PPUSTAT：reg0,reg1,reg2,reg3,reg7,toggle56 u8, loopy_t u16,
 *              loopy_v u16, loopy_x u16（32 字节 union 其余补 0）
 *   "RAM DATA" ver 0x0100, 2336B：RAM[2048] + BGPAL[16] + SPPAL[16] + SPRAM[256]
 *   "MMU DATA" ver 0x0210, 68+数据：
 *     [0]  CPU_MEM_TYPE[8]（255=RAM 保存；0=ROM 不保存）      地址窗：
 *     [8]  CPU_MEM_PAGE[8] u16（ROM 窗记录 PRG bank 号）        i=0..7 → $0000/$2000/
 *     [24] PPU_MEM_TYPE[12]（0=VROM 不保存；1=CHR RAM 页不保存，数据在末尾 CRAM；
 *          128=VRAM 保存）     $4000/$6000/…/$E000
 *     [36] PPU_MEM_PAGE[12] u16（CHR 槽 0-7 记 VROM bank 号；8-11 记 VRAM 页号）
 *     [60] CRAM_USED[8]（[0]!=0 表示末尾附 4K CRAM）
 *     数据按索引序：CPU 类型非零窗各 8K（窗口 0-3 = $0000/$2000/$4000/$6000，
 *     其中窗 2 的 [0x1000..0x2000) = $5000-$5FFF XRAM、窗 3 = $6000-$7FFF WRAM），
 *     再 PPU 类型非零槽各 1K（槽 8-11 = nametable 页），最后 CRAM 4K（特殊板卡）
 *   "MMC DATA" ver 0x0100, 256B：特殊板卡::SaveState 前 20 字节：
 *     p[0..7]=reg[8]（各寄存器最近写入值：$8000/$8001/$A000/$A001/$C000/$C001/
 *            $E000/$E001），p[8]=prg0($8000 bank), p[9]=prg1($A000 bank),
 *            p[10]=chr01, p[11]=chr23, p[12..15]=chr4..chr7（CHR 槽 bank 号，
 *            与 FCEUX bankRegs[0..5] 同义），p[16]=irq_enable, p[17]=irq_counter,
 *            p[18]=irq_latch, p[19]=irq_request
 *   "CTR DATA" ver 0x0100, 32B：pad1bit/pad2bit/pad3bit/pad4bit u32 + strobe u8
 *   "SND DATA" ver 0x0100, 2048B：APU 内部快照（转换时忽略/全 0。VirtuaNES 的
 *   APU 帧中断由 CPUSTAT.FrameIRQ 字段控制而非 APU 块，全 0 不会复现 FCEUX 的
 *   帧中断风暴，但未逐项实测——若导出后 VirtuaNES 异常，优先排查此块）
 *
 * 与 web saveState 的对应：CPU/PPU 寄存器→cpu/ppu（同 fc0conv）；RAM/调色板/OAM→
 * ram/paletteRam/oamRam；MMU 窗→prgRam/extraPrgRam/ppuRam/chrRam；MMC→mapper 的
 * bankRegs/IRQ/镜像。chrPageTable/chrBankSelect 等派生状态不导出（web 读档时由
 * setHackState 重建）。romName/header 沿用槽位现有存档（prev 参数）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VnesConv = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAGIC = 'VirtuaNES ST';

  function u16le(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32le(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function w16le(b, o, v) { b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; }
  function w32le(b, o, v) { b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; b[o + 2] = (v >> 16) & 0xff; b[o + 3] = (v >> 24) & 0xff; }

  // ---------- 解析 .st0 ----------
  // 返回 { blockVersion, romCrc, blocks: { id: { ver, data } } }（同步，无压缩）
  function parseSt0(buffer) {
    var u = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (u.length < 32) throw new Error('文件太小，不是 VirtuaNES 存档');
    var id = '';
    for (var i = 0; i < 12; i++) id += String.fromCharCode(u[i]);
    if (id !== MAGIC) throw new Error('不是 VirtuaNES 存档（缺少 "VirtuaNES ST" 标识）');
    var out = {
      blockVersion: u16le(u, 14),
      romCrc: u32le(u, 16),
      blocks: {}
    };
    var off = 32;
    while (off + 16 <= u.length) {
      var bid = '';
      for (i = 0; i < 8; i++) bid += String.fromCharCode(u[off + i]);
      var bver = u16le(u, off + 10);
      var size = u32le(u, off + 12); // BLOCKHDR: ID[8]+Reserved u16+BlockVersion u16+BlockSize u32
      if (off + 16 + size > u.length) throw new Error('存档块 ' + bid + ' 数据越界，文件可能损坏');
      out.blocks[bid] = { ver: bver, data: u.subarray(off + 16, off + 16 + size) };
      off += 16 + size;
    }
    // 原始块字节整体暂存：st0→web→st0 往返时逐字节还原（web 的 2K VRAM 等
    // 简化模型无法无损表达 VirtuaNES 的 4 独立 VRAM 缓冲/窗口镜像细节，重建
    // 导出会有细微差异 → 实测读档首帧花屏+长鸣）。web 的 setObjState 会忽略
    // 未知字段，不影响其自身读档；用户在 web 里重新存档后该字段自然消失，
    // 届时导出退回重建路径。
    out.rawBlocks = {};
    out.rawVers = {};
    off = 32;
    while (off + 16 <= u.length) {
      bid = '';
      for (i = 0; i < 8; i++) bid += String.fromCharCode(u[off + i]);
      size = u32le(u, off + 12);
      out.rawBlocks[bid] = Array.prototype.slice.call(u.subarray(off + 16, off + 16 + size));
      out.rawVers[bid] = u16le(u, off + 10);
      off += 16 + size;
    }
    return out;
  }

  // ---------- .st0 → web saveState ----------
  // prev: 槽位现有 saveState（romName 等沿用），可空
  function st0ToWebState(parsed, prev) {
    var reg = parsed.blocks['REG DATA'], ramB = parsed.blocks['RAM DATA'],
        mmu = parsed.blocks['MMU DATA'], mmc = parsed.blocks['MMC DATA'],
        ctr = parsed.blocks['CTR DATA'];
    if (!reg || !ramB || !mmu || !mmc) throw new Error('存档缺少核心数据块（REG/RAM/MMU/MMC），可能不是标准 VirtuaNES 存档');

    // --- CPU（CPUSTAT）---
    var pc = u16le(reg.data, 0);
    var A = reg.data[2], X = reg.data[3], Y = reg.data[4], S = reg.data[5], p = reg.data[6];

    // --- PPU（PPUSTAT，REG 块内偏移 64）---
    var pp = 64;
    var r0 = reg.data[pp], r1 = reg.data[pp + 1], r2 = reg.data[pp + 2], r3 = reg.data[pp + 3];
    var reg7 = reg.data[pp + 4], toggle56 = reg.data[pp + 5];
    var loopyT = u16le(reg.data, pp + 6) & 0x7fff;
    var loopyV = u16le(reg.data, pp + 8) & 0x7fff;
    var loopyX = u16le(reg.data, pp + 10) & 7;

    // --- RAM DATA ---
    var ramRaw = ramB.data;
    var ram = new Array(0x8000);
    for (var i = 0; i < 0x8000; i++) ram[i] = i < 0x800 ? ramRaw[i] : 0;
    var palette = [];
    for (i = 0; i < 16; i++) palette.push(ramRaw[0x800 + i]);
    for (i = 0; i < 16; i++) palette.push(ramRaw[0x810 + i]);
    var oam = [];
    for (i = 0; i < 256; i++) oam.push(ramRaw[0x820 + i]);

    // --- MMC（特殊板卡 reg 语义见文件头）---
    var m = mmc.data;
    var cmd = m[0];                       // reg[0] = $8000 最近写入值
    var mirroring = m[2] & 1;             // reg[2] = $A000：0=VMIRROR(垂直) 1=水平，与 web 同义
    var bankRegs = [m[10], m[11], m[12], m[13], m[14], m[15], m[8], m[9]];
    //          chr01, chr23, chr4, chr5, chr6, chr7  ←→  prg0, prg1

    // --- MMU：按类型非零的窗/槽顺序取数据 ---
    var cpuType = [], cpuPage = [], ppuType = [], ppuPage = [], cramUsed = [];
    for (i = 0; i < 8; i++) { cpuType.push(mmu.data[i]); cpuPage.push(u16le(mmu.data, 8 + i * 2)); }
    for (i = 0; i < 12; i++) { ppuType.push(mmu.data[24 + i]); ppuPage.push(u16le(mmu.data, 36 + i * 2)); }
    for (i = 0; i < 8; i++) cramUsed.push(mmu.data[60 + i]);
    // 暂存 ROM 固定末二 PRG 窗的 bank 号（窗口 6/7 = $C000/$E000）：web 状态没有
    // ROM 信息，导出 .st0 时需要它们重建 MMU 元数据
    var vnesLastBanks = [cpuPage[6], cpuPage[7]];
    var off = 68;
    var cpuBanks = {};    // 窗口 i → 8K 数据（窗口 i 覆盖 $[i*0x2000, (i+1)*0x2000)）
    for (i = 0; i < 8; i++) {
      if (cpuType[i]) { cpuBanks[i] = mmu.data.subarray(off, off + 0x2000); off += 0x2000; }
    }
    var vramBanks = {};   // 槽 8-11 → 1K 数据（nametable 页）
    var vramPages = [];
    for (i = 0; i < 12; i++) {
      // ⚠ 只有 128=VRAM 的槽在数据流中各带 1K。type=1 是 CHR RAM 映射页（特殊板卡
      // bank≤3 的槽，游玩后游戏中 CHR 切到 RAM 时出现），其数据在末尾 CRAM 4K 里，
      // 不占本段数据流。此前写 if (ppuType[i]) 会把 type=1 也当 VRAM 消费 1K，导致
      // nametable/CRAM 全部错位（CHR RAM 被截半、CHR 图形数据被当成 nametable），
      // 读档花屏——"web 导出 → V 游玩后重存 → 导入 web 读档异常"即此（实测定位）。
      if (ppuType[i] === 128) {
        vramBanks[i] = mmu.data.subarray(off, off + 0x400);
        vramPages.push({ slot: i, page: ppuPage[i] });
        off += 0x400;
      }
    }
    var chrRam = null;
    if (cramUsed[0]) {
      chrRam = Array.prototype.slice.call(mmu.data.subarray(off, off + 0x1000));
      off += 0x1000;
    }

    // $6000-$7FFF WRAM → prgRam；$5000-$5FFF XRAM → extraPrgRam
    var prgRam = null, extraPrgRam = null;
    if (cpuBanks[3]) { prgRam = []; for (i = 0; i < 0x2000; i++) prgRam.push(cpuBanks[3][i]); }
    if (cpuBanks[2]) { extraPrgRam = []; for (i = 0; i < 0x1000; i++) extraPrgRam.push(cpuBanks[2][0x1000 + i]); }

    // nametable：槽 8-11 按页号去重，取前两个不同页 = web 的 [表A 0-3FF, 表B 400-7FF]
    var ppuRam = null;
    {
      var seen = {}, parts = [];
      for (i = 0; i < vramPages.length && parts.length < 2; i++) {
        var pg = vramPages[i];
        if (seen[pg.page]) continue;
        seen[pg.page] = 1;
        parts.push(vramBanks[pg.slot]);
      }
      if (parts.length === 2) {
        ppuRam = [];
        for (i = 0; i < 0x400; i++) ppuRam.push(parts[0][i]);
        for (i = 0; i < 0x400; i++) ppuRam.push(parts[1][i]);
      }
    }

    // --- CTR ---
    var pad1 = ctr ? u32le(ctr.data, 0) & 0xff : 0;
    var pad2 = ctr ? u32le(ctr.data, 4) & 0xff : 0;
    var strobe = ctr ? ctr.data[16] : 0;

    var state = {
      version: 1,
      vnesRomCrc: parsed.romCrc >>> 0,    // 自定义字段：web 忽略，导出 .st0 时带回
      vnesLastBanks: vnesLastBanks,       // 同上：ROM 固定末二 PRG 窗 bank 号
      vnesRawBlocks: parsed.rawBlocks,    // 同上：全部块原始字节（无损往返）
      vnesBlockVers: parsed.rawVers,      // 同上：各块 BlockVersion
      vnesBlockVersion: parsed.blockVersion, // 同上：文件头 BlockVersion
      ram: ram,
      cycles: 0,
      inDma: 0, dmaTimer: 0, dmaBase: 0, dmaValue: 0,
      latchedControl1State: pad1,
      latchedControl2State: pad2,
      controllerLatched: strobe ? 1 : 0,
      mapperIrqWanted: 0, frameIrqWanted: 0, dmcIrqWanted: 0,
      cpu: {
        r: [A, X, Y, S],
        br: [pc],
        n: (p >> 7) & 1, v: (p >> 6) & 1, d: (p >> 3) & 1, i: (p >> 2) & 1, z: (p >> 1) & 1, c: p & 1,
        irqWanted: 0, nmiWanted: 0, cyclesLeft: 0
      },
      ppu: {
        paletteRam: palette,
        oamRam: oam,
        t: loopyT,
        v: loopyV,
        w: toggle56 ? 1 : 0,
        x: loopyX,
        oamAddress: r3,
        readBuffer: reg7,
        spriteZero: (r2 >> 6) & 1,
        spriteOverflow: (r2 >> 5) & 1,
        inVblank: (r2 >> 7) & 1,
        vramIncrement: (r0 >> 2) & 1,
        spritePatternBase: (r0 >> 3) & 1,
        bgPatternBase: (r0 >> 4) & 1,
        spriteHeight: ((r0 >> 5) & 1) ? 16 : 8,
        slave: 0,
        generateNmi: (r0 >> 7) & 1,
        greyScale: r1 & 1,
        bgInLeft: (r1 >> 1) & 1,
        sprInLeft: (r1 >> 2) & 1,
        bgRendering: (r1 >> 3) & 1,
        sprRendering: (r1 >> 4) & 1,
        emphasis: (r1 >> 5) & 7
      },
      // chrRam/extraPrgRam 视 MMU 是否保存而可选（缺失字段 web 读档时保留原值）
      mapper: {
        prgRam: prgRam || new Array(0x2000),
        ppuRam: ppuRam || new Array(0x800),
        bankRegs: bankRegs,
        mirroring: mirroring,
        prgMode: (cmd >> 6) & 1,
        chrMode: (cmd >> 7) & 1,
        regSelect: cmd & 7,
        reloadIrq: 0,
        irqLatch: m[18],
        irqEnabled: m[16] ? 1 : 0,
        irqCounter: m[17],
        lastRead: 0
      }
    };
    if (chrRam) state.mapper.chrRam = chrRam;
    if (extraPrgRam) state.mapper.extraPrgRam = extraPrgRam;
    if (prev && prev.header) state.header = prev.header;
    return state;
  }

  // ---------- web saveState → .st0 ----------
  // 返回完整 .st0 文件（Uint8Array）。state.vnesRomCrc 存在时写回头部 CRC，否则填 0
  // （VirtuaNES 读档时可能提示 CRC 不一致）。
  // ⚠ 无损优先：state.vnesRawBlocks（st0 导入时的原始块字节）存在时直接用其组装，
  // 字节级还原；仅 web 原生/FCEUX 来源的状态才走下面的重建路径。
  function webStateToSt0(state) {
    if (!state || !state.cpu || !state.ppu || !state.mapper) {
      throw new Error('存档内容不完整，无法转换');
    }
    if (state.vnesRawBlocks && state.vnesRawBlocks['REG DATA']) {
      // 无损路径：导入时暂存的原始块字节直接组装（块序/版本按标准布局）
      var rb = state.vnesRawBlocks, rv = state.vnesBlockVers || {};
      var head0 = new Uint8Array(32);
      for (var k = 0; k < 12; k++) head0[k] = MAGIC.charCodeAt(k);
      w16le(head0, 12, 0);
      w16le(head0, 14, state.vnesBlockVersion || 0x0200);
      w32le(head0, 16, (state.vnesRomCrc || 0) >>> 0);
      var parts = [head0];
      ['REG DATA', 'RAM DATA', 'MMU DATA', 'MMC DATA', 'CTR DATA', 'SND DATA'].forEach(function (id) {
        if (!rb[id]) throw new Error('暂存的 VirtuaNES 块 ' + id + ' 缺失');
        var data = new Uint8Array(rb[id]);
        var bh = new Uint8Array(16);
        for (k = 0; k < 8; k++) bh[k] = k < id.length ? id.charCodeAt(k) : 0;
        w16le(bh, 8, 0);
        w16le(bh, 10, rv[id] !== undefined ? rv[id] : 0x0100);
        w32le(bh, 12, data.length);
        parts.push(bh, data);
      });
      var total1 = 0;
      parts.forEach(function (p1) { total1 += p1.length; });
      var f1 = new Uint8Array(total1);
      var o1 = 0;
      parts.forEach(function (p1) { f1.set(p1, o1); o1 += p1.length; });
      return f1;
    }
    var cpu = state.cpu, ppu = state.ppu, m = state.mapper;

    // ---- REG DATA（96B）----
    var regData = new Uint8Array(96);
    var pc = (cpu.br && cpu.br[0]) || 0;
    var r = cpu.r || [0, 0, 0, 0];
    w16le(regData, 0, pc & 0xffff);
    regData[2] = r[0] || 0; regData[3] = r[1] || 0; regData[4] = r[2] || 0; regData[5] = r[3] || 0;
    regData[6] = 0x20 | ((cpu.n ? 1 : 0) << 7) | ((cpu.v ? 1 : 0) << 6) | ((cpu.d ? 1 : 0) << 3) |
                     ((cpu.i ? 1 : 0) << 2) | ((cpu.z ? 1 : 0) << 1) | (cpu.c ? 1 : 0);
    // ⚠ FrameIRQ[8] 必须写 0x40（$4017 bit6 帧中断抑制，正常运行的 VirtuaNES 存档
    // 实测值）。写 0 = 未抑制 → CPU 侧帧序列器反复触发帧中断，而游戏的 IRQ 处理器
    // 只应答 MMC3 扫描线中断、不清帧标志 → 中断风暴（与 fc0conv.js 事故二的
    // IQFM=0 完全同源，实测 web→st0 导入 VirtuaNES 花屏）。
    regData[8] = 0x40;
    // [9..12) FrameIRQ_occur/count/type 与 [12..20) FrameIRQ_cycles/DMA_cycles、
    // [20..36) emul/base cycles 填 0（抑制态下序列器不运行，安全）
    var br = m.prgMode ? 1 : 0, bg = m.chrMode ? 1 : 0;
    regData[64] = ((ppu.generateNmi ? 1 : 0) << 7) | ((ppu.spriteHeight === 16 ? 1 : 0) << 5) |
                  ((ppu.bgPatternBase ? 1 : 0) << 4) | ((ppu.spritePatternBase ? 1 : 0) << 3) |
                  ((ppu.vramIncrement ? 1 : 0) << 2);
    regData[65] = ((ppu.emphasis || 0) << 5) | ((ppu.sprRendering ? 1 : 0) << 4) | ((ppu.bgRendering ? 1 : 0) << 3) |
                  ((ppu.sprInLeft ? 1 : 0) << 2) | ((ppu.bgInLeft ? 1 : 0) << 1) | (ppu.greyScale ? 1 : 0);
    regData[66] = ((ppu.inVblank ? 1 : 0) << 7) | ((ppu.spriteZero ? 1 : 0) << 6) | ((ppu.spriteOverflow ? 1 : 0) << 5);
    regData[67] = ppu.oamAddress || 0;
    regData[68] = ppu.readBuffer || 0;
    regData[69] = ppu.w ? 1 : 0;
    w16le(regData, 70, (ppu.t || 0) & 0x7fff);
    // ⚠ loopy_v 写 t 而不是 v：web 保存瞬间的 v 是帧中渲染地址（含细 Y 偏移），
    // 直接导出会让 VirtuaNES 读档第一帧从错误滚动处渲染（实测首帧花屏，按键后
    // 游戏重写滚动才恢复）。硬件每帧预渲染行也会 v=t，写 t 即"帧首"状态。
    w16le(regData, 72, (ppu.t || 0) & 0x7fff);
    w16le(regData, 74, (ppu.x || 0) & 7);

    // ---- RAM DATA（2336B）----
    var ramData = new Uint8Array(2336);
    var srcRam = state.ram || [];
    for (var i = 0; i < 0x800; i++) ramData[i] = srcRam[i] & 0xff;
    var pal = ppu.paletteRam || [];
    for (i = 0; i < 16; i++) ramData[0x800 + i] = (pal[i] || 0) & 0xff;
    for (i = 0; i < 16; i++) ramData[0x810 + i] = (pal[16 + i] || 0) & 0xff;
    var oam = ppu.oamRam || [];
    for (i = 0; i < 256; i++) ramData[0x820 + i] = (oam[i] || 0) & 0xff;

    // ---- MMU DATA（68 + 4×8K CPU + 4×1K VRAM + 4K CRAM）----
    // ⚠ CPU 窗 6/7（$C000/$E000 固定 PRG 窗）的页号必须按 ROM 实际 bank 数填：
    //   last2 = 8K bank 数 - 2、last1 = -1。VirtuaNES 载入时按此元数据从 ROM 复制
    //   代码窗（不会重调 mapper SetBank），页号错 = 执行错误 bank = 花屏。
    //   来源优先级：st0 导入时暂存的 vnesLastBanks > web 状态的 header.banks
    //   （web 保存时自动记录 ROM 的 PRG 16K bank 数 ×2 = 8K bank 数）> 兜底 158/159。
    var chr01 = (m.bankRegs || [])[0] || 0, chr23 = (m.bankRegs || [])[1] || 0;
    var chr4 = (m.bankRegs || [])[2] || 0, chr5 = (m.bankRegs || [])[3] || 0;
    var chr6 = (m.bankRegs || [])[4] || 0, chr7 = (m.bankRegs || [])[5] || 0;
    var prg0 = (m.bankRegs || [])[6] || 0, prg1 = (m.bankRegs || [])[7] || 0;
    var last2 = 158, last1 = 159;
    if (state.vnesLastBanks && state.vnesLastBanks.length === 2) {
      last2 = state.vnesLastBanks[0]; last1 = state.vnesLastBanks[1];
    } else if (state.header && state.header.banks) {
      var prg8K = state.header.banks * 2;
      last2 = prg8K - 2; last1 = prg8K - 1;
    }
    var vert = (m.mirroring || 0) === 0;   // web: 0=垂直 1=水平
    var mmuSize = 68 + 0x8000 + 0x1000 + 0x1000;
    var mmuData = new Uint8Array(mmuSize);
    for (i = 0; i < 4; i++) mmuData[i] = 255;                    // CPU 窗 0-3 = RAM
    // CPU 窗 4-7 = PRG ROM：写当前映射 bank 号（载入后由 mapper SetBank 重建）
    w16le(mmuData, 8 + 4 * 2, prg0); w16le(mmuData, 8 + 5 * 2, prg1);
    w16le(mmuData, 8 + 6 * 2, last2); w16le(mmuData, 8 + 7 * 2, last1);
    for (i = 8; i < 12; i++) mmuData[24 + i] = 128;              // PPU 槽 8-11 = VRAM
    for (i = 0; i < 8; i++) w16le(mmuData, 36 + i * 2, [chr01, (chr01 + 1) & 0xff, chr23, (chr23 + 1) & 0xff, chr4, chr5, chr6, chr7][i]);
    w16le(mmuData, 36 + 8 * 2, 0); w16le(mmuData, 36 + 9 * 2, 1);
    w16le(mmuData, 36 + 10 * 2, vert ? 0 : 1); w16le(mmuData, 36 + 11 * 2, vert ? 1 : 0);
    mmuData[60] = 255;                                           // CRAM_USED[0]：附 4K CRAM
    var body = 68;
    var xram = m.extraPrgRam || [];
    // CPU 窗 0：$0000-1FFF = 2K RAM 镜像 ×4
    for (i = 0; i < 0x2000; i++) mmuData[body + i] = srcRam[i & 0x7ff] & 0xff;
    body += 0x2000;
    // CPU 窗 1：$2000-3FFF。⚠ 真实存档布局：[RAM 镜像 4K][XRAM 4K]，即 特殊板卡
    // 把 XRAM 同时暴露在 $3000-3FFF 与 $5000-5FFF（hack 补丁层会从 $3000 读数据）。
    // 此窗填 0 会导致 VirtuaNES 读档花屏（实测）。
    for (i = 0; i < 0x800; i++) { mmuData[body + i] = srcRam[i & 0x7ff] & 0xff; mmuData[body + 0x800 + i] = srcRam[i & 0x7ff] & 0xff; }
    for (i = 0; i < 0x1000; i++) mmuData[body + 0x1000 + i] = (xram[i] || 0) & 0xff;
    body += 0x2000;
    // CPU 窗 2：$4000-5FFF，[0x1000..] = $5000-5FFF XRAM
    for (i = 0; i < 0x1000; i++) mmuData[body + 0x1000 + i] = (xram[i] || 0) & 0xff;
    body += 0x2000;
    // CPU 窗 3：$6000-7FFF WRAM
    var wram = m.prgRam || [];
    for (i = 0; i < 0x2000; i++) mmuData[body + i] = (wram[i] || 0) & 0xff;
    body += 0x2000;
    // PPU 槽 8-11：nametable（按镜像写页序）
    var ntr = m.ppuRam || [];
    var ntA = function (j) { return (ntr[j] || 0) & 0xff; };
    var ntB = function (j) { return (ntr[0x400 + j] || 0) & 0xff; };
    var pageSeq = vert ? [ntA, ntB, ntA, ntB] : [ntA, ntA, ntB, ntB];
    for (i = 0; i < 4; i++) {
      for (var j = 0; j < 0x400; j++) mmuData[body + i * 0x400 + j] = pageSeq[i](j);
    }
    body += 0x1000;
    // CRAM 4K
    var chrr = m.chrRam || [];
    for (i = 0; i < 0x1000; i++) mmuData[body + i] = (chrr[i] || 0) & 0xff;

    // ---- MMC DATA（256B）----
    var mmcData = new Uint8Array(256);
    mmcData[0] = ((m.regSelect || 0) & 7) | ((m.prgMode ? 1 : 0) << 6) | ((m.chrMode ? 1 : 0) << 7);  // reg[0]=$8000 值
    mmcData[1] = 0;                                   // reg[1]=$8001 值（web 未存，载入后由 bank 重写）
    mmcData[2] = (m.mirroring || 0) & 1;              // reg[2]=$A000：0=垂直 1=水平（VirtuaNES 同义）
    mmcData[3] = 0;                                   // reg[3]=$A001
    mmcData[4] = m.irqCounter || 0;                   // reg[4]=$C000
    mmcData[5] = m.irqLatch || 0;                     // reg[5]=$C001
    mmcData[6] = 0;                                   // reg[6]=$E000
    mmcData[7] = m.irqEnabled ? 1 : 0;                // reg[7]=$E001
    mmcData[8] = prg0;                                // prg0 = $8000 bank（=web bankRegs[6]）
    mmcData[9] = prg1;                                // prg1 = $A000 bank
    mmcData[10] = chr01; mmcData[11] = chr23;
    mmcData[12] = chr4; mmcData[13] = chr5; mmcData[14] = chr6; mmcData[15] = chr7;
    mmcData[16] = m.irqEnabled ? 1 : 0;
    mmcData[17] = m.irqCounter || 0;
    mmcData[18] = m.irqLatch || 0;
    mmcData[19] = 0;                                  // irq_request

    // ---- CTR DATA（32B）----
    var ctrData = new Uint8Array(32);
    w32le(ctrData, 0, (state.latchedControl1State || 0) & 0xffffffff);
    w32le(ctrData, 4, (state.latchedControl2State || 0) & 0xffffffff);
    ctrData[16] = state.controllerLatched ? 1 : 0;

    // ---- SND DATA（2048B）----
    // ⚠ 不能全 0（实测 web→st0 导入 VirtuaNES 花屏，二分定位到本块）。APU 通道
    // 结构（APU_INTERNAL.h RECTANGLE/TRIANGLE/NOISE/DPCM）的序列化布局无法从
    // 残缺源码完整重建，此处嵌入一份已知可用的 APU 状态模板（取自本游戏真实
    // VirtuaNES 存档的前 0x140 字节，其余补 0；实测 st4 该组合读档正常）。
    // 模板是"某一时刻的音乐通道状态"，读档后游戏的音乐驱动会立即重写各寄存器，
    // 听感只会有一瞬偏差。若其他游戏导出后异常，需用同法提取该游戏的模板。
    var sndData = new Uint8Array(0x800);
    var SND_TEMPLATE = [
      0x1f, 0x1f, 0x1f, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00,
      0xb8, 0x08, 0xe4, 0x98, 0xff, 0x20, 0x08, 0x00, 0xf0, 0x64, 0x90, 0x01, 0xe4, 0x00, 0x00, 0x00,
      0xff, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x12, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x10, 0x09, 0x02, 0x00, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x00, 0xb8, 0x08, 0xe4, 0x98, 0x00, 0xff, 0x20, 0x00, 0x12, 0x00, 0x00, 0x00,
      0xb7, 0x08, 0x31, 0x99, 0xff, 0x20, 0x07, 0xff, 0x5c, 0x16, 0xc6, 0x00, 0x31, 0x01, 0x00, 0x00,
      0xff, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x12, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x10, 0x08, 0x01, 0x00, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x00, 0xb7, 0x08, 0x31, 0x99, 0x00, 0xff, 0x20, 0x00, 0x12, 0x00, 0x00, 0x00,
      0x8f, 0x00, 0xc4, 0x19, 0xff, 0x80, 0x80, 0x00, 0x48, 0x9f, 0xc9, 0x00, 0x00, 0x00, 0xc5, 0x01,
      0x02, 0x00, 0x00, 0x00, 0x0f, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0x00, 0x0e, 0x00, 0x00,
      0x8f, 0x00, 0xc4, 0x19, 0xff, 0x80, 0x80, 0x00, 0x02, 0x00, 0x00, 0x00, 0x0f, 0x00, 0x00, 0x00,
      0x37, 0x08, 0x05, 0x98, 0xff, 0x20, 0x07, 0x02, 0xc2, 0x35, 0x00, 0x00, 0x38, 0x1d, 0x01, 0x00,
      0x00, 0x00, 0x60, 0x00, 0x12, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x10, 0x08, 0x05, 0x00, 0x0f, 0x00, 0x00, 0x00, 0x37, 0x08, 0x05, 0x98, 0x00, 0xff, 0x20, 0x00,
      0x12, 0x00, 0x00, 0x00, 0x0f, 0x00, 0x03, 0x20, 0xff, 0x00, 0x95, 0x2f, 0x00, 0x00, 0x36, 0x00,
      0x94, 0xbc, 0x17, 0x00, 0x00, 0x1e, 0x00, 0x00, 0xc0, 0xc0, 0xc0, 0xc0, 0x08, 0x10, 0x00, 0x00,
      0x08, 0x10, 0x00, 0x00, 0x1e, 0x00, 0x00, 0x00, 0x1e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0x2a, 0x00, 0x00, 0x00,
      0x36, 0x00, 0x00, 0x00, 0xd2, 0x0b, 0x00, 0x00, 0x08, 0x10, 0x00, 0x00
    ];
    for (i = 0; i < SND_TEMPLATE.length; i++) sndData[i] = SND_TEMPLATE[i];

    // ---- 组装 ----
    var out = [];
    function pushBlock(id, ver, data) {
      var head = new Uint8Array(16);
      for (var k = 0; k < 8; k++) head[k] = k < id.length ? id.charCodeAt(k) : 0;
      w16le(head, 8, 0);
      w16le(head, 10, ver);
      w32le(head, 12, data.length);
      out.push(head, data);
    }
    var head = new Uint8Array(32);
    for (i = 0; i < 12; i++) head[i] = MAGIC.charCodeAt(i);
    w16le(head, 12, 0);
    w16le(head, 14, 0x0200);
    w32le(head, 16, (state.vnesRomCrc || 0) >>> 0);
    out.push(head);
    pushBlock('REG DATA', 0x0210, regData);
    pushBlock('RAM DATA', 0x0100, ramData);
    pushBlock('MMU DATA', 0x0210, mmuData);
    pushBlock('MMC DATA', 0x0100, mmcData);
    pushBlock('CTR DATA', 0x0100, ctrData);
    pushBlock('SND DATA', 0x0100, sndData);

    var total = 0;
    out.forEach(function (b) { total += b.length; });
    var file = new Uint8Array(total);
    var o = 0;
    out.forEach(function (b) { file.set(b, o); o += b.length; });
    return file;
  }

  return {
    parseSt0: parseSt0,
    st0ToWebState: st0ToWebState,
    webStateToSt0: webStateToSt0
  };
});
