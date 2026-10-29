# WebFC — FC 在线模拟器

基于 [EmulatorJS 4.2.3](https://emulatorjs.org)（fceumm 核心）的 FC（红白机）网页模拟器，
纯静态，不需要后端，直接丢到任意静态托管（GitHub Pages / Nginx / 对象存储）就能玩。

主要功能：

- **游戏缓存**：选一次 ROM 就存进浏览器 IndexedDB，之后从列表一键开玩
- **槽位存读档**：1~9 槽持久化（绕过 EmulatorJS 内置的内存槽位），带保存时间、载入自动选槽
- **EC 金手指**：直接吃 EmuCheat 的 `.cht`，面板里可搜索（中英文名/描述）
- **悬浮快捷档条**：存 / 读 / 槽 / 档 / 屏 / 金 / 传 / 取，手机横排、桌面竖排
- **「导入V」**：把电脑端 VirtuaNES 的 `.st0~.st9` 在浏览器里转成 fceumm 槽位档
- **音乐侧栏**：天使之翼2 的 BGM 映射、随机播放、NSF 播放（`emu/music/`）
- **云同步**：槽位快照全量上传/下载（需要你自己再部署一份同步服务端，本仓库不含）

详细说明见 **[emu/README.md](emu/README.md)**。

## 本地运行

本仓库是纯静态的，把仓库根目录当站点根即可：

```bat
python -m http.server 8080
```

然后打开 <http://localhost:8080/>（首页）或 <http://localhost:8080/emu/index.html>（模拟器）。

## 目录

| 路径 | 作用 |
|---|---|
| `index.html` | 游戏中心首页（进模拟器 + 本地缓存一览 + 云同步地址/秘钥设置） |
| `emu/index.html` | 模拟器入口（载入 ROM + 缓存列表 + 默认键位） |
| `emu/js/quickbar.js` | 悬浮快捷档条（存/读/槽/屏/金/传/取） |
| `emu/js/ec-cheat.js` | EC 金手指面板（cht 解析 + 搜索 + EC→核心码） |
| `emu/js/sidebar.js`、`emu/js/sidebar/ct2.js` | 左侧面板框架 / 天使之翼2 专属工具 |
| `emu/js/vnesconv.js`、`emu/js/fceumm-state.js` | 「导入V」转换链（VirtuaNES `.st0` → fceumm 槽位） |
| `emu/js/core-offline.js` | 断网兜底（核心 reports 缓存到 localStorage） |
| `emu/music/` | 音乐映射表、NSF 播放器、`music_config_editor.html` 编辑工具 |
| `emu/emucheat/` | 金手指：`list.json` + `*.cht` + `gen_list.py`（扫描目录生成清单） |
| `emu/roms/` | ROM 目录（仓库里只带一份示例《天使之翼2》） |
| `emu/data/` | EmulatorJS 运行时（核心包、解压 worker、语言包） |

## 加自己的游戏

1. 打开首页 → 点「＋ 添加」选本地 `.nes / .fds / .unf / .unif / .zip / .7z`（可多选），只进缓存不启动；
2. 或者直接把文件拖进模拟器页面（只启动，不入缓存）；
3. 缓存列表里点条目即玩，条目可单独删除。

> 仓库里只放了一份示例 ROM（`emu/roms/天使之翼2.nes`）用于演示首页的「天使之翼2」一键缓存按钮。
> 其它 ROM 请自备；ROM 版权归各自权利人，本仓库不再附带。

## 加自己的金手指

1. 把 `.cht` 放进 `emu/emucheat/`；
2. 运行 `gen_list.bat`（或 `python gen_list.py`）重新生成 `list.json`；
3. 刷新页面 → 左侧「金」→ 下拉里就能选到，支持中英文/描述搜索。

详见 [emu/emucheat/README.md](emu/emucheat/README.md)。

## 云同步

仓库不含后端。想要多设备同步，需要自己部署一个兼容的同步服务端，然后：

- 首页「云同步接口地址」填接口 URL；
- 「同步秘钥」填口令；
- 悬浮条「传 / 取」即可上传/下载槽位快照（没有秘钥时这两个按钮自动隐藏）。

接口本身很薄（4 个 action，一张表），协议、字段、CORS 要求、请求/响应示例都写在
**[docs/sync-protocol.md](docs/sync-protocol.md)**，想自己用任意语言实现照着写即可。

## 许可

- EmulatorJS 部分遵循 GPL-3.0，见 `emu/LICENSE`；
- 本项目其余代码仅作个人学习/自用，不提供任何 ROM 或商业授权。
