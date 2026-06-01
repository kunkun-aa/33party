const api = require("../../services/api");
const { buildRoom } = require("../../services/mock");
const { parseEntry } = require("../../utils/entry");

const app = getApp();

Page({
  data: {
    loading: true,
    entry: {},
    room: null,
    profileReady: false,
    profileForm: {
      avatarUrl: "",
      nickName: "",
      gender: "unknown",
      agreementAccepted: false,
      ageConfirmed: false
    },
    notifyReady: false,
    notifyEnabled: false,
    notifySaving: false,
    messageTemplateId: "",
    genderOptions: [
      { key: "female", label: "女" },
      { key: "male", label: "男" },
      { key: "unknown", label: "保密" }
    ],
    reportReasons: ["骚扰辱骂", "色情低俗", "诈骗引流", "广告刷屏", "侵犯隐私", "其他"],
    inputText: "",
    sending: false,
    flashEnabled: false,
    flashSeconds: 5,
    voiceRecording: false,
    voiceRecordSeconds: 0,
    voiceReview: null,
    chatScrollTarget: "",
    quotedMessage: null
  },

  onLoad(options) {
    const entry = parseEntry(options);
    this.setData({ entry });
    this.loadRemoteConfig();
    this.loadProfile();
    this.ensureOpenid();
    this.loadRoom(entry);
    this.initRecorder();
    this.initVoicePlayer();
  },

  onShow() {
    this.roomSocketClosedByPage = false;
    this.connectRoomSocket();
  },

  onHide() {
    this.closeRoomSocket();
  },

  onUnload() {
    this.closeRoomSocket();
    if (this.recordTimer) {
      clearInterval(this.recordTimer);
    }
    if (this.recorderManager && this.data.voiceRecording) {
      this.voiceRecordCanceled = true;
      this.recorderManager.stop();
    }
    if (this.voicePlayer) {
      this.voicePlayer.stop();
      this.voicePlayer.destroy();
    }
    this.stopFlashCountdown();
  },

  loadProfile() {
    const profile = app.globalData.userProfile || wx.getStorageSync("partyUserProfile");
    const accepted = !!(profile && (profile.agreementAccepted || profile.agreementAcceptedAt));
    const ageConfirmed = !!(profile && (profile.ageConfirmed || profile.ageConfirmedAt));
    if (profile && profile.nickName && profile.avatarUrl && accepted && ageConfirmed) {
      this.setData({
        profileReady: true,
        profileForm: {
          ...profile,
          agreementAccepted: true,
          ageConfirmed: true
        }
      });
    } else if (profile) {
      this.setData({
        profileForm: {
          ...this.data.profileForm,
          ...profile,
          agreementAccepted: accepted,
          ageConfirmed
        }
      });
    }
  },

  async loadRemoteConfig() {
    try {
      const config = await api.getConfig();
      this.setData({
        messageTemplateId: config.messageTemplateId || app.globalData.messageTemplateId || "",
        notifyReady: !!(config.messageTemplateId || app.globalData.messageTemplateId)
      });
    } catch (error) {
      const templateId = app.globalData.messageTemplateId || "";
      this.setData({
        messageTemplateId: templateId,
        notifyReady: !!templateId
      });
    }
  },

  ensureOpenid() {
    const profile = app.globalData.userProfile || wx.getStorageSync("partyUserProfile");
    if (profile && profile.openid) {
      return Promise.resolve(profile.openid);
    }
    if (!wx.login) {
      return Promise.resolve("");
    }
    if (this.openidPromise) {
      return this.openidPromise;
    }
    this.openidPromise = new Promise((resolve) => {
      wx.login({
        success: async (res) => {
          if (!res.code) {
            resolve("");
            return;
          }
          try {
            const loginRes = await api.userLogin(res.code);
            const currentProfile = app.globalData.userProfile || wx.getStorageSync("partyUserProfile") || {};
            const nextProfile = {
              ...currentProfile,
              ...(loginRes.user || {}),
              openid: loginRes.openid
            };
            app.saveUserProfile(nextProfile);
            this.setData({
              profileForm: {
                ...this.data.profileForm,
                ...(loginRes.user || {}),
                openid: loginRes.openid,
                agreementAccepted: !!(loginRes.user && loginRes.user.agreementAcceptedAt),
                ageConfirmed: !!(loginRes.user && loginRes.user.ageConfirmedAt)
              }
            });
            resolve(loginRes.openid || "");
          } catch (error) {
            console.warn("微信登录同步失败", error);
            resolve("");
          }
        },
        fail: () => resolve("")
      });
    });
    return this.openidPromise;
  },

  async loadRoom(entry) {
    this.setData({ loading: true });
    try {
      const room = await api.getRoomByEntry(entry);
      const mergedRoom = this.mergeLocalRoomMessages(room);
      this.setData({
        room: this.prepareFlashMessages(mergedRoom),
        loading: false
      });
      this.persistRoomMessages();
      this.cacheVisibleMedia();
      this.startFlashCountdown();
      this.scrollChatToBottom();
      this.connectRoomSocket();
    } catch (error) {
      console.warn("房间接口加载失败，已回退到本地演示数据", error);
      const room = this.prepareFlashMessages(buildRoom(entry));
      this.setData({
        room,
        loading: false
      });
      this.startFlashCountdown();
      this.scrollChatToBottom();
      wx.showToast({
        title: "后端连接失败，已显示演示数据",
        icon: "none"
      });
    }
  },

  onChooseAvatar(event) {
    this.setData({
      "profileForm.avatarUrl": event.detail.avatarUrl
    });
  },

  onPickAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (file && file.tempFilePath) {
          this.setData({
            "profileForm.avatarUrl": file.tempFilePath
          });
        }
      },
      fail: () => {
        wx.showToast({
          title: "已取消选择头像",
          icon: "none"
        });
      }
    });
  },

  onNickNameInput(event) {
    const value = event.detail && event.detail.value !== undefined ? event.detail.value : event.detail;
    this.setData({
      "profileForm.nickName": value || ""
    });
  },

  onGenderTap(event) {
    const dataset = event.currentTarget.dataset || event.detail && event.detail.currentTarget && event.detail.currentTarget.dataset || event.detail || {};
    this.setData({
      "profileForm.gender": dataset.gender
    });
  },

  toggleAgreement() {
    const checked = !(this.data.profileForm.agreementAccepted && this.data.profileForm.ageConfirmed);
    this.setData({
      "profileForm.agreementAccepted": checked,
      "profileForm.ageConfirmed": checked
    });
  },

  openLegal(event) {
    const type = event.currentTarget.dataset.type || "terms";
    wx.navigateTo({ url: `/frontend/pages/legal/index?type=${type}` });
  },

  async onSaveProfile() {
    const { profileForm } = this.data;
    if (!profileForm.avatarUrl || !profileForm.nickName.trim()) {
      wx.showToast({
        title: "请补全头像和昵称",
        icon: "none"
      });
      return;
    }
    if (!profileForm.agreementAccepted || !profileForm.ageConfirmed) {
      wx.showToast({
        title: "请先同意协议并确认已满 18 周岁",
        icon: "none"
      });
      return;
    }

    try {
      const openid = await this.ensureOpenid();
      const profile = await api.updateUserProfile({
        ...profileForm,
        openid: profileForm.openid || openid,
        nickName: profileForm.nickName.trim(),
        gender: profileForm.gender || "unknown",
        agreementAccepted: true,
        ageConfirmed: true
      });
      app.saveUserProfile(profile);
      let joinedRoom = null;
      if (this.data.room && profile.id) {
        joinedRoom = await api.joinParty(this.data.room.partyId, this.data.room.tableId, profile.id);
      }
      this.setData({
        profileReady: true,
        profileForm: profile,
        room: joinedRoom || this.data.room
      });
      this.scrollChatToBottom();
      this.requestMessageSubscription();
    } catch (error) {
      wx.showToast({
        title: error.message || "进入失败",
        icon: "none"
      });
    }
  },

  async ensureProfileSynced() {
    const { profileForm, profileReady } = this.data;
    if (!profileReady || !profileForm.nickName || !profileForm.avatarUrl) {
      return profileForm;
    }
    if (profileForm.remoteSynced) {
      return profileForm;
    }

    try {
      const openid = await this.ensureOpenid();
      const synced = await api.updateUserProfile({
        ...profileForm,
        openid: profileForm.openid || openid,
        agreementAccepted: true,
        ageConfirmed: true
      });
      const nextProfile = {
        ...profileForm,
        ...synced,
        remoteSynced: true
      };
      app.saveUserProfile(nextProfile);
      this.setData({ profileForm: nextProfile });
      return nextProfile;
    } catch (error) {
      console.warn("用户资料同步失败，继续使用本地资料", error);
      return profileForm;
    }
  },

  initRecorder() {
    if (!wx.getRecorderManager) {
      return;
    }
    this.recorderManager = wx.getRecorderManager();
    this.recorderManager.onStop((res) => this.handleRecordStop(res));
    this.recorderManager.onError((error) => {
      console.warn("录音失败", error);
      this.stopRecordTimer();
      this.setData({
        voiceRecording: false,
        voiceRecordSeconds: 0
      });
      wx.showToast({ title: "录音暂不可用", icon: "none" });
    });
  },

  initVoicePlayer() {
    if (!wx.createInnerAudioContext) {
      return;
    }
    this.voicePlayer = wx.createInnerAudioContext();
    this.voicePlayer.onEnded(() => this.markVoicePlaying(""));
    this.voicePlayer.onStop(() => this.markVoicePlaying(""));
    this.voicePlayer.onError((error) => {
      console.warn("语音播放失败", error);
      this.markVoicePlaying("");
      wx.showToast({ title: "语音暂不可播放", icon: "none" });
    });
  },

  openMap() {
    const venue = this.data.room && this.data.room.venue;
    if (!venue || !venue.latitude || !venue.longitude) {
      wx.showToast({ title: "暂无可导航坐标", icon: "none" });
      return;
    }
    wx.openLocation({
      latitude: Number(venue.latitude),
      longitude: Number(venue.longitude),
      name: venue.name,
      address: venue.address,
      scale: 16
    });
  },

  onInput(event) {
    const value = event.detail && event.detail.value !== undefined ? event.detail.value : event.detail;
    this.setData({
      inputText: value || ""
    });
  },

  async onSendText() {
    const text = this.data.inputText.trim();
    if (!text || this.data.sending || !this.data.room) {
      return;
    }

    this.setData({ sending: true });
    const profile = await this.ensureProfileSynced();
    const message = {
      type: "text",
      senderId: profile.id,
      isMine: true,
      sender: profile.nickName,
      avatar: profile.avatarUrl,
      time: this.formatTime(new Date()),
      text,
      quote: this.data.quotedMessage
    };
    try {
      const saved = await api.sendRoomMessage(this.data.room.partyId, this.data.room.tableId, message);
      this.appendMessage(saved);
      this.setData({ inputText: "", quotedMessage: null });
    } catch (error) {
      console.warn("消息发送失败，已本地追加", error);
      this.appendMessage({ ...message, id: `local_msg_${Date.now()}` });
      this.setData({ inputText: "", quotedMessage: null });
      wx.showToast({ title: "后端暂未接收，已本地显示", icon: "none" });
    } finally {
      this.setData({ sending: false });
    }
  },

  onVoiceTouchStart() {
    if (!this.data.room || this.data.sending || this.data.voiceRecording) {
      return;
    }
    if (!this.recorderManager) {
      wx.showToast({ title: "当前环境不支持录音", icon: "none" });
      return;
    }
    this.recordStartedAt = Date.now();
    this.setData({
      voiceRecording: true,
      voiceRecordSeconds: 0,
      voiceReview: null
    });
    this.startRecordTimer();
    try {
      this.recorderManager.start({
        duration: 60000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: "mp3"
      });
    } catch (error) {
      console.warn("启动录音失败", error);
      this.stopRecordTimer();
      this.setData({
        voiceRecording: false,
        voiceRecordSeconds: 0
      });
      wx.showToast({ title: "录音权限未开启", icon: "none" });
    }
  },

  onVoiceTouchEnd() {
    if (this.data.voiceRecording) {
      this.finishVoiceRecord();
    }
  },

  finishVoiceRecord() {
    if (!this.data.voiceRecording || !this.recorderManager) {
      return;
    }
    this.recorderManager.stop();
  },

  cancelVoiceRecord() {
    if (this.data.voiceRecording && this.recorderManager) {
      this.voiceRecordCanceled = true;
      this.recorderManager.stop();
    }
    this.stopRecordTimer();
    this.setData({
      voiceRecording: false,
      voiceRecordSeconds: 0,
      voiceReview: null
    });
  },

  handleRecordStop(res = {}) {
    const durationSeconds = Math.max(Math.round((res.duration || (Date.now() - this.recordStartedAt)) / 1000), 1);
    const wasCanceled = this.voiceRecordCanceled;
    this.voiceRecordCanceled = false;
    this.stopRecordTimer();
    this.setData({
      voiceRecording: false,
      voiceRecordSeconds: 0
    });
    if (wasCanceled) {
      return;
    }
    if (!res.tempFilePath) {
      wx.showToast({ title: "录音没有生成文件", icon: "none" });
      return;
    }
    if (durationSeconds < 1) {
      wx.showToast({ title: "录音时间太短", icon: "none" });
      return;
    }
    this.setData({
      voiceReview: {
        tempFilePath: res.tempFilePath,
        durationSeconds,
        duration: `${durationSeconds}''`
      }
    });
  },

  startRecordTimer() {
    this.stopRecordTimer();
    this.recordTimer = setInterval(() => {
      const seconds = Math.max(Math.floor((Date.now() - this.recordStartedAt) / 1000), 0);
      this.setData({ voiceRecordSeconds: seconds });
    }, 300);
  },

  stopRecordTimer() {
    if (this.recordTimer) {
      clearInterval(this.recordTimer);
      this.recordTimer = null;
    }
  },

  discardVoiceReview() {
    this.setData({ voiceReview: null });
  },

  async sendVoiceReview() {
    const review = this.data.voiceReview;
    if (!review || this.data.sending) {
      return;
    }
    if (!this.data.room) {
      return;
    }
    this.setData({ sending: true });
    const profile = await this.ensureProfileSynced();
    const message = {
      type: "voice",
      senderId: profile.id,
      isMine: true,
      sender: profile.nickName || "我",
      avatar: profile.avatarUrl,
      time: this.formatTime(new Date()),
      duration: review.duration,
      durationSeconds: review.durationSeconds,
      voicePath: review.tempFilePath,
      text: "语音消息",
      quote: this.data.quotedMessage
    };
    try {
      const saved = await api.sendRoomMessage(this.data.room.partyId, this.data.room.tableId, message);
      this.appendMessage(saved);
      this.setData({ voiceReview: null, quotedMessage: null });
    } catch (error) {
      console.warn("语音消息发送失败，已本地追加", error);
      this.appendMessage({ ...message, id: `local_voice_${Date.now()}` });
      this.setData({ voiceReview: null, quotedMessage: null });
    } finally {
      this.setData({ sending: false });
    }
  },

  onChoosePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image", "video"],
      sourceType: ["album", "camera"],
      success: async (res) => {
        const profile = await this.ensureProfileSynced();
        const file = res.tempFiles[0];
        const isVideo = file.fileType === "video" || /\.(mp4|mov|m4v)$/i.test(file.tempFilePath || "");
        const message = {
          type: isVideo ? "video" : "photo",
          senderId: profile.id,
          isMine: true,
          sender: profile.nickName || "我",
          avatar: profile.avatarUrl,
          time: this.formatTime(new Date()),
          text: "",
          image: isVideo ? "" : file.tempFilePath,
          video: isVideo ? file.tempFilePath : "",
          mediaUrl: file.tempFilePath,
          likeCount: 0,
          isFlash: !isVideo && this.data.flashEnabled,
          flashSeconds: this.data.flashSeconds,
          flashRemainingSeconds: !isVideo && this.data.flashEnabled ? this.data.flashSeconds : 0,
          quote: this.data.quotedMessage
        };
        try {
          const saved = await api.sendRoomMessage(this.data.room.partyId, this.data.room.tableId, message);
          this.appendMessage(saved);
          this.setData({ quotedMessage: null });
        } catch (error) {
          console.warn("媒体消息发送失败，已本地追加", error);
          this.appendMessage({ ...message, id: `local_media_${Date.now()}` });
          this.setData({ quotedMessage: null });
        }
      }
    });
  },

  onQuoteMessage(event) {
    const message = this.findMessageById(event.currentTarget.dataset.id);
    if (!message) {
      return;
    }
    wx.showActionSheet({
      itemList: ["引用", "举报"],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.setData({ quotedMessage: this.buildQuoteFromMessage(message) });
          wx.showToast({ title: "已引用消息", icon: "none" });
          return;
        }
        this.chooseReportReason({
          targetType: "message",
          targetId: message.id,
          targetUserId: message.senderId
        });
      }
    });
  },

  onReportMember(event) {
    const userId = event.currentTarget.dataset.userId;
    if (!userId || userId === (this.data.profileForm && this.data.profileForm.id)) {
      return;
    }
    this.chooseReportReason({
      targetType: "user",
      targetId: userId,
      targetUserId: userId
    });
  },

  chooseReportReason(target) {
    if (!this.data.profileReady || !this.data.profileForm.id) {
      wx.showToast({ title: "请先完善资料", icon: "none" });
      return;
    }
    wx.showActionSheet({
      itemList: this.data.reportReasons,
      success: (res) => {
        const reason = this.data.reportReasons[res.tapIndex];
        this.submitReport(target, reason);
      }
    });
  },

  async submitReport(target, reason) {
    const room = this.data.room || {};
    try {
      await api.submitReport({
        partyId: room.partyId,
        tableId: room.tableId,
        reporterType: "user",
        reporterId: this.data.profileForm.id,
        targetType: target.targetType,
        targetId: target.targetId,
        targetUserId: target.targetUserId,
        reason
      });
      wx.showToast({ title: "举报已提交", icon: "none" });
    } catch (error) {
      console.warn("举报提交失败", error);
      wx.showToast({ title: error.message || "举报提交失败", icon: "none" });
    }
  },

  clearQuote() {
    this.setData({ quotedMessage: null });
  },

  findMessageById(id) {
    return (this.data.room && this.data.room.messages || []).find((message) => message.id === id);
  },

  buildQuoteFromMessage(message) {
    const summary = this.getQuoteSummary(message);
    return {
      id: message.id,
      sender: message.sender || "对方",
      type: message.type || "text",
      text: message.text || "",
      mediaUrl: message.image || message.video || message.voicePath || "",
      durationSeconds: message.durationSeconds || 0,
      summary
    };
  },

  getQuoteSummary(message = {}) {
    if (message.type === "photo") {
      return "[图片]";
    }
    if (message.type === "video") {
      return "[视频]";
    }
    if (message.type === "voice") {
      return message.duration ? `[语音 ${message.duration}]` : "[语音]";
    }
    return message.text || "消息";
  },

  onPlayVoice(event) {
    const message = this.findMessageById(event.currentTarget.dataset.id);
    if (!message) {
      return;
    }
    const src = message.voicePath || message.image || "";
    if (!src) {
      wx.showToast({ title: "这条语音暂无音频文件", icon: "none" });
      return;
    }
    if (!this.voicePlayer) {
      this.initVoicePlayer();
    }
    if (!this.voicePlayer) {
      wx.showToast({ title: "当前环境不支持播放", icon: "none" });
      return;
    }
    if (message.playing) {
      this.voicePlayer.stop();
      this.markVoicePlaying("");
      return;
    }
    this.voicePlayer.stop();
    this.voicePlayer.src = src;
    this.voicePlayer.play();
    this.markVoicePlaying(message.id);
  },

  previewMedia(event) {
    const message = this.findMessageById(event.currentTarget.dataset.id);
    if (!message) {
      return;
    }
    if (message.type === "photo" && message.image) {
      const urls = (this.data.room && this.data.room.messages || [])
        .filter((item) => item.type === "photo" && item.image && !item.flashExpired)
        .map((item) => item.image);
      wx.previewImage({
        current: message.image,
        urls: urls.length ? urls : [message.image]
      });
      return;
    }
    if (message.type === "video" && message.video && wx.previewMedia) {
      wx.previewMedia({
        current: 0,
        sources: [{ url: message.video, type: "video" }]
      });
    }
  },

  previewAvatar(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) {
      return;
    }
    const memberUrls = (this.data.room && this.data.room.members || [])
      .map((member) => member.avatar)
      .filter(Boolean);
    const messageUrls = (this.data.room && this.data.room.messages || [])
      .map((message) => message.avatar)
      .filter(Boolean);
    const seen = {};
    const urls = [url, ...memberUrls, ...messageUrls].filter((item) => {
      if (seen[item]) {
        return false;
      }
      seen[item] = true;
      return true;
    });
    wx.previewImage({
      current: url,
      urls: urls.length ? urls : [url]
    });
  },

  markVoicePlaying(id) {
    const messages = (this.data.room && this.data.room.messages || []).map((message) => ({
      ...message,
      playing: message.id === id
    }));
    this.setData({ "room.messages": messages });
  },

  updateMessage(id, patch) {
    const messages = (this.data.room && this.data.room.messages || []).map((message) => {
      if (message.id === id) {
        return { ...message, ...patch };
      }
      return message;
    });
    this.setData({ "room.messages": messages });
    this.persistRoomMessages();
  },

  toggleFlash() {
    this.setData({ flashEnabled: !this.data.flashEnabled });
  },

  setFlashSeconds(event) {
    this.setData({ flashSeconds: Number(event.currentTarget.dataset.seconds) });
  },

  async onLike(event) {
    const { id } = event.currentTarget.dataset;
    if (!this.data.room) {
      return;
    }
    try {
      await api.likeMessage(this.data.room.partyId, id);
    } catch (error) {
      console.warn("点赞同步失败，已本地计数", error);
    }
    const messages = this.data.room.messages.map((item) => {
      if (item.id === id) {
        return {
          ...item,
          likeCount: (item.likeCount || 0) + 1
        };
      }
      return item;
    });
    this.setData({
      "room.messages": messages
    });
  },

  async onCopyManagerWechat() {
    const { room } = this.data;
    if (!room || !room.manager || !room.manager.wechatId) {
      wx.showToast({
        title: "暂无管理员微信",
        icon: "none"
      });
      return;
    }

    wx.setClipboardData({
      data: room.manager.wechatId,
      success: async () => {
        await api.recordManagerWechatAction(room.partyId, room.manager.id || room.manager.name);
        wx.showToast({
          title: "已复制管理员微信",
          icon: "none"
        });
      }
    });
  },

  async requestMessageSubscription() {
    if (this.data.notifySaving || this.data.notifyEnabled) {
      return;
    }
    const room = this.data.room;
    const templateId = this.data.messageTemplateId || app.globalData.messageTemplateId;
    const openid = await this.ensureOpenid();
    const profile = app.globalData.userProfile || this.data.profileForm;
    if (!room || !templateId || !openid || !profile || !profile.id || !wx.requestSubscribeMessage) {
      return;
    }
    this.setData({ notifySaving: true });
    try {
      const result = await new Promise((resolve, reject) => {
        wx.requestSubscribeMessage({
          tmplIds: [templateId],
          success: resolve,
          fail: reject
        });
      });
      const status = result[templateId] === "accept" ? "accepted" : "rejected";
      await api.saveMessageSubscription(room, profile.id, status, templateId);
      this.setData({ notifyEnabled: status === "accepted" });
    } catch (error) {
      console.warn("订阅消息授权失败", error);
    } finally {
      this.setData({ notifySaving: false });
    }
  },

  appendMessage(message) {
    const nextMessage = this.prepareDisplayMessage(message);
    if (!nextMessage || this.findMessageById(nextMessage.id)) {
      return;
    }
    this.setData({
      "room.messages": [...this.data.room.messages, nextMessage]
    });
    this.persistRoomMessages();
    this.cacheMessageMedia(nextMessage);
    this.startFlashCountdown();
    this.scrollChatToBottom();
  },

  replaceMessage(message) {
    const nextMessage = this.prepareDisplayMessage(message);
    if (!nextMessage || !nextMessage.id || !this.data.room) {
      return;
    }
    let replaced = false;
    const messages = (this.data.room.messages || []).map((item) => {
      if (item.id === nextMessage.id) {
        replaced = true;
        return {
          ...item,
          ...nextMessage
        };
      }
      return item;
    });
    if (!replaced) {
      messages.push(nextMessage);
    }
    this.setData({ "room.messages": messages });
    this.persistRoomMessages();
  },

  connectRoomSocket() {
    const room = this.data.room;
    if (!room || this.roomSocket) {
      return;
    }
    this.roomSocketClosedByPage = false;
    const socketTask = api.connectRoomSocket(room, {
      onOpen: () => {
        this.roomSocketReconnectDelay = 1000;
        this.sendRoomSocketPing();
      },
      onMessage: (payload) => this.handleRoomSocketMessage(payload),
      onClose: () => this.scheduleRoomSocketReconnect(),
      onError: (error) => {
        console.warn("实时消息连接失败", error);
      }
    });
    if (socketTask) {
      this.roomSocket = socketTask;
    }
  },

  closeRoomSocket() {
    this.roomSocketClosedByPage = true;
    if (this.roomSocketReconnectTimer) {
      clearTimeout(this.roomSocketReconnectTimer);
      this.roomSocketReconnectTimer = null;
    }
    if (this.roomSocketPingTimer) {
      clearInterval(this.roomSocketPingTimer);
      this.roomSocketPingTimer = null;
    }
    if (this.roomSocket) {
      this.roomSocket.close();
      this.roomSocket = null;
    }
  },

  scheduleRoomSocketReconnect() {
    this.roomSocket = null;
    if (this.roomSocketClosedByPage || !this.data.room) {
      return;
    }
    const delay = this.roomSocketReconnectDelay || 1000;
    this.roomSocketReconnectDelay = Math.min(delay * 2, 15000);
    if (this.roomSocketReconnectTimer) {
      return;
    }
    this.roomSocketReconnectTimer = setTimeout(() => {
      this.roomSocketReconnectTimer = null;
      this.connectRoomSocket();
    }, delay);
  },

  sendRoomSocketPing() {
    if (this.roomSocketPingTimer) {
      clearInterval(this.roomSocketPingTimer);
    }
    this.roomSocketPingTimer = setInterval(() => {
      if (this.roomSocket) {
        this.roomSocket.send({ data: JSON.stringify({ type: "ping" }) });
      }
    }, 30000);
  },

  handleRoomSocketMessage(payload = {}) {
    if (payload.type === "message.created" && payload.message) {
      this.appendMessage(payload.message);
      return;
    }
    if (payload.type === "message.updated" && payload.message) {
      this.replaceMessage(payload.message);
    }
  },

  scrollChatToBottom() {
    this.setData({ chatScrollTarget: "" });
    setTimeout(() => {
      this.setData({ chatScrollTarget: "chat-bottom" });
    }, 80);
  },

  prepareFlashMessages(room) {
    if (!room || !room.messages) {
      return room;
    }
    return {
      ...room,
      messages: room.messages.map((message) => this.prepareDisplayMessage(message))
    };
  },

  prepareDisplayMessage(message) {
    const nextMessage = this.prepareFlashMessage(message);
    if (nextMessage && nextMessage.quote && !nextMessage.quote.summary) {
      return {
        ...nextMessage,
        quote: {
          ...nextMessage.quote,
          summary: this.getQuoteSummary(nextMessage.quote)
        }
      };
    }
    return nextMessage;
  },

  prepareFlashMessage(message) {
    if (!message || !message.isFlash) {
      return message;
    }
    const expiresAt = this.getFlashExpiresAt(message);
    const remaining = expiresAt ? Math.max(Math.ceil((expiresAt - Date.now()) / 1000), 0) : Math.max(Number(message.flashRemainingSeconds || message.flashSeconds || 5), 0);
    const flashStartedAt = message.flashStartedAt || (expiresAt ? expiresAt - Math.max(Number(message.flashSeconds || remaining || 5), 1) * 1000 : Date.now());
    return {
      ...message,
      flashStartedAt,
      flashExpiresAt: message.flashExpiresAt || (expiresAt ? new Date(expiresAt).toISOString() : ""),
      flashRemainingSeconds: remaining,
      flashCountdownText: `${remaining} 秒后自动销毁`,
      flashExpired: message.flashExpired || remaining <= 0
    };
  },

  startFlashCountdown() {
    const hasActiveFlash = this.updateFlashCountdown();
    if (!hasActiveFlash || this.flashCountdownTimer) {
      return;
    }
    this.flashCountdownTimer = setInterval(() => {
      this.updateFlashCountdown();
    }, 1000);
  },

  stopFlashCountdown() {
    if (this.flashCountdownTimer) {
      clearInterval(this.flashCountdownTimer);
      this.flashCountdownTimer = null;
    }
  },

  updateFlashCountdown() {
    const room = this.data.room;
    const messages = room && room.messages || [];
    let hasActiveFlash = false;
    let changed = false;
    const nextMessages = messages.map((message) => {
      if (!message.isFlash || message.flashExpired) {
        return message;
      }
      const expiresAt = this.getFlashExpiresAt(message);
      const remaining = expiresAt ? Math.max(Math.ceil((expiresAt - Date.now()) / 1000), 0) : 0;
      hasActiveFlash = hasActiveFlash || remaining > 0;
      if (message.flashRemainingSeconds === remaining && message.flashExpired === (remaining <= 0)) {
        return message;
      }
      changed = true;
      return {
        ...message,
        flashRemainingSeconds: remaining,
        flashCountdownText: `${remaining} 秒后自动销毁`,
        flashExpired: remaining <= 0
      };
    });

    if (changed) {
      this.setData({ "room.messages": nextMessages });
      this.persistRoomMessages();
    }
    if (!hasActiveFlash) {
      this.stopFlashCountdown();
    }
    return hasActiveFlash;
  },

  getFlashExpiresAt(message) {
    if (!message || !message.isFlash) {
      return 0;
    }
    if (message.flashExpiresAt) {
      const timestamp = this.parseApiDate(message.flashExpiresAt).getTime();
      if (!isNaN(timestamp)) {
        return timestamp;
      }
    }
    const startedAt = message.flashStartedAt || Date.now();
    return startedAt + Math.max(Number(message.flashSeconds || 5), 1) * 1000;
  },

  parseApiDate(value) {
    if (!value) {
      return new Date(NaN);
    }
    const text = String(value);
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
      return new Date(text);
    }
    const parts = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (parts) {
      return new Date(Date.UTC(
        Number(parts[1]),
        Number(parts[2]) - 1,
        Number(parts[3]),
        Number(parts[4]) - 8,
        Number(parts[5]),
        Number(parts[6] || 0)
      ));
    }
    return new Date(text);
  },

  formatTime(date) {
    const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    const hour = `${beijing.getUTCHours()}`.padStart(2, "0");
    const minute = `${beijing.getUTCMinutes()}`.padStart(2, "0");
    return `${hour}:${minute}`;
  },

  getLocalMessageKey(room = this.data.room) {
    if (!room || !room.partyId || !room.tableId) {
      return "";
    }
    return `partyRoomMessages:${room.partyId}:${room.tableId}`;
  },

  mergeLocalRoomMessages(room) {
    const key = this.getLocalMessageKey(room);
    if (!key) {
      return room;
    }
    const localMessages = wx.getStorageSync(key) || [];
    const merged = [...localMessages, ...(room.messages || [])];
    const seen = {};
    const messages = [];
    merged.forEach((message) => {
      if (!message || !message.id || seen[message.id]) {
        return;
      }
      seen[message.id] = true;
      messages.push(message);
    });
    return {
      ...room,
      messages: messages.slice(-80)
    };
  },

  persistRoomMessages() {
    const room = this.data.room;
    const key = this.getLocalMessageKey(room);
    if (!key || !room || !room.messages) {
      return;
    }
    const messages = room.messages
      .filter((message) => message && !message.flashExpired)
      .slice(-80);
    wx.setStorageSync(key, messages);
  },

  cacheVisibleMedia() {
    const messages = this.data.room && this.data.room.messages || [];
    messages.forEach((message) => this.cacheMessageMedia(message));
  },

  cacheMessageMedia(message) {
    if (!message || message.localCached || message.isFlash) {
      return;
    }
    const mediaUrl = message.mediaUrl || message.image || message.video || message.voicePath || "";
    if (!/^https?:\/\//.test(mediaUrl) || !wx.downloadFile || !wx.getFileSystemManager) {
      return;
    }
    wx.downloadFile({
      url: mediaUrl,
      success: (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300 || !res.tempFilePath) {
          return;
        }
        wx.getFileSystemManager().saveFile({
          tempFilePath: res.tempFilePath,
          success: (saveRes) => {
            const savedPath = saveRes.savedFilePath;
            const patch = { localCached: true, mediaUrl: savedPath };
            if (message.type === "photo") {
              patch.image = savedPath;
            } else if (message.type === "video") {
              patch.video = savedPath;
            } else if (message.type === "voice") {
              patch.voicePath = savedPath;
            }
            this.updateMessage(message.id, patch);
            this.persistRoomMessages();
          }
        });
      }
    });
  }
});
