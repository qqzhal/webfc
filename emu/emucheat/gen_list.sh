#!/usr/bin/env bash
# Linux 入口：执行本脚本，调用同目录的 gen_list.py 生成 list.json
# 用法：./gen_list.sh （首次使用需 chmod +x gen_list.sh）
cd "$(dirname "$0")" || exit 1

# 依次探测可用的 Python（Git Bash/Windows 下 python3 可能是商店假别名，
# command -v 能找到但一跑就失败，所以用试运行来确认真正可用）
PY=""
for cand in python3 python py; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c '' >/dev/null 2>&1; then
    PY="$cand"
    break
  fi
done

if [ -z "$PY" ]; then
  echo "Python not found. Please install Python 3 first."
  exit 1
fi

exec "$PY" gen_list.py
