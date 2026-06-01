# 33Party 上线验收清单

这份清单用于提交微信审核前的最后一轮验收。自动化脚本能证明后端主链路和前端关键接线，但微信订阅消息、合法域名、真机通知栏必须在真实小程序环境中确认。

## 自动化门禁

在项目根目录执行：

```bash
python3 scripts/release_check.py
```

脚本覆盖：

- 后端健康检查。
- 生产环境缺微信 AppID/Secret 时用户登录明确失败。
- 用户资料创建、入局、房间详情。
- 文字消息、照片闪照、点赞。
- WebSocket 房间连接和 `message.created` 广播。
- 媒体上传与上传文件访问。
- 订阅消息授权记录保存。
- 管理员鉴权、桌房列表、邀请信息、占位、设局头、踢人、更新管理员微信、创建新局、清理接口。
- 用户联系管理员允许，用户联系用户拒绝。
- 小程序 JSON 配置解析和关键前端接线检查。

如本机有 Node，可额外执行：

```bash
node --check app.js
node --check config.js
node --check frontend/services/api.js
node --check frontend/pages/room/index.js
node --check frontend/pages/admin/index.js
```

## 服务端配置

生产服务器 `/etc/33party/backend.env` 必须包含真实值：

```bash
APP_ENV=production
PUBLIC_API_BASE_URL=https://你的真实API域名
REQUIRE_ADMIN_AUTH=1
ADMIN_API_KEY=足够长的随机密钥
WECHAT_MINIPROGRAM_APPID=小程序 AppID
WECHAT_MINIPROGRAM_SECRET=小程序 AppSecret
WECHAT_MESSAGE_TEMPLATE_ID=订阅消息模板 ID
WECHAT_MINIPROGRAM_ENV_VERSION=release
```

部署后确认：

```bash
curl https://你的真实API域名/health
sudo systemctl status 33party
sudo journalctl -u 33party -n 100 --no-pager
```

## 微信后台配置

微信公众平台小程序后台需要配置：

- `request 合法域名`：`https://你的真实API域名`
- `socket 合法域名`：`wss://你的真实API域名`
- 订阅消息模板：用于房间新消息提醒。
- 模板 ID 与 `WECHAT_MESSAGE_TEMPLATE_ID` 一致。
- 模板关键词与后端字段一致：`thing1` 房间/主局，`thing2` 发送人，`thing3` 消息内容，`thing4` 桌号。

## 开发者工具检查

在微信开发者工具中：

- 执行“构建 npm”。
- 关闭“不校验合法域名、web-view 域名、TLS 版本以及 HTTPS 证书”。
- 预览用户房间页和管理员页。
- 控制台无 JS 报错、网络 4xx/5xx、WebSocket 连接失败。

## 真机用户验收

准备两台手机，两个不同微信账号，进入同一桌台。

用户端验收：

- 首次进入能完善头像、昵称、性别。
- 能看到主局、桌房、成员、管理员微信、酒吧地址。
- 点击成员头像或聊天头像，能放大预览头像。
- 复制管理员微信可用。
- 地图按钮可打开地址定位。
- 文字消息能发送，另一台手机即时收到。
- 语音录制、取消、发送、播放可用。
- 照片和视频选择、上传、展示可用。
- 闪照发送后显示倒计时，到期后不可见。
- 长按消息引用后发送，引用摘要正确。
- 点赞后另一台手机能同步看到点赞数变化。
- 点击“通知栏消息”能唤起微信订阅授权。
- 授权后退出小程序或切到后台，另一台手机发送消息，授权手机微信通知栏能收到订阅消息。
- 点击通知能回到对应房间页。

管理员端验收：

- 未带管理员密钥或 token 时，生产接口拒绝。
- 首次管理员 openid 绑定成功。
- 管理员页能看到桌房列表、人数、成员、最近消息、照片数量、入局码。
- 能复制入局码和入局链接。
- 能更新管理员微信，用户端显示同步更新。
- 能创建新局。
- 能将成员设为占位。
- 能设置和取消局头。
- 能移除未确认成员。
- 管理员能联系用户，用户之间互相联系被拒绝。

## 提交审核前

- `config.js` 的 `prod.apiBaseUrl` 是正式 HTTPS 域名。
- 本地测试数据库、上传文件、临时日志不随包发布。
- 管理员入口和 `ADMIN_API_KEY` 不公开给普通用户。
- 订阅消息文案符合微信审核要求，不承诺无限制通知。
