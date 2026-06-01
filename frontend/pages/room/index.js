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
      gender: "unknown"
    },
    genderOptions: [
      { key: "female", label: "女" },
      { key: "male", label: "男" },
      { key: "unknown", label: "保密" }
    ],
    inputText: "",
    sending: false,
    flashEnabled: false,
    flashSeconds: 5,
    voiceRecording: false,
    voiceRecordSeconds: 0,
    voiceReview: null,
    music: {
      playing: false,
      title: "台内背景音乐",
      src: "https://downsc.chinaz.net/Files/DownLoad/sound1/201906/11582.mp3"
    }
  },

  onLoad(options) {
    const entry = parseEntry(options);
    this.setData({ entry });
    this.loadProfile();
    this.loadRoom(entry);
    this.initMusic();
    this.initRecorder();
  },

  onUnload() {
    if (this.musicContext) {
      this.musicContext.stop();
      this.musicContext.destroy();
    }
    if (this.recordTimer) {
      clearInterval(this.recordTimer);
    }
    if (this.recorderManager && this.data.voiceRecording) {
      this.voiceRecordCanceled = true;
      this.recorderManager.stop();
    }
    this.stopFlashCountdown();
  },

  loadProfile() {
    const profile = app.globalData.userProfile || wx.getStorageSync("partyUserProfile");
    if (profile && profile.nickName && profile.avatarUrl) {
      this.setData({
        profileReady: true,
        profileForm: profile
      });
    }
  },

  async loadRoom(entry) {
    this.setData({ loading: true });
    try {
      const room = await api.getRoomByEntry(entry);
      this.setData({
        room: this.prepareFlashMessages(room),
        loading: false
      });
      this.startFlashCountdown();
    } catch (error) {
      console.warn("房间接口加载失败，已回退到本地演示数据", error);
      const room = this.prepareFlashMessages(buildRoom(entry));
      this.setData({
        room,
        loading: false
      });
      this.startFlashCountdown();
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

  async onSaveProfile() {
    const { profileForm } = this.data;
    if (!profileForm.avatarUrl || !profileForm.nickName.trim()) {
      wx.showToast({
        title: "请补全头像和昵称",
        icon: "none"
      });
      return;
    }

    const profile = await api.updateUserProfile({
      ...profileForm,
      nickName: profileForm.nickName.trim(),
      gender: profileForm.gender || "unknown"
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
      const synced = await api.updateUserProfile(profileForm);
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

  initMusic() {
    if (!wx.createInnerAudioContext) {
      return;
    }
    this.musicContext = wx.createInnerAudioContext();
    this.musicContext.loop = true;
    this.musicContext.volume = 0.32;
    this.musicContext.src = this.data.music.src;
    this.musicContext.onPlay(() => this.setData({ "music.playing": true }));
    this.musicContext.onPause(() => this.setData({ "music.playing": false }));
    this.musicContext.onStop(() => this.setData({ "music.playing": false }));
    this.musicContext.onError(() => {
      this.setData({ "music.playing": false });
      wx.showToast({ title: "音乐暂不可用", icon: "none" });
    });
    this.musicContext.play();
  },

  toggleMusic() {
    if (!this.musicContext) {
      this.initMusic();
      return;
    }
    if (this.data.music.playing) {
      this.musicContext.pause();
      return;
    }
    this.musicContext.play();
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
      text
    };
    try {
      const saved = await api.sendRoomMessage(this.data.room.partyId, this.data.room.tableId, message);
      this.appendMessage(saved);
      this.setData({ inputText: "" });
    } catch (error) {
      console.warn("消息发送失败，已本地追加", error);
      this.appendMessage({ ...message, id: `local_msg_${Date.now()}` });
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
      text: "语音消息"
    };
    try {
      const saved = await api.sendRoomMessage(this.data.room.partyId, this.data.room.tableId, message);
      this.appendMessage(saved);
      this.setData({ voiceReview: null });
    } catch (error) {
      console.warn("语音消息发送失败，已本地追加", error);
      this.appendMessage({ ...message, id: `local_voice_${Date.now()}` });
      this.setData({ voiceReview: null });
    } finally {
      this.setData({ sending: false });
    }
  },

  onChoosePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: async (res) => {
        const profile = await this.ensureProfileSynced();
        const file = res.tempFiles[0];
        const message = {
          type: "photo",
          senderId: profile.id,
          isMine: true,
          sender: profile.nickName || "我",
          avatar: profile.avatarUrl,
          time: this.formatTime(new Date()),
          text: "",
          image: file.tempFilePath,
          likeCount: 0,
          isFlash: this.data.flashEnabled,
          flashSeconds: this.data.flashSeconds,
          flashRemainingSeconds: this.data.flashEnabled ? this.data.flashSeconds : 0
        };
        try {
          const saved = await api.sendRoomMessage(this.data.room.partyId, this.data.room.tableId, message);
          this.appendMessage(saved);
        } catch (error) {
          console.warn("照片消息发送失败，已本地追加", error);
          this.appendMessage({ ...message, id: `local_photo_${Date.now()}` });
        }
      }
    });
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

  appendMessage(message) {
    const nextMessage = this.prepareFlashMessage(message);
    this.setData({
      "room.messages": [...this.data.room.messages, nextMessage]
    });
    this.startFlashCountdown();
  },

  prepareFlashMessages(room) {
    if (!room || !room.messages) {
      return room;
    }
    return {
      ...room,
      messages: room.messages.map((message) => this.prepareFlashMessage(message))
    };
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
        flashExpired: remaining <= 0
      };
    });

    if (changed) {
      this.setData({ "room.messages": nextMessages });
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
  }
});
