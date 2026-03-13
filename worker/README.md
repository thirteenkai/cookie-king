# Cookie King Worker

Cookie King 的 Cloudflare Worker 后端实现。

## 前置条件

- Cloudflare 账号
- Node.js 18+
- npm

## 关键配置

`wrangler.toml` 中 KV 绑定必须使用：

```toml
[[kv_namespaces]]
binding = "COOKIE_STORE"
id = "YOUR_KV_NAMESPACE_ID"
```

说明：`id` 需要替换为你自己的 KV Namespace ID。

## 部署方式 A（Cloudflare 网页）

1. 在 Cloudflare 创建 Worker。
2. 把 `src/index.js` 内容粘贴到在线编辑器。
3. 创建 KV 并在 Worker Bindings 添加：
   - Variable name：`COOKIE_STORE`
   - Namespace：你自己的 KV
4. 部署后访问 `/api/health` 验证。

## 部署方式 B（本地 CLI）

```bash
npm install
npx wrangler login
npm test
npm run deploy
```

## API（仅 V3）

- `GET /api/health`
- `POST /api/v3/owners/bootstrap`
- `POST /api/v3/channels`
- `GET /api/v3/owners/sites`
- `DELETE /api/v3/owners/sites`
- `GET /api/v3/channels/:channelId/sites/:siteId`
- `PUT /api/v3/channels/:channelId/sites/:siteId`
- `DELETE /api/v3/channels/:channelId/sites/:siteId`
- `DELETE /api/v3/channels/:channelId`

历史说明：`/api/v2/*` 已停用，返回 `410`。

## 常见错误

- `403 Invalid read token`：共享码或读取凭证不匹配
- `403 Invalid write token`：写入凭证缺失或错误
- `401 Unauthorized owner`：owner 凭证失效，重新 bootstrap/生成共享码后重试
- `404 Snapshot not found or expired`：记录不存在、已过期或已删除
- `429 Rate limit exceeded`：请求过频

## 本地验证

```bash
npm test
node --check src/index.js
```

## 许可证

MIT
