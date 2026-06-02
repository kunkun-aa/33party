const CONTENT = {
  terms: {
    title: "用户协议",
    sections: [
      {
        heading: "服务说明",
        paragraphs: [
          "33Party 为用户提供酒吧拼台、房间成员展示、聊天互动、管理员联系和现场协调用途的信息服务。用户应基于真实、合法、善意的目的使用本服务。",
          "继续使用本服务即表示你已阅读并同意《用户协议》《隐私政策》《社区规范》，并承诺本人已满 18 周岁。"
        ]
      },
      {
        heading: "账号与资料",
        paragraphs: [
          "用户应保证头像、昵称、性别等资料真实、友善、合法，不得冒充他人、盗用头像或通过虚假身份欺骗他人。",
          "账号名称、头像、简介及聊天内容不得包含违法违规或不良信息。平台可根据投诉、举报或巡查结果采取限制措施。"
        ]
      },
      {
        heading: "安全与处置",
        paragraphs: [
          "用户不得发布违法违规、涉黄涉暴、赌博、毒品、诈骗、引流灰产、广告刷屏、诱导转账、侵犯隐私等内容。",
          "平台有权对违规内容采取删除、限制展示、移除成员、封禁账号、保存证据并依法配合监管等措施。"
        ]
      },
      {
        heading: "未成年人限制",
        paragraphs: [
          "本服务面向年满 18 周岁的用户。未成年人不得使用本服务参与酒吧拼台、饮酒、线下聚会等活动。"
        ]
      }
    ]
  },
  privacy: {
    title: "隐私政策",
    sections: [
      {
        heading: "收集的信息",
        paragraphs: [
          "为提供房间成员展示、聊天互动、管理员联系、消息通知、安全风控和投诉处理，我们会收集头像、昵称、性别、微信 openid、聊天文字、语音、照片、视频、入局记录、桌台信息、管理员联系记录、订阅消息授权状态、举报与处理记录。",
          "上述信息用于识别你的房间身份、展示同桌成员、发送同桌新消息通知、协助管理员处理现场事务、处理投诉举报和保障平台安全。"
        ]
      },
      {
        heading: "信息展示",
        paragraphs: [
          "普通用户可看到同房间成员的头像、昵称、性别和在线状态等基础资料。平台不会向普通用户公开其他用户微信号、手机号等联系方式。",
          "管理员可在必要范围内查看成员资料、举报记录和处置记录，用于安全管理、投诉处理和现场协同。"
        ]
      },
      {
        heading: "信息共享与删除",
        paragraphs: [
          "我们不会出售个人信息，也不会将个人信息用于与本服务无关的商业转让。",
          "用户可联系实际运营主体申请删除账号和聊天数据。为满足投诉处理、安全审计或监管要求，部分记录可能会在必要期限内留存。"
        ]
      }
    ]
  },
  community: {
    title: "社区规范",
    sections: [
      {
        heading: "基本准则",
        paragraphs: [
          "为保障真实、安全、友善的拼台体验，用户不得发布或传播违法违规、色情低俗、暴力恐吓、赌博毒品、诈骗引流、广告刷屏、侵犯他人隐私、侮辱骚扰、冒充他人等内容。",
          "未经他人明确同意，不得公开他人的照片、微信号、手机号、位置、聊天记录等个人信息。"
        ]
      },
      {
        heading: "高风险行为",
        paragraphs: [
          "平台不鼓励陌生人私下转账、赌博、酒托、诱导消费等高风险行为。用户应自行判断线下见面风险，并遵守当地法律法规和场所管理要求。",
          "本服务面向年满 18 周岁的用户。未成年人不得使用本服务参与酒吧拼台、饮酒或线下聚会相关服务。"
        ]
      },
      {
        heading: "违规处理",
        paragraphs: [
          "平台有权对违规内容采取删除、限制展示、移除成员、封禁账号、保存证据并依法配合监管等措施。",
          "用户可通过消息长按举报、成员长按举报等入口提交投诉。管理员会根据举报原因、内容记录和现场情况进行处理。"
        ]
      }
    ]
  }
};

Page({
  data: {
    title: "",
    sections: [],
    theme: "dark"
  },

  onLoad(options = {}) {
    const app = getApp();
    const type = CONTENT[options.type] ? options.type : "terms";
    const content = CONTENT[type];
    this.setData({
      title: content.title,
      sections: content.sections,
      theme: app.getTheme ? app.getTheme() : "dark"
    });
  },

  onShow() {
    const app = getApp();
    this.setData({ theme: app.getTheme ? app.getTheme() : "dark" });
  },

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }
    wx.reLaunch({ url: "/frontend/pages/room/index" });
  }
});
