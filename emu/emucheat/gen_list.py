#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 emucheat/list.json：扫描本目录下的 .cht 文件，输出 EC 金手指清单，
供模拟器 ec-cheat.js 在游戏没有同名 cht 时展示可选列表。

用法：
    python gen_list.py            # 默认：不带 v（文件小，cht 按浏览器默认缓存走）
    python gen_list.py --v        # 带 v：每个 cht 的内容 MD5 前 8 位，用于强缓存穿透
    python gen_list.py --no-v     # 同默认，显式写法

条目字段：{"name": 去扩展名, "file": 完整文件名}
  --v 时额外加 "v": 文件内容 MD5 前 8 位
      内容改过 -> v 变 -> cht URL 变 -> 穿透浏览器强缓存拿到新文件；
      内容没变 -> URL 不变 -> 强缓存继续命中，零请求开销。
      （代价：list.json 每条多 ~17 字节，1700 个 cht 约 +29 KB）
若本目录有 cn_index.json（由 gen_cn_index.py 从 cht.example.com 的索引生成），
会合并两个字段给搜索用：
    "c": 中文名（如「一九四三(日版)」）
    "t": 描述片段（前 60 字，如「…单人，2人轮换游戏，STG！」）
"""
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEXT_LIMIT = 60

args = [a.lower() for a in sys.argv[1:]]
if '--v' in args or '--with-v' in args:
    WITH_V = True
elif '--no-v' in args:
    WITH_V = False
else:
    WITH_V = False
for a in args:
    if a in ('-h', '--help', '/?'):
        print(__doc__)
        sys.exit(0)

cn = {}
cn_file = HERE / 'cn_index.json'
if cn_file.is_file():
    try:
        cn = json.loads(cn_file.read_text(encoding='utf-8'))
    except Exception as e:  # noqa: BLE001
        print('[WARN] cn_index.json 读取失败，忽略：%s' % e)

items = []
for p in sorted(HERE.glob('*.cht'), key=lambda x: x.stem):
    entry = {'name': p.stem, 'file': p.name}
    if WITH_V:
        entry['v'] = hashlib.md5(p.read_bytes()).hexdigest()[:8]
    extra = cn.get(p.name.lower())
    if extra:
        if extra.get('c'):
            entry['c'] = extra['c']
        if extra.get('t'):
            entry['t'] = extra['t'][:TEXT_LIMIT]
    items.append(entry)

out = HERE / 'list.json'
out.write_text(json.dumps(items, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
n_cn = sum(1 for it in items if it.get('c'))
n_tx = sum(1 for it in items if it.get('t'))
print('list.json 已生成：%d 个 cht（含中文名 %d、描述 %d，v=%s，%.1f KB，%s）'
      % (len(items), n_cn, n_tx, '带' if WITH_V else '不带', out.stat().st_size / 1024.0, out))
