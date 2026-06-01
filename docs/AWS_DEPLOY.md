# 33Party AWS Linux 发布手册

本文档面向一台普通 AWS EC2 Linux 服务器，目标是把后端部署为 HTTPS API，并让微信小程序正式版可以访问。

## 1. 准备域名和服务器

建议准备：

- API 域名：`api.example.com`
- 一台 Ubuntu 22.04 或 Amazon Linux 2023 EC2
- 安全组开放：`80`、`443`、`22`

把 `api.example.com` 的 DNS A 记录指向 EC2 公网 IP。

## 2. 安装系统依赖

Ubuntu:

```bash
sudo apt update
sudo apt install -y python3 nginx certbot python3-certbot-nginx git
```

Amazon Linux 2023:

```bash
sudo dnf update -y
sudo dnf install -y python3 nginx certbot python3-certbot-nginx git
```

## 3. 上传代码

推荐路径：

```bash
sudo mkdir -p /opt/33party /var/lib/33party /etc/33party
sudo chown -R "$USER":"$USER" /opt/33party
sudo useradd --system --home /opt/33party --shell /usr/sbin/nologin 33party || true
```

如果是 Amazon Linux，`nologin` 路径通常是 `/sbin/nologin`；若上一条命令提示路径不存在，改用：

```bash
sudo useradd --system --home /opt/33party --shell /sbin/nologin 33party || true
```

把当前项目上传到 `/opt/33party`，确保服务器上存在：

```text
/opt/33party/backend/server.py
/opt/33party/backend/schema.sql
/opt/33party/deploy/33party.service
/opt/33party/deploy/nginx-33party.conf
```

## 4. 配置后端环境变量

```bash
sudo cp /opt/33party/deploy/backend.env.example /etc/33party/backend.env
sudo nano /etc/33party/backend.env
```

至少修改：

```bash
APP_ENV=production
PUBLIC_API_BASE_URL=https://api.example.com
REQUIRE_ADMIN_AUTH=1
ADMIN_API_KEY=一串足够长的随机密钥
WECHAT_MINIPROGRAM_APPID=你的小程序 AppID
WECHAT_MINIPROGRAM_SECRET=你的小程序 AppSecret
```

生成随机管理员密钥示例：

```bash
openssl rand -hex 32
```

## 5. 安装 systemd 服务

```bash
sudo cp /opt/33party/deploy/33party.service /etc/systemd/system/33party.service
sudo chown -R 33party:33party /var/lib/33party
sudo systemctl daemon-reload
sudo systemctl enable --now 33party
sudo systemctl status 33party
```

检查本机服务：

```bash
curl http://127.0.0.1:7892/health
```

应返回：

```json
{"ok": true, "service": "33party-backend"}
```

查看运行日志：

```bash
sudo journalctl -u 33party -n 100 --no-pager
```

如果日志提示 `服务端未配置 ADMIN_API_KEY`，说明 `/etc/33party/backend.env` 没有配置管理员密钥，或 systemd 没有重新加载配置。修改后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl restart 33party
```

## 6. 配置 Nginx 和 HTTPS

先替换模板里的域名：

```bash
sudo cp /opt/33party/deploy/nginx-33party.conf /etc/nginx/conf.d/33party.conf
sudo sed -i 's/api.example.com/你的真实API域名/g' /etc/nginx/conf.d/33party.conf
sudo nginx -t
sudo systemctl reload nginx
```

签发 HTTPS 证书：

```bash
sudo certbot --nginx -d 你的真实API域名
```

检查线上健康接口：

```bash
curl https://你的真实API域名/health
```

## 7. 修改小程序生产 API 地址

编辑项目根目录的 `config.js`：

```js
const env = "prod";

const configs = {
  dev: {
    apiBaseUrl: "http://127.0.0.1:7893"
  },
  prod: {
    apiBaseUrl: "https://你的真实API域名"
  }
};
```

发布前请确认 `prod.apiBaseUrl` 不再是 `https://api.example.com`。微信正式版必须使用 HTTPS 域名，不能使用 IP、`localhost` 或 `127.0.0.1`。

## 8. 微信公众平台配置

在微信公众平台小程序后台配置：

- 开发管理 -> 开发设置 -> 服务器域名
- `request 合法域名` 添加：`https://你的真实API域名`

正式版不能使用 `http://127.0.0.1`，也不能依赖开发者工具里的“不校验合法域名”。

## 9. 管理员入口

管理员页路径：

```text
frontend/pages/admin/index?partyId=party_demo&adminId=admin_mimei
```

管理员页会调用 `wx.login`，后端通过微信 `code2session` 得到 openid，并校验 `admins.openid`。

首次绑定管理员 openid 可以用临时管理密钥完成：

```text
frontend/pages/admin/index?partyId=party_demo&adminId=admin_mimei&adminKey=你的管理员密钥
```

带 `adminKey` 打开一次后，前端会调用绑定接口，并换取 14 天有效的管理员 token。绑定完成后，日常使用不需要再把 `adminKey` 放到入口链接里。

也可以直接调用绑定接口：

```bash
curl -X POST "https://你的真实API域名/api/admin/bind-openid" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: 你的管理员密钥" \
  -d '{"adminId":"admin_mimei","code":"wx.login 拿到的 code"}'
```

`ADMIN_API_KEY` 是首次绑定和应急管理密钥，不建议公开传播。绑定后，管理员日常入口不需要带 `adminKey`。

生产环境不会自动把第一个登录的人绑定为管理员。这样可以避免管理员入口被别人提前打开后抢占管理员身份。

## 10. 用户入局

用户页路径：

```text
frontend/pages/room/index
```

参数使用桌台 `shareScene`：

```text
scene=table_a01
```

后端生成入局信息：

```bash
curl "https://你的真实API域名/api/admin/tables/invite?tableId=table_a01&adminId=admin_mimei&adminKey=你的管理员密钥"
```

直接下载小程序码：

```bash
curl -o table_a01.png "https://你的真实API域名/api/admin/tables/qrcode?tableId=table_a01&adminId=admin_mimei&adminKey=你的管理员密钥"
```

返回的 `urlLink` 依赖微信 AppID/AppSecret 配置成功。小程序码接口会返回 PNG 图片。

## 11. 提交微信审核前检查

必须确认：

- `config.js` 使用生产 HTTPS API 域名。
- `deploy/backend.env.example` 已复制为 `/etc/33party/backend.env`，且真实服务器上的 `ADMIN_API_KEY`、`WECHAT_MINIPROGRAM_APPID`、`WECHAT_MINIPROGRAM_SECRET` 已替换。
- 微信后台已配置合法 request 域名。
- `curl https://你的真实API域名/health` 正常。
- `sudo systemctl status 33party` 显示服务为 `active (running)`。
- `GET /api/admin/tables/invite` 能返回入局信息。
- `GET /api/admin/tables/qrcode` 能返回 PNG。
- 开发者工具中关闭“不校验合法域名”后仍能正常访问。
- 管理员入口不要公开给普通用户。
- 不要上传本地测试数据库，例如 `tmp_publish_test.db`、`backend/party.db`。
