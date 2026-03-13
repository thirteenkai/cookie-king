# Cookie King 变更记录

更新时间：2026-03-14

## 版本状态总览

- Chrome 商店审核版本：`extension 0.1.0`
- Worker 仓库发布版本：`worker v0.1.0`（Git tag）
- 本地未发布改动：存在（见下方“未发布变更”）

---

## 已发布变更

### 2026-03-13

#### [已发布] Worker 公共仓库（自部署）

- 范围：`/worker` 独立为公开仓库交付形态。
- 结果：
  - 新增 `.gitignore`、`LICENSE(MIT, kaylab)`、自部署 `README`。
  - `wrangler.toml` 使用占位符 `YOUR_KV_NAMESPACE_ID`（去标识化）。
  - 通过 `npm test` 与 `node --check src/index.js`。
  - 已推送到：`thirteenkai/Cookie-king-worker`，tag：`v0.1.0`。

#### [已发布] Chrome 商店资料整理与文档更新

- 范围：仓库文档与商店材料。
- 结果：
  - 商店文档迁移到 `docs/chrome-store/`。
  - 新增 `docs/README_CN.md` 文档导航。
  - 根目录新增 `releases/` 放置安装包。
  - 隐私政策、审核备注、商店文案已统一到当前产品逻辑。

---

## 未发布变更（本地代码）

### 2026-03-14

#### [未发布] 单仓公开改造（文档 + Worker）

- 范围：仓库边界、公开文档、部署说明。
- 变更：
  - 在 `cookie-king/` 初始化独立 git 仓。
  - `worker/.git` 从项目目录移除，Worker 并入单仓维护。
  - 根 `.gitignore` 新增 `extension/`，插件源码不进入公开仓。
  - `worker/wrangler.toml` 恢复占位符 `YOUR_KV_NAMESPACE_ID`。
  - 根 `README` 重写为对外产品文档，新增 Chrome 商店占位徽章与页面。
  - 移除内部运营文档（审核备注/提交流程），仅保留对外说明。
- 发布状态：
  - 尚未推送到公开远程仓库。

### 2026-03-13

#### [未发布] Unauthorized owner 自动自愈

- 文件：`extension/popup.js`
- 变更：
  - 新增 `requestJsonWithOwnerRetry`。
  - 当服务端返回 `401 Unauthorized owner` 时，自动清空旧 `ownerId/ownerToken`，重新 bootstrap owner，再重试一次请求。
- 目的：
  - 避免在 KV 重建/清空后，插件因本地旧 owner 凭证导致推送失败。
- 发布状态：
  - 尚未随新扩展版本提交 Chrome 商店。
  - 若要上线，建议作为 `0.1.1` 发布。

---

## 下次发布记录模板（复制后填写）

```md
### YYYY-MM-DD

#### [已发布/未发布] 标题
- 版本：extension X.Y.Z / worker vX.Y.Z
- 文件：列关键文件
- 变更：做了什么
- 影响：对用户/部署有什么影响
- 验证：测试或手测结果
```
