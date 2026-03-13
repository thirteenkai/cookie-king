# Cookie King

把已经登录好的网站会话，从一个你授权的浏览器或设备，快速迁移到另一个你授权的浏览器或设备。少一次扫码，少一次短信验证，少一次从头整理环境。

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-%E5%AE%A1%E6%A0%B8%E4%B8%AD-1a73e8?logo=googlechrome&logoColor=white)](#获取方式)
[![Deploy Backend](https://img.shields.io/badge/Backend-Cloudflare%20Worker-f38020?logo=cloudflare&logoColor=white)](worker/README.md)
[![Privacy Policy](https://img.shields.io/badge/Privacy-Policy-2e7d32)](docs/chrome-store/privacy-policy-cn.md)

> 只适用于你有权限使用的账号与设备。不要把它用于未授权账号、公开共享或绕过目标网站安全策略。

## 它解决什么问题

- 新电脑、备用浏览器、临时环境接手工作时，不想重新登录一遍所有网站。
- 某些平台反复要求扫码、短信验证、二次确认，登录成本很高。
- 同一套工作环境需要在多个授权设备之间快速恢复，不想重复配置 Cookie、Storage 和站点状态。

## 为什么值得用

- 省时间：把已经可用的登录状态直接迁移过去，而不是重新闯一遍登录流程。
- 更稳：不只是 Cookie，还会一起处理站点存储数据，减少“看起来登录了但其实没进”的情况。
- 可控：后端由你自己部署，云端保存的是加密密文，不依赖公共共享服务器。

## 适合的场景

- 主浏览器已经登录，想把状态迁移到备用浏览器或新设备。
- 运营、测试、客服等工作流里，需要在授权设备之间快速恢复站点环境。
- 需要把一个已经可用的登录状态迁移到独立调试环境，减少重复验证。

## 它怎么工作

1. 在已登录页面采集当前站点的 Cookie 与 Storage。
2. 在浏览器本地完成加密，再上传到你自己的 Worker 后端。
3. 另一端通过共享码拉取密文快照并恢复登录状态。

云端看到的是密文，不是明文 Cookie。

## 获取方式

Chrome 应用商店版本正在审核中。审核通过后，这里会更新正式商店链接。

## 后端部署

你可以任选一种方式部署自己的后端：

### 方式 A：Cloudflare 网页部署

1. 在 Cloudflare 创建 Worker。
2. 把 `worker/src/index.js` 的内容粘贴到在线编辑器。
3. 创建一个 KV 命名空间。
4. 在 Worker Bindings 中添加：
   - Variable name：`COOKIE_STORE`
   - Namespace：选择你自己的 KV
5. 部署后访问 `https://<your-worker>.<subdomain>.workers.dev/api/health` 验证。

### 方式 B：本地 CLI 部署

```bash
cd worker
npm install
npx wrangler login
# 在 worker/wrangler.toml 填入你自己的 KV id
npm test
npm run deploy
```

更完整的部署说明见 [README.md](/Users/macbookpro/dev/Projects/cookie-king/worker/README.md)。

## 使用流程

1. 部署好 Worker，并拿到自己的 `workers.dev` 地址。
2. 在插件里填写 `Server URL`。
3. 在推送端点击“随机生成共享码”，再执行“一键推送”。
4. 在接收端填写同一个共享码，执行“一键登录”。

## 当前接口

当前正式接口只提供 `V3`：

- `GET /api/health`
- `POST /api/v3/owners/bootstrap`
- `POST /api/v3/channels`
- `GET /api/v3/owners/sites`
- `DELETE /api/v3/owners/sites`
- `GET | PUT | DELETE /api/v3/channels/:channelId/sites/:siteId`
- `DELETE /api/v3/channels/:channelId`

## 安全说明

- 会话快照在浏览器端加密后再上传。
- 拉取需要 `read token`。
- 推送和删除需要 `owner` 凭证与 `write token`。
- 删除云端记录不会保证目标网站立刻让已登录设备掉线，这取决于网站自身的会话策略。

## 常见问题

### 为什么 KV 里看不到具体 Cookie？

因为 Worker 存的是加密后的快照，核心字段是 `ciphertext`，不是明文 Cookie。

### 删除插件里的推送记录，会删云端吗？

删除成功时，会删除对应站点的云端快照。

### 为什么会出现 `Unauthorized owner`？

常见原因是 KV 被清空或重建后，本地旧的 owner 凭证失效。重新生成共享码并重新推送即可。
