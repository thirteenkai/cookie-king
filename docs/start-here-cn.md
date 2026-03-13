# Cookie King 新手入口

如果你第一次接触这个项目，只看这 3 步：

1. 了解产品：看 `../README.md`
2. 配置后端：看 `../worker/README.md`
3. 查看商店状态：看 `chrome-web-store-cn.md`

## 你会用到的概念

- 插件：负责采集与恢复登录会话
- Worker：负责接收与分发会话数据
- KV：Worker 存储会话快照的数据空间

## 最短上手流程

1. 部署 Worker（网页部署或 CLI 部署二选一）。
2. 在插件填写 Worker 地址（`Server URL`）。
3. 推送端生成共享码并推送，接收端填写共享码并拉取。

## 常见问题

- 看不到明文 Cookie：正常，云端存的是加密密文。
- 删除推送记录：删除成功会移除对应云端记录。
- `Unauthorized owner`：通常是凭证过期或 KV 重建后失效，重新生成共享码重试。
