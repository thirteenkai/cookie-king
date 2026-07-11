# Cookie King Worker

Cookie King 的 Cloudflare Worker 后端，用来接收、保存和分发加密后的会话快照。

## 你需要准备

- Cloudflare 账号
- 一个 KV 命名空间
- Durable Objects（通过仓库内 `wrangler.toml` 首次部署时自动创建）
- Node.js 18+（如果你选择 CLI 部署）

## 关键配置

`wrangler.toml` 中必须同时保留 Durable Object 与 KV 绑定：

```toml
[[durable_objects.bindings]]
name = "COORDINATOR"
class_name = "CookieKingCoordinator"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["CookieKingCoordinator"]

[[kv_namespaces]]
binding = "COOKIE_STORE"
id = "YOUR_KV_NAMESPACE_ID"
```

说明：

- `binding` 必须保持为 `COOKIE_STORE`
- `id` 替换成你自己的 KV Namespace ID
- `COORDINATOR` 保存强一致的身份、索引和限流状态；KV 仅保存带 TTL 的加密快照
- 不要删除或重复修改已部署的 `v1` migration tag

## 部署方式

使用 Wrangler CLI 部署。仅把 `src/index.js` 粘贴到网页编辑器不会执行 Durable Object migration，因此不属于受支持的部署方式。

```bash
npm install
npx wrangler login
npm test
npm run deploy
```

## 当前接口

当前仅提供 `V3`：

- `GET /api/health`
- `POST /api/v3/owners/bootstrap`
- `POST /api/v3/channels`
- `GET /api/v3/owners/sites`
- `DELETE /api/v3/owners/sites`
- `GET /api/v3/channels/:channelId/sites`
- `GET /api/v3/channels/:channelId/sites/:siteId`
- `PUT /api/v3/channels/:channelId/sites/:siteId`
- `DELETE /api/v3/channels/:channelId/sites/:siteId`
- `DELETE /api/v3/channels/:channelId`

## 常见错误

- `401 Unauthorized owner`：owner 凭证失效，重新生成共享码后重试
- `403 Invalid read token`：共享码或读取凭证不匹配
- `403 Invalid write token`：写入凭证缺失或错误
- `404 Snapshot not found or expired`：记录不存在、过期或已删除
- `413 Payload too large`：加密快照超过 20 MiB；更新 Worker 后重试，或临时改用仅 Cookie 模式
- `429 Rate limit exceeded`：请求过频

## 本地验证

```bash
npm test
node --check src/index.js
```

## 许可证

MIT
