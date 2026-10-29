# 云同步协议（给想自己搭后端的人）

本仓库**只有前端**，不含任何服务端代码。悬浮条上的「传 / 取」默认是灰的（没秘钥时自动隐藏），
想用多设备同步，需要自己实现下面这套很薄的 HTTP 接口。

前端不会内置任何接口地址，用户在首页「云同步接口地址」里填什么，就请求什么。

## 数据模型

前端只在 IndexedDB 里挑三类记录上传，**不传 ROM、不传按键配置**：

| kind | 来源（浏览器 IndexedDB） | 键名约定 | 内容 |
|---|---|---|---|
| `meta` | `EmulatorJS-states` / `states` | `fcquick-meta-<游戏名>` | `{"槽号": 时间戳}` 的 JSON 文本 |
| `state` | 同上 | `fcquick-<游戏名>-slot<N>` | 核心序列化的即时存档二进制（FC 上约 30KB） |
| `shot` | 同上 | `fcshot-<游戏名>-slot<N>` | 槽位缩略图，`data:image/jpeg;base64,…` 文本 |
| `sram` | `/data/saves` / `FILE_DATA` | `/data/saves/<文件名>` | 电池存档（`.srm` 等）原始字节 |

约定：

- `saveKey` 就是上面那串键名，服务端只当**不透明唯一键**用；
- `romName`、`slot` 是给列表展示用的辅助字段，可以留空；
- 二进制一律 **base64** 传输，服务端存储时建议还原成字节（BLOB），别存 base64 文本（体积差 33%）。

## 接口

所有请求都带一个请求头（没配秘钥时可省略）：

```
X-Sync-Token: <秘钥>
```

响应统一为 JSON：成功 `{"ok":true, ...}`，失败 `{"ok":false,"error":"说明"}`（建议带 4xx 状态码）。

### `GET <base>?action=download`

返回服务器上的**全部**记录，用于「取」和列表展示：

```json
{
  "ok": true,
  "count": 2,
  "items": [
    {"saveKey":"fcquick-天使之翼2-slot1","kind":"state","romName":"天使之翼2","slot":"1",
     "data":"<base64>","uploaded_at":"2026-10-29 11:00:00"}
  ]
}
```

前端拿到后会**先清空本地** `fcquick-*` / `fcshot-*` 再写回，所以这个接口必须返回全量。

### `POST <base>?action=upload`

分批上传，每批一个 item：

```json
{
  "items": [{"saveKey":"fcquick-天使之翼2-slot1","kind":"state","romName":"天使之翼2","slot":"1","data":"<base64>"}],
  "keys": ["fcquick-天使之翼2-slot1","fcshot-天使之翼2-slot1","fcquick-meta-天使之翼2"],
  "final": true
}
```

- 按 `saveKey` 做 upsert（存在就覆盖）；
- **最后一批**会带 `keys` + `final:true`：服务端把「不在这份 keys 里」的旧记录删掉。
  这是全量语义——本地已不存在的旧记录，靠这一步让服务端也清掉；
- 响应 `{"ok":true,"upserted":N,"deleted":M}`。

## 跨域

前端和接口不同域时必须带 CORS：

```
Access-Control-Allow-Origin: <请求的 Origin>       # 或 *
Access-Control-Allow-Headers: Content-Type, X-Sync-Token
Access-Control-Allow-Methods: GET, POST, OPTIONS
```

并正确处理 `OPTIONS` 预检。

## 最小实现建议

语言随意，只要实现上面两个 action（全量 `download` / 分批 `upload` + final 清理）加 token 校验。
存储就是一张 `saveKey` 唯一键的表：

```
saveKey (主键) | kind | romName | slot | data (BLOB) | dataSize | uploaded_at
```

## 前端怎么配

1. 首页「云同步接口地址」填 `<base>`（例如 `https://example.com/sync.php`）；
2. 「同步秘钥」填口令（存 `localStorage.syncToken`，接口地址存 `localStorage.cloudSyncUrl`）；
3. 悬浮条「传 / 取」就会亮起来；两台设备填同一个地址+秘钥即可互通。

> 地址/秘钥只存在浏览器本地，不会随仓库或页面发布出去。
