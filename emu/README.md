# emu/ — 模拟器详细说明

这里是 WebFC 的模拟器本体：一层自建页面 + 若干个独立 JS 模块，跑在 EmulatorJS 4.2.3 之上。

## 使用

1. 打开首页 `index.html`（或直接进 `emu/index.html`）；
2. 「选择游戏文件」选 ROM → 立即启动；拖拽也行（拖进来只启动，不入缓存）；
3. 想下次直接从列表开玩，用首页的「＋ 添加」把 ROM 存进缓存；
4. 载入后右下角会出现悬浮快捷档条：存 / 读 / 槽 / 屏 / 金 / 传 / 取。

支持格式：`.nes` `.fds` `.unf` `.unif`，以及 `.zip` / `.7z` 压缩包。

## 快捷键（电脑端）

| 键 | 作用 |
|---|---|
| `W A S D` | 方向 |
| `L` | A |
| `K` | B |
| `G` | Select |
| `H` | Start |
| `1` / `2` / `3` | 快存 / 快读 / 切换槽位 |
| `小键盘 +` / `-` | 倍速档位（1x / 1.5x / 3x 循环） |
| `小键盘 0` | 慢动作 |

键位可在载入页的 EmulatorJS 设置里改，也可在 `emu/index.html` 的
`DEFAULT_SETTINGS.controlSettings` 里改默认值（只对“没有本地设置记录”的新游戏生效）。

## 虚拟手柄（手机端）

- 触屏设备默认显示，桌面端默认隐藏（按 `(hover: hover) and (pointer: fine)` 判断）；
- 手机端整体放大 1.4 倍，改 `emu/index.html` 里的 `--vgScale` 即可；
- 方向键命中坐标由 `fixDpadHitBox()` 校正（CSS `zoom` 会让 `getBoundingClientRect()`
  与 `clientWidth` 不一致，不修会出现“按左误出下、按上误出右”）；
- 底部按钮做了精简（去掉用不上的减速键），加速键挪到右手拇指位置。

## 悬浮快捷档条（`js/quickbar.js`）

| 按钮 | 作用 |
|---|---|
| 存 / 读 | 保存 / 读取当前槽位的即时状态 |
| 槽 | 切换 1~9 槽（数字键 1/2/3 对应快存/快读/切槽） |
| 屏 | 全屏切换 |
| 档 | 本地存档管理（列出所有槽位，可读取 / 删除） |
| 金 | 打开 EC 金手指面板 |
| 传 / 取 | 云同步上传 / 下载（没填秘钥时自动隐藏） |

**「档」** 是独立的 `emu/js/savemgr.js`：读同一份 IndexedDB 数据，按游戏分组列出所有槽位
（缩略图 / 保存时间 / 大小），可读取、可删除（删除会同时清掉该槽的截图与时间）。
它不改 `quickbar.js`，只在「槽」后面插一个按钮；不想要这个功能，删掉 `index.html` 里那行
`<script src="js/savemgr.js?...">` 即可。

槽位数据存在浏览器 IndexedDB（`EmulatorJS-states` / `states`），键名 `fcquick-<游戏>-slot<N>`；
每槽附带一条保存时间和一张缩略图（`fcshot-<游戏>-slot<N>`，JPEG dataURL）。

载入页就会显示档条：没有游戏时按「传 / 取」也能同步，存 / 读 / 金 会提示先载入游戏。

## 金手指（`js/ec-cheat.js`）

- 直接支持 EmuCheat 的 `.cht`（`[名称]` + `ON=` / `键=码` 两种写法），勾选后交给核心每帧锁定；
- 面板顶部有搜索框：按空格分词、**每个词都要命中**，权重为
  英文名 100/60/30、中文名 90/50/25、描述 8、文件名 6（完全相等 / 前缀 / 包含依次递减）；
- 内置一份常见中文别名表（魂斗罗→contra、天使之翼→captain tsubasa、最终幻想→final fantasy…），
  中英文都能搜；别名只在**完全等于**时展开，避免“热血足球3”被拆成 soccer/kunio 搜出一堆；
- 打开面板会自动定位当前游戏关联过的 cht（关联记录在 `localStorage.ecc_assoc`）。

清单来自 `emu/emucheat/list.json`，加 / 删 cht 后用 `emu/emucheat/gen_list.bat` 重新生成。

## 音乐侧栏（`js/sidebar.js` + `js/sidebar/ct2.js`）

左侧面板框架会按 ROM 的 iNES 头识别 mapper，选中《天使之翼2》时才显示专属工具：

- 写 `$0700` 触发游戏内 BGM 切换（`0x01` 为停止标记）；
- BGM 映射表在 `emu/music/music_config.js`，可用 `emu/music/music_config_editor.html` 可视化编辑；
- 「随」按钮随机播放池内曲目，可切换按编号 / 按曲子去重；
- 附带 NSF 播放（`js/gme_player.js`）。

## 「导入V」：电脑端 VirtuaNES 存档 → 网页槽位

`js/vnesconv.js` 把 `.st0~.st9` 解成通用状态，`js/fceumm-state.js` 再转成 fceumm 的 FCS + RASTATE，
写进 IndexedDB 对应槽位，刷新模拟器后按 `2` 读档即可。

`fceumm-state.js` 由工具生成（字段布局见文件头注释），不要手改。

## 游戏缓存（IndexedDB）

- 库：`GameSavesDB` / `RomStore`，记录 `{id, name, data}`，`id` 是文件名去扩展名；
- 首页「＋ 添加」多选写入；同名覆盖不询问；
- 列表里可单独删除；示例 ROM 可用「天使之翼2」按钮一键缓存
  （先试 `roms/天使之翼2.nes` 直链，失败再回退备用接口）。

## 启动加速与断网兜底

- 核心包按 `data/cores/reports/*.json` 里的 `buildStart` 做版本号，命中 IndexedDB 缓存就不再下载；
- `js/core-offline.js` 会把 reports JSON 存一份到 localStorage，断网时仍能点已缓存的游戏；
- 载入页在空闲时预取 `emulator.min.js` / 语言包 / 解压 worker（核心包**不**预取）。

## 目录结构

```
emu/
├── index.html          入口页（载入流程 + 缓存列表 + 默认键位）
├── README.md
├── LICENSE             EmulatorJS 许可证（GPL-3.0）
├── roms/               示例 ROM（天使之翼2.nes）
├── emucheat/           金手指：list.json / *.cht / gen_list.*
├── music/              音乐映射、NSF、编辑器
├── js/
│   ├── quickbar.js     悬浮快捷档条
│   ├── ec-cheat.js     EC 金手指面板
│   ├── sidebar.js      左侧面板框架
│   ├── sidebar/ct2.js  天使之翼2 专属工具
│   ├── vnesconv.js     .st0 → 通用状态
│   ├── fceumm-state.js 通用状态 → fceumm 槽位
│   └── core-offline.js 断网兜底
└── data/               EmulatorJS 运行时
    ├── loader.js / emulator.min.js / emulator.min.css
    ├── compression/    zip/7z 解压 worker
    ├── cores/          核心包（fceumm）
    └── localization/   语言包
```

## 静态托管注意

- 本仓库不含任何后端脚本，云同步必须另装服务端；没装时「传 / 取」会因没秘钥而隐藏；
- 示例 ROM 是直接静态文件，可被直链下载；想收紧就自己把 `emu/roms/` 从部署里排除；
- 有些静态托管默认对 `.data` / `.wasm` 返回错误的 MIME，如果核心加载失败，
  检查服务器有没有把 `.data` 映射成 `application/octet-stream`。
