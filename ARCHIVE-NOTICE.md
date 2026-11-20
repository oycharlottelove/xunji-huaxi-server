# 循迹·化析 · Node 服务端公开存档

本仓库是 **2026-11-20 优化版服务端源码** 的公开存档，不是可直接在线访问的网站。

## 重要说明

- 原始压缩包中 **没有** `public/` 目录，也没有 `netlify/functions/`；因此单独运行 `node server.js` 时缺少前端页面。
- 本仓库只存档服务端源码，不包含任何 API Key。请复制 `.env.example` 为 `.env`，填入自己的 `DEEPSEEK_API_KEY`。
- 原 `server.js` 内置了默认管理员密码；为了公开存档安全，本仓库已移除该默认值，部署前必须设置 `ADMIN_PASSWORD` 环境变量。
- 未包含运行日志 `server.log`、`server.err.log` 和旧版备份 `server.js.bak-20261120`。
- 原作者：hushx-deep；许可证：MIT（见 `LICENSE`）。
- 在线网站（主项目）：https://oycharlottelove.github.io/OY_AIGC/

## 启动方式（在补全前端后）

```bash
npm install
node server.js
```

然后访问 http://localhost:3000。若要以管理员身份进入后台，请先设置：

```bash
set ADMIN_PASSWORD=你自己的强密码
```

> 说明：本仓库仅用于课程作品存档与交流，请勿把任何真实师生信息、API Key 或未脱敏作业上传到公开仓库。