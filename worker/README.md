# Cookie King Worker

Cookie King 的 Cloudflare Worker 后端，用来接收、保存和分发加密后的会话快照。

## 你需要准备

- Cloudflare 账号
- 一个 KV 命名空间
- Node.js 18+（如果你选择 CLI 部署）

## 关键配置

`wrangler.toml` 中的 KV 绑定必须是：

```toml
[[kv_namespaces]]
binding = "COOKIE_STORE"
id = "YOUR_KV_NAMESPACE_ID"
```

说明：

- `binding` 必须保持为 `COOKIE_STORE`
- `id` 替换成你自己的 KV Namespace ID

## 部署方式 A：Cloudflare 网页部署

1. 创建 Worker。
2. 复制 `src/index.js` 到在线编辑器。
3. 创建一个 KV 命名空间。
4. 在 Worker Bindings 添加：
   - Variable name：`COOKIE_STORE`
   - Namespace：选择你的 KV
5. 部署并访问 `/api/health` 验证。

## 部署方式 B：本地 CLI 部署

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
- `GET /api/v3/channels/:channelId/sites/:siteId`
- `PUT /api/v3/channels/:channelId/sites/:siteId`
- `DELETE /api/v3/channels/:channelId/sites/:siteId`
- `DELETE /api/v3/channels/:channelId`

## 常见错误

- `401 Unauthorized owner`：owner 凭证失效，重新生成共享码后重试
- `403 Invalid read token`：共享码或读取凭证不匹配
- `403 Invalid write token`：写入凭证缺失或错误
- `404 Snapshot not found or expired`：记录不存在、过期或已删除
- `429 Rate limit exceeded`：请求过频

## 本地验证

```bash
npm test
node --check src/index.js
```

## 许可证

MIT
