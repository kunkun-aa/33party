# 33party 后端

用于酒吧拼台微信小程序的本地后端原型。当前版本只依赖 Python 标准库，数据存储使用 SQLite，方便先把主流程、权限和接口形状跑通。

## 启动

```powershell
cd C:\Users\HuangKun\Desktop\33party
python backend\server.py 7892
```

如果本机 `7892` 被代理、系统策略或其他程序占用，可以临时换端口：

```powershell
python backend\server.py 7893
```

默认数据库会写入 `backend/party.db`，首次启动会自动创建表并写入一组演示数据。

## 核心规则

- 扫码或链接进入时，使用 `scene` 映射到主局或具体桌台。
- 第一次进入需要先调用资料接口写入头像、昵称、可选微信号。
- 聊天支持 `text`、`voice`、`photo`、`photo_burst` 和 `system` 消息类型。
- 房间内实时聊天使用 WebSocket：`/ws/room?partyId=...&tableId=...&userId=...`。
- 用户离开小程序后的通知栏提醒使用微信订阅消息；用户端先授权，后端在新消息写入后调用微信订阅消息接口，页面内不做自定义弹窗。
- 用户只能申请添加管理员微信，管理员可以查看/联系用户微信。
- 用户与用户之间互加微信在接口层直接拒绝，返回 `403`。

## 微信订阅消息配置

正式环境需要配置：

```text
WECHAT_MINIPROGRAM_APPID=小程序 AppID
WECHAT_MINIPROGRAM_SECRET=小程序 Secret
WECHAT_MESSAGE_TEMPLATE_ID=订阅消息模板 ID
WECHAT_MINIPROGRAM_ENV_VERSION=release
```

测试或回归环境如果只验证后端链路、不实际请求微信接口，可设置：

```text
DISABLE_WECHAT_SUBSCRIBE_SEND=1
WECHAT_MESSAGE_TEMPLATE_ID=test_template_id
```

当前订阅消息数据字段按“房间/主局、发送人、消息内容、桌号”组织，模板关键词需与后端 `send_wechat_message_subscription` 中的 `thing1`、`thing2`、`thing3`、`thing4` 对应。若微信后台模板关键词不同，需要同步调整后端字段名。

## 常用接口

```text
GET  /health
GET  /api/party/by-scene?scene=party_demo
POST /api/admin/login
POST /api/admin/bind-openid
POST /api/users/profile
POST /api/party/join
GET  /api/room?partyId=party_demo&tableId=table_a01&userId=user_demo_1
GET  /api/messages?partyId=party_demo&tableId=table_a01
POST /api/messages
POST /api/messages/subscribe
POST /api/photo-burst
GET  /api/admin/tables?partyId=party_demo&adminId=admin_mimei
GET  /api/admin/tables/invite?tableId=table_a01&adminId=admin_mimei
GET  /api/admin/tables/qrcode?tableId=table_a01&adminId=admin_mimei
POST /api/admin/profile
POST /api/admin/parties
POST /api/admin/members/seat
POST /api/admin/tables/head
POST /api/admin/members/kick
POST /api/contact/request
```

## 示例

```powershell
Invoke-RestMethod http://127.0.0.1:7892/health
Invoke-RestMethod "http://127.0.0.1:7892/api/party/by-scene?scene=table_a01"
```

更新管理员微信：

```json
{
  "adminId": "admin_mimei",
  "wechatId": "mia_party33",
  "displayName": "Mia 局头"
}
```

创建新局：

```json
{
  "adminId": "admin_mimei",
  "title": "周六拼台主局",
  "tableNo": "A01",
  "capacity": 8,
  "barName": "33 Party Lounge",
  "barAddress": "深圳市南山区后海中心路 33 Party Lounge"
}
```

获取入局链接与小程序码地址：

```powershell
Invoke-RestMethod "http://127.0.0.1:7892/api/admin/tables/invite?tableId=table_a01&adminId=admin_mimei"
```

直接下载小程序码 PNG：

```powershell
Invoke-WebRequest "http://127.0.0.1:7892/api/admin/tables/qrcode?tableId=table_a01&adminId=admin_mimei" -OutFile table_a01.png
```

用户添加管理员微信：

```json
{
  "partyId": "party_demo",
  "requesterType": "user",
  "requesterId": "user_demo_1",
  "targetType": "admin",
  "targetId": "admin_mimei"
}
```

用户添加用户微信会被拒绝：

```json
{
  "partyId": "party_demo",
  "requesterType": "user",
  "requesterId": "user_demo_1",
  "targetType": "user",
  "targetId": "user_demo_2"
}
```
