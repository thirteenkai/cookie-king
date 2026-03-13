# Cookie King

在你授权的设备之间同步网站登录会话（Cookie + Storage）的 Chrome 扩展方案。

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-%E5%BE%85%E5%AE%A1%E6%A0%B8-1a73e8?logo=googlechrome&logoColor=white)](docs/chrome-web-store-cn.md)
[![Worker Backend](https://img.shields.io/badge/Worker-Cloudflare-orange?logo=cloudflare&logoColor=white)](https://github.com/thirteenkai/Cookie-king-worker)
[![Privacy Policy](https://img.shields.io/badge/Privacy-Policy-2e7d32)](docs/chrome-store/privacy-policy-cn.md)

## 核心价值

- 一键推送：采集当前站点登录会话并加密上传。
- 一键登录：拉取会话并恢复到目标设备。
- 站点级自动同步：支持独立自动推送/拉取设置。
- 风险提示：识别易失效站点与常见失败信号。

## 快速开始

1. 在插件中填写 `Server URL`（你的 Worker 地址）。
2. 在推送端点击“随机生成共享码”，然后“一键推送”。
3. 在接收端填写共享码，点击“一键登录”。

## 后端部署（两种方式）

### 方式 A：Cloudflare 网页部署（免 Node）

1. 在 Cloudflare 创建 Worker。
2. 复制 `worker/src/index.js` 内容到在线编辑器并保存。
3. 创建 KV 命名空间（名称可自定义）。
4. 在 Worker Bindings 添加 KV 绑定：
   - Variable name：`COOKIE_STORE`
   - Namespace：选择你创建的 KV
5. 部署后访问 `https://<your-worker>.<subdomain>.workers.dev/api/health` 验证。

### 方式 B：本地 CLI 部署（Node + Wrangler）

```bash
cd worker
npm install
npx wrangler login
# 在 worker/wrangler.toml 填入你自己的 KV id
npm test
npm run deploy
```

## API 版本策略

- 当前唯一正式接口：`V3`
- 生产对接请使用 `/api/v3/*`

### 兼容矩阵

| Extension | Worker API |
|---|---|
| 0.1.x | V3 |

## 版本管理

- 公开仓：维护产品文档与 Worker 代码版本。
- 插件源码：建议放私有仓维护（便于回溯与紧急修复）。

## 安全与隐私

- 会话快照在浏览器端加密后上传，云端存储为密文。
- 拉取需要 `read token`；推送/删除需要 `owner` + `write token`。
- 删除云端记录不会强制让已登录设备立刻掉线（由目标网站策略决定）。

隐私政策：`docs/chrome-store/privacy-policy-cn.md`

## 文档

- 新手入口：`docs/start-here-cn.md`
- 文档导航：`docs/README_CN.md`
- 变更记录：`docs/CHANGELOG_CN.md`
- Worker 部署说明：`worker/README.md`
- Chrome 商店状态页：`docs/chrome-web-store-cn.md`

## 常见问题

- 为什么 KV 看不到明文 Cookie：因为服务端存的是加密密文（`ciphertext`）。
- 删除站点推送记录会删云端吗：删除成功会删除对应云端快照。
- 为什么报 `Unauthorized owner`：常见于重建/清空 KV 后本地旧凭证失效，重新生成共享码并再次推送即可。
- 历史路径说明：`/api/v2/*` 为历史测试路径，当前已停用（`410`）。
