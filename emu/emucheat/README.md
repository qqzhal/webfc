# emucheat

`list.json` 是金手指清单，由同目录的 `gen_list.py` 扫描本目录的 `*.cht` 生成。

## 加自己的金手指

1. 把 `.cht` 文件放进本目录（EC 格式，文件名随意，建议用游戏名）；
2. 运行 `gen_list.bat`（Git Bash / Linux 用 `./gen_list.sh`，或直接 `python gen_list.py`）；
3. 刷新模拟器页面，左侧「金」→ 面板下拉里就能选到。

`gen_list.py` 参数：

```
python gen_list.py            # 默认：条目不带 v（文件小）
python gen_list.py --v        # 带 v（每个 cht 内容 MD5 前 8 位，用于强缓存穿透）
python gen_list.py --no-v     # 同默认
```

> 本仓库只带了一份 `天使之翼2.cht` 作示例；`list.json` 里没有的 cht 不会出现在面板里。
