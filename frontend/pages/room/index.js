const api = require("../../services/api");
const { buildRoom } = require("../../services/mock");
const { parseEntry } = require("../../utils/entry");
const { EMOJI_GROUP_DATA, getEmojiGroupItems, findEmojiByIdOrValue } = require("../../utils/emoji-data");

const app = getApp();

const RECENT_EMOJI_STORAGE_KEY = "partyRecentEmojis";
const MAX_RECENT_EMOJIS = 16;
const RECENT_EMOJI_GROUP_KEY = "__recent";
const EMOJI_PAGE_SIZE = 40;
const EMOJI_GROUP_ICONS = {
  "smileys-emotion": "😀",
  "people-body": "👋",
  "component": "🏻",
  "animals-nature": "🌿",
  "food-drink": "🍻",
  "travel-places": "🚕",
  "activities": "🎉",
  "objects": "💡",
  "symbols": "❤️",
  "flags": "🏁"
};

function buildEmojiTabs(recentCount = 0) {
  const recentTab = recentCount > 0
    ? [{ key: RECENT_EMOJI_GROUP_KEY, icon: "◴", count: recentCount }]
    : [];
  return recentTab.concat(EMOJI_GROUP_DATA.map((group) => ({
    key: group.key,
    icon: EMOJI_GROUP_ICONS[group.key] || "☺",
    count: group.codes ? group.codes.split(",").length : 0
  })));
}

function findEmojiGroup(key) {
  return EMOJI_GROUP_DATA.find((group) => group.key === key) || EMOJI_GROUP_DATA[0] || { key: "", codes: "" };
}

function findEmoji(id, value) {
  return findEmojiByIdOrValue(id, value);
}

function chunkEmojiItems(items = []) {
  const pages = [];
  for (let index = 0; index < items.length; index += EMOJI_PAGE_SIZE) {
    pages.push({
      id: `emoji-page-${index / EMOJI_PAGE_SIZE}`,
      items: items.slice(index, index + EMOJI_PAGE_SIZE)
    });
  }
  return pages.length ? pages : [{ id: "emoji-page-empty", items: [] }];
}

function getEmojiPager(groupKey, recentEmojis = []) {
  const isRecent = groupKey === RECENT_EMOJI_GROUP_KEY;
  const items = isRecent ? recentEmojis : getEmojiGroupItems(findEmojiGroup(groupKey).key);
  return {
    pages: chunkEmojiItems(items),
    total: items.length
  };
}

function isLocalAvatar(path = "") {
  return /^(wxfile|http:\/\/tmp|file):\/\//.test(path) || /^\/(tmp|var|private|storage)\//.test(path);
}

function stableHash(value = "") {
  return String(value).split("").reduce((hash, char) => {
    return ((hash << 5) - hash + char.charCodeAt(0)) >>> 0;
  }, 2166136261);
}

const avatarPalettes = {
  male: ["#7cc7ff", "#2f7be8", "#ffd8b5", "#7b4b2a", "#1f2a44"],
  female: ["#ff9fc7", "#ff5fa2", "#ffe0bd", "#6b3a7a", "#4b294f"],
  unknown: ["#ffd66b", "#8ce99a", "#fff0c2", "#7a4f2b", "#263238"]
};

function buildAvatarCells(gender = "unknown", seed = "") {
  const type = gender === "male" || gender === "female" ? gender : "unknown";
  const palette = avatarPalettes[type];
  const hash = stableHash(`${type}:${seed || "guest"}`);
  const cells = [];
  const size = 13;
  const step = 100 / size;
  const paint = (x, y, color) => {
    if (x < 0 || x >= size || y < 0 || y >= size) {
      return;
    }
    cells.push({ key: `${x}-${y}-${cells.length}`, x, y, color });
  };
  const mirror = (x, y, color) => {
    paint(x, y, color);
    if (x !== size - 1 - x) {
      paint(size - 1 - x, y, color);
    }
  };

  if (type === "male") {
    for (let y = 1; y <= 4; y += 1) {
      for (let x = 3; x <= 9; x += 1) paint(x, y, palette[3]);
    }
    for (let y = 4; y <= 8; y += 1) {
      for (let x = 3; x <= 9; x += 1) paint(x, y, palette[2]);
    }
    mirror(4, 6, palette[4]);
    mirror(5, 9, "#d9816b");
    paint(6, 8, "#c96f5e");
    for (let x = 4; x <= 8; x += 1) paint(x, 10, palette[0]);
    for (let y = 11; y <= 12; y += 1) {
      for (let x = 2; x <= 10; x += 1) paint(x, y, y === 11 ? palette[0] : palette[1]);
    }
  } else if (type === "female") {
    for (let y = 1; y <= 7; y += 1) {
      for (let x = 2; x <= 10; x += 1) {
        if (y < 3 || x < 4 || x > 8) paint(x, y, palette[3]);
      }
    }
    for (let y = 4; y <= 8; y += 1) {
      for (let x = 3; x <= 9; x += 1) paint(x, y, palette[2]);
    }
    mirror(4, 6, palette[4]);
    mirror(5, 9, "#d9818f");
    paint(6, 8, "#c96f72");
    for (let x = 4; x <= 8; x += 1) paint(x, 10, hash % 2 ? palette[0] : palette[1]);
    for (let y = 11; y <= 12; y += 1) {
      for (let x = 2; x <= 10; x += 1) paint(x, y, y === 11 ? palette[0] : palette[1]);
    }
  } else {
    mirror(3, 1, palette[3]);
    mirror(4, 2, palette[2]);
    for (let y = 3; y <= 9; y += 1) {
      for (let x = 3; x <= 9; x += 1) paint(x, y, palette[2]);
    }
    mirror(4, 6, palette[4]);
    paint(6, 8, "#d9816b");
    mirror(3, 10, palette[1]);
    for (let x = 4; x <= 8; x += 1) paint(x, 11, palette[0]);
    for (let x = 5; x <= 7; x += 1) paint(x, 12, palette[0]);
  }

  if (hash % 3 === 0) {
    paint(6, 2, palette[0]);
  }
  return { type, step, cells };
}

function withGeneratedAvatar(item = {}) {
  return {
    ...item,
    generatedAvatar: buildAvatarCells(item.gender || "unknown", item.id || item.memberId || item.name || item.avatarText || "")
  };
}

function hasExplicitRoomEntry(entry = {}) {
  return !!(entry.scene || entry.inviteCode || entry.adminMode || (entry.partyId && entry.tableId));
}

function getStoredAdminSession() {
  const session = app.globalData.adminSession || wx.getStorageSync("partyAdminSession") || {};
  return session && typeof session === "object" ? session : {};
}

function wxLoginCode() {
  return new Promise((resolve) => {
    if (!wx.login) {
      resolve("");
      return;
    }
    wx.login({
      success: (res) => resolve(res.code || ""),
      fail: () => resolve("")
    });
  });
}

Page({
  data: {
    loading: true,
    entry: {},
    adminMode: false,
    adminId: "",
    adminKey: "",
    room: null,
    profileReady: false,
    profileForm: {
      avatarUrl: "",
      nickName: "",
      gender: "unknown",
      agreementAccepted: false,
      ageConfirmed: false
    },
    profileEditing: false,
    notifyReady: false,
    notifyEnabled: false,
    notifySaving: false,
    profileSaving: false,
    messageTemplateId: "",
    genderOptions: [
      { key: "female", label: "女" },
      { key: "male", label: "男" },
      { key: "unknown", label: "保密" }
    ],
    reportReasons: ["骚扰辱骂", "色情低俗", "诈骗引流", "广告刷屏", "侵犯隐私", "其他"],
    inputText: "",
    sending: false,
    sharingQrcode: false,
    flashEnabled: false,
    flashSeconds: 5,
    plusPanelOpen: false,
    emojiPanelOpen: false,
    emojiGroups: buildEmojiTabs(0),
    activeEmojiGroupKey: EMOJI_GROUP_DATA[0] && EMOJI_GROUP_DATA[0].key || "",
    emojiPages: getEmojiPager(EMOJI_GROUP_DATA[0] && EMOJI_GROUP_DATA[0].key || "").pages,
    emojiPageIndex: 0,
    emojiTotalCount: getEmojiPager(EMOJI_GROUP_DATA[0] && EMOJI_GROUP_DATA[0].key || "").total,
    recentEmojis: [],
    voiceInputMode: false,
    voiceRecording: false,
    voiceRecordSeconds: 0,
    voiceReview: null,
    chatScrollTarget: "",
    quotedMessage: null,
    canChat: false,
    memberTransitionId: "",
    likedPulseId: "",
    theme: app.getTheme ? app.getTheme() : "dark",
    mediaPreview: {
      visible: false,
      url: "",
      scale: 1,
      x: 0,
      y: 0
    }
  },

  onLoad(options) {
    this.pageUnloaded = false;
    this.likingMessageIds = {};
    this.mediaCacheQueue = [];
    this.mediaCacheKeys = {};
    this.mediaCacheActive = 0;
    const entry = parseEntry(options);
    const adminSession = entry.adminMode ? getStoredAdminSession() : {};
    const adminId = entry.adminId || adminSession.adminId || "";
    const adminKey = entry.adminKey || adminSession.adminKey || "";
    this.setData({
      entry,
      adminMode: !!entry.adminMode,
      adminId,
      adminKey,
      profileReady: !!entry.adminMode
    });
    this.loadRemoteConfig();
    this.loadProfile();
    this.loadRecentEmojis();
    this.ensureOpenid();
    if (!hasExplicitRoomEntry(entry) && app.waitForAdminRedirect) {
      app.waitForAdminRedirect().then((redirected) => {
        if (!redirected && !this.pageUnloaded) {
          this.loadRoom(entry);
        }
      });
    } else {
      this.loadRoom(entry);
    }
    this.initRecorder();
    this.initVoicePlayer();
  },

  onShow() {
    this.setData({ theme: app.getTheme ? app.getTheme() : "dark" });
    this.roomSocketClosedByPage = false;
    // For admin mode, verify the session is still fresh before connecting.
    if (this.data.adminMode) {
      this.verifyAdminSessionBeforeConnect();
    } else {
      this.connectRoomSocket();
    }
    if (wx.hideShareMenu) {
      wx.hideShareMenu();
    }
  },

  verifyAdminSessionBeforeConnect() {
    const stored = getStoredAdminSession();
    const expiresAt = stored.expiresAt || 0;
    const now = Math.floor(Date.now() / 1000);
    if (expiresAt && expiresAt - now < 3600) {
      // Session expiring soon — refresh it proactively.
      this.ensureAdminSessionForRoom(true).finally(() => {
        this.connectRoomSocket();
      });
    } else {
      this.connectRoomSocket();
    }
  },

  toggleTheme() {
    const theme = app.toggleTheme ? app.toggleTheme() : "dark";
    this.lightFeedback();
    this.setData({ theme });
  },

  lightFeedback(type = "light") {
    if (!wx.vibrateShort) {
      return;
    }
    try {
      wx.vibrateShort({ type });
    } catch (error) {
      try {
        wx.vibrateShort();
      } catch (fallbackError) {
        console.warn("轻触反馈不可用", fallbackError);
      }
    }
  },

  setDataIfAlive(data) {
    if (this.pageUnloaded) {
      return false;
    }
    this.setData(data);
    return true;
  },

  showToastIfAlive(options) {
    if (!this.pageUnloaded) {
      wx.showToast(options);
    }
  },

  onHide() {
    this.closeRoomSocket();
  },

  onUnload() {
    this.pageUnloaded = true;
    this.closeRoomSocket();
    this.mediaCacheQueue = [];
    if (this.recordTimer) {
      clearInterval(this.recordTimer);
    }
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
    if (this.memberTransitionTimer) {
      clearTimeout(this.memberTransitionTimer);
      this.memberTransitionTimer = null;
    }
    if (this.likePulseTimer) {
      clearTimeout(this.likePulseTimer);
      this.likePulseTimer = null;
    }
    if (this.previewScaleTimer) {
      clearTimeout(this.previewScaleTimer);
      this.previewScaleTimer = null;
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
      this.setDataIfAlive({
        messageTemplateId: config.messageTemplateId || app.globalData.messageTemplateId || "",
        notifyReady: !!(config.messageTemplateId || app.globalData.messageTemplateId)
      });
    } catch (error) {
      const templateId = app.globalData.messageTemplateId || "";
      this.setDataIfAlive({
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
            this.setDataIfAlive({
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
    this.setDataIfAlive({ loading: true });
    try {
      const room = await api.getRoomByEntry(entry);
      if (this.pageUnloaded) {
        return;
      }
      const mergedRoom = this.mergeLocalRoomMessages(room);
      const preparedRoom = this.decorateRoomAvatars(this.prepareFlashMessages(this.hydrateRoomMessageProfiles(mergedRoom)));
      this.setData({
        room: preparedRoom,
        canChat: this.computeCanChat(mergedRoom, this.data.profileForm),
        loading: false
      });
      this.persistRoomMessages();
      this.cacheVisibleMedia();
      this.startFlashCountdown();
      this.scrollChatToBottom();
      this.connectRoomSocket();
      this.syncRoomMessagesFromServer();
      // Pre-fetch QR code in background so sharing is instant.
      const scene = preparedRoom.scene || (preparedRoom.room && preparedRoom.room.entryCode) || "";
      if (scene) {
        api.downloadRoomQrcode(scene).catch(() => {});
      }
    } catch (error) {
      if (this.pageUnloaded) {
        return;
      }
      if (error && /已结束/.test(error.message || "")) {
        console.warn("房间已结束", error);
        if (await this.redirectAdminFromEndedRoom()) {
          return;
        }
        this.setData({
          room: null,
          canChat: false,
          loading: false
        });
        wx.showToast({
          title: error.message || "该局已结束",
          icon: "none"
        });
        return;
      }
      console.warn("房间接口加载失败，已回退到本地演示数据", error);
      const room = this.decorateRoomAvatars(this.prepareFlashMessages(buildRoom(entry)));
      this.setData({
        room,
        loading: false
      });
      this.startFlashCountdown();
      this.scrollChatToBottom();
      this.showToastIfAlive({
        title: "后端连接失败，已显示演示数据",
        icon: "none"
      });
    }
  },

  async redirectAdminFromEndedRoom() {
    const stored = getStoredAdminSession();
    if (!stored.adminId && !stored.adminKey) {
      return false;
    }
    try {
      const code = await wxLoginCode();
      if (!code || this.pageUnloaded) {
        return false;
      }
      const loginRes = await api.adminLogin(stored.adminId || "", code);
      if (!loginRes || !loginRes.token || !loginRes.admin) {
        return false;
      }
      const adminSession = {
        adminId: loginRes.admin.id,
        adminKey: `token:${loginRes.token}`,
        partyId: loginRes.party && loginRes.party.id || "",
        expiresAt: loginRes.expiresAt || 0
      };
      app.globalData.adminSession = adminSession;
      wx.setStorageSync("partyAdminSession", adminSession);
      wx.reLaunch({ url: "/frontend/pages/admin/index" });
      return true;
    } catch (loginError) {
      console.info("已结束房间未切回管理页，当前微信不是管理员或登录已失效", loginError);
      return false;
    }
  },

  onChooseAvatar(event) {
    const avatarUrl = event.detail && event.detail.avatarUrl;
    if (!avatarUrl) {
      return;
    }
    this.setData({
      "profileForm.avatarUrl": avatarUrl
    });
  },

  onProfileAvatarError() {
    const savedProfile = app.globalData.userProfile || wx.getStorageSync("partyUserProfile") || {};
    this.setData({
      "profileForm.avatarUrl": savedProfile.avatarUrl || ""
    });
    wx.showToast({
      title: "头像临时文件失效，请重新选择",
      icon: "none"
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

  openProfileEditor() {
    if (!this.data.profileReady) {
      return;
    }
    this.lightFeedback();
    const savedProfile = app.globalData.userProfile || wx.getStorageSync("partyUserProfile") || this.data.profileForm;
    this.setData({
      profileEditing: true,
      profileForm: {
        ...this.data.profileForm,
        ...savedProfile,
        agreementAccepted: true,
        ageConfirmed: true
      }
    });
  },

  closeProfileEditor() {
    if (!this.data.profileReady || this.data.profileSaving) {
      return;
    }
    this.lightFeedback();
    const savedProfile = app.globalData.userProfile || wx.getStorageSync("partyUserProfile") || this.data.profileForm;
    this.setData({
      profileEditing: false,
      profileForm: {
        ...this.data.profileForm,
        ...savedProfile,
        agreementAccepted: true,
        ageConfirmed: true
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
    if (!dataset.gender) {
      return;
    }
    if (dataset.gender && dataset.gender !== this.data.profileForm.gender) {
      this.lightFeedback();
    }
    this.setData({
      "profileForm.gender": dataset.gender
    });
  },

  toggleAgreement() {
    const checked = !(this.data.profileForm.agreementAccepted && this.data.profileForm.ageConfirmed);
    this.lightFeedback();
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
    if (this.data.profileSaving) {
      return;
    }
    const { profileForm } = this.data;
    const wasEditing = this.data.profileEditing;
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
      this.setData({ profileSaving: true });
      const openid = await this.ensureOpenid();
      if (this.pageUnloaded) {
        return;
      }
      const profile = await api.updateUserProfile({
        ...profileForm,
        openid: profileForm.openid || openid,
        nickName: profileForm.nickName.trim(),
        gender: profileForm.gender || "unknown",
        agreementAccepted: true,
        ageConfirmed: true
      });
      if (this.pageUnloaded) {
        return;
      }
      const savedProfile = {
        ...profileForm,
        ...profile,
        openid: profile.openid || profileForm.openid || openid,
        remoteSynced: true
      };
      app.saveUserProfile(savedProfile);
      let joinedRoom = null;
      if (this.data.room && savedProfile.id && !wasEditing) {
        joinedRoom = await api.joinParty(this.data.room.partyId, this.data.room.tableId, savedProfile.id);
        if (this.pageUnloaded) {
          return;
        }
      }
      this.setData({
        profileReady: true,
        profileEditing: false,
        profileForm: savedProfile,
        room: joinedRoom || this.data.room,
        canChat: this.computeCanChat(joinedRoom || this.data.room, savedProfile)
      });
      if (wasEditing) {
        this.applyUserProfileUpdate(savedProfile);
        this.showToastIfAlive({ title: "资料已更新", icon: "none" });
      } else {
        this.showToastIfAlive({ title: "已进入主局", icon: "success" });
      }
      this.scrollChatToBottom();
      if (!wasEditing) {
        this.requestMessageSubscription();
      }
    } catch (error) {
      this.showToastIfAlive({
        title: error.message || "进入失败",
        icon: "none"
      });
    } finally {
      this.setDataIfAlive({ profileSaving: false });
    }
  },

  async ensureProfileSynced() {
    const { profileForm, profileReady } = this.data;
    if (!profileReady || !profileForm.nickName || !profileForm.avatarUrl) {
      return profileForm;
    }
    if (profileForm.remoteSynced && !isLocalAvatar(profileForm.avatarUrl)) {
      return profileForm;
    }

    try {
      const openid = await this.ensureOpenid();
      if (this.pageUnloaded) {
        return profileForm;
      }
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
      if (!this.pageUnloaded) {
        this.setData({ profileForm: nextProfile });
        this.updateCanChat();
      }
      return nextProfile;
    } catch (error) {
      console.warn("用户资料同步失败，继续使用本地资料", error);
      return profileForm;
    }
  },

  async ensureMessageSender() {
    if (this.data.adminMode) {
      await this.ensureAdminSessionForRoom();
      const manager = this.data.room && this.data.room.manager || {};
      return {
        id: this.data.adminId || manager.id || "admin_mimei",
        senderType: "admin",
        nickName: manager.name || "管理员",
        avatarUrl: manager.avatar || ""
      };
    }
    const profile = await this.ensureProfileSynced();
    return {
      ...profile,
      senderType: "user"
    };
  },

  async ensureAdminSessionForRoom(forceRefresh = false) {
    if (!this.data.adminMode) {
      return;
    }
    const stored = getStoredAdminSession();
    const storedKey = stored.adminKey || "";
    const storedId = stored.adminId || "";
    if (!forceRefresh && !this.data.adminKey && storedKey) {
      this.setDataIfAlive({
        adminKey: storedKey,
        adminId: this.data.adminId || storedId
      });
      return;
    }
    if (!forceRefresh && this.data.adminKey) {
      return;
    }
    if (forceRefresh) {
      app.globalData.adminSession = null;
      wx.removeStorageSync("partyAdminSession");
      this.setDataIfAlive({ adminKey: "" });
    }
    const code = await wxLoginCode();
    if (!code || this.pageUnloaded) {
      throw new Error("管理员登录刷新失败");
    }
    const loginRes = await api.adminLogin(this.data.adminId || storedId || "", code);
    if (!loginRes || !loginRes.token) {
      throw new Error("管理员登录刷新失败");
    }
    const adminSession = {
      adminId: loginRes.admin && loginRes.admin.id || this.data.adminId || storedId || "",
      adminKey: `token:${loginRes.token}`,
      partyId: loginRes.party && loginRes.party.id || this.data.room && this.data.room.partyId || "",
      expiresAt: loginRes.expiresAt || 0
    };
    app.globalData.adminSession = adminSession;
    wx.setStorageSync("partyAdminSession", adminSession);
    this.setDataIfAlive({
      adminId: adminSession.adminId,
      adminKey: adminSession.adminKey
    });
  },

  isAdminSendAuthError(error) {
    if (!this.data.adminMode) {
      return false;
    }
    const message = error && error.message || "";
    return /管理员|登录|密钥|权限|token|401|无效/.test(message);
  },

  async sendRoomMessageWithRetry(message, profile) {
    try {
      return await api.sendRoomMessage(this.data.room.partyId, this.data.room.tableId, message, {
        senderType: profile.senderType,
        senderId: profile.id,
        adminKey: this.data.adminKey
      });
    } catch (error) {
      if (!this.isAdminSendAuthError(error)) {
        throw error;
      }
      console.warn("管理员消息发送鉴权失败，尝试刷新登录", error);
      await this.ensureAdminSessionForRoom(true);
      const refreshedProfile = await this.ensureMessageSender();
      const retryMessage = {
        ...message,
        senderType: refreshedProfile.senderType,
        senderId: refreshedProfile.id,
        sender: refreshedProfile.nickName || message.sender,
        avatar: refreshedProfile.avatarUrl || message.avatar
      };
      return api.sendRoomMessage(this.data.room.partyId, this.data.room.tableId, retryMessage, {
        senderType: refreshedProfile.senderType,
        senderId: refreshedProfile.id,
        adminKey: this.data.adminKey
      });
    }
  },

  showSendFailed(error, label = "消息") {
    console.warn(`${label}发送失败`, error);
    wx.showToast({ title: "发送失败，请检查网络", icon: "none" });
  },

  initRecorder() {
    if (!wx.getRecorderManager) {
      return;
    }
    this.recorderManager = wx.getRecorderManager();
    this.recorderManager.onStop((res) => this.handleRecordStop(res));
    this.recorderManager.onError((error) => {
      if (this.pageUnloaded) {
        return;
      }
      console.warn("录音失败", error);
      this.stopRecordTimer();
      this.setDataIfAlive({
        voiceRecording: false,
        voiceRecordSeconds: 0
      });
      this.showToastIfAlive({ title: "录音暂不可用", icon: "none" });
    });
  },

  initVoicePlayer() {
    if (!wx.createInnerAudioContext) {
      return;
    }
    this.voicePlayer = wx.createInnerAudioContext();
    this.voicePlayer.onEnded(() => {
      if (!this.pageUnloaded) {
        this.markVoicePlaying("");
      }
    });
    this.voicePlayer.onStop(() => {
      if (!this.pageUnloaded) {
        this.markVoicePlaying("");
      }
    });
    this.voicePlayer.onError((error) => {
      if (this.pageUnloaded) {
        return;
      }
      console.warn("语音播放失败", error);
      this.markVoicePlaying("");
      this.showToastIfAlive({ title: "语音暂不可播放", icon: "none" });
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

  decorateRoomAvatars(room) {
    if (!room) {
      return room;
    }
    const memberById = {};
    const members = (room.members || []).map((member) => {
      const nextMember = withGeneratedAvatar(member);
      if (nextMember.id) {
        memberById[nextMember.id] = nextMember;
      }
      return nextMember;
    });
    const messages = (room.messages || []).map((message) => {
      const member = memberById[message.senderId] || {};
      return withGeneratedAvatar({
        ...message,
        gender: message.gender || member.gender || "unknown"
      });
    });
    return {
      ...room,
      members,
      messages
    };
  },

  getRoomSharePath() {
    const room = this.data.room || {};
    const scene = room.scene || room.room && room.room.entryCode || "";
    if (scene) {
      return `/frontend/pages/room/index?scene=${encodeURIComponent(scene)}`;
    }
    const params = [];
    if (room.partyId) {
      params.push(`partyId=${encodeURIComponent(room.partyId)}`);
    }
    if (room.tableId) {
      params.push(`tableId=${encodeURIComponent(room.tableId)}`);
    }
    return `/frontend/pages/room/index${params.length ? `?${params.join("&")}` : ""}`;
  },

  onCopyRoomShare() {
    const path = this.getRoomSharePath();
    wx.setClipboardData({
      data: path,
      success: () => {
        wx.showToast({
          title: "入局路径已复制",
          icon: "none"
        });
      }
    });
  },

  async onShareRoomQrcode() {
    const room = this.data.room || {};
    const scene = room.scene || room.room && room.room.entryCode || "";
    if (!scene || this.data.sharingQrcode) {
      this.showToastIfAlive({ title: "入局码暂不可用", icon: "none" });
      return;
    }
    this.lightFeedback();
    this.setDataIfAlive({ sharingQrcode: true });
    try {
      const qrcodePath = await api.downloadRoomQrcode(scene);
      if (!qrcodePath) {
        throw new Error("Qrcode path is empty");
      }
      if (wx.showShareImageMenu) {
        wx.showShareImageMenu({ path: qrcodePath });
      } else {
        this.openMediaPreview(qrcodePath);
      }
    } catch (error) {
      console.warn("入局二维码生成失败", error);
      this.showToastIfAlive({ title: "二维码生成失败", icon: "none" });
    } finally {
      this.setDataIfAlive({ sharingQrcode: false });
    }
  },

  onInput(event) {
    const value = event.detail && event.detail.value !== undefined ? event.detail.value : event.detail;
    this.setData({ inputText: value || "" });
  },

  onInputFocus() {
    if (this.data.plusPanelOpen || this.data.emojiPanelOpen || this.data.voiceInputMode) {
      this.setData({
        plusPanelOpen: false,
        emojiPanelOpen: false,
        voiceInputMode: false
      });
    }
  },

  toggleVoiceInputMode() {
    this.lightFeedback();
    this.setData({
      voiceInputMode: !this.data.voiceInputMode,
      plusPanelOpen: false,
      emojiPanelOpen: false
    });
  },

  togglePlusPanel() {
    this.lightFeedback();
    this.setData({
      plusPanelOpen: !this.data.plusPanelOpen,
      emojiPanelOpen: false,
      voiceInputMode: false
    });
  },

  toggleEmojiPanel() {
    this.lightFeedback();
    this.setData({
      emojiPanelOpen: !this.data.emojiPanelOpen,
      plusPanelOpen: false,
      voiceInputMode: false
    });
  },

  onEmojiGroupTap(event) {
    const key = event.currentTarget.dataset.key;
    if (!key || key === this.data.activeEmojiGroupKey) {
      return;
    }
    const pager = getEmojiPager(key, this.data.recentEmojis);
    this.setData({
      activeEmojiGroupKey: key,
      emojiPages: pager.pages,
      emojiPageIndex: 0,
      emojiTotalCount: pager.total
    });
  },

  onEmojiSwiperChange(event) {
    const current = event.detail && typeof event.detail.current === "number" ? event.detail.current : 0;
    if (current !== this.data.emojiPageIndex) {
      this.setData({ emojiPageIndex: current });
    }
  },

  async onSendText() {
    const text = this.data.inputText.trim();
    if (!text || this.data.sending || !this.data.room) {
      return;
    }
    if (!this.canCurrentUserChat()) {
      wx.showToast({ title: "占位后才能发言", icon: "none" });
      return;
    }

    this.setData({ sending: true });
    let message = null;
    try {
      const profile = await this.ensureMessageSender();
      if (this.pageUnloaded) {
        return;
      }
      const createdAt = new Date();
      message = {
        type: "text",
        senderType: profile.senderType,
        senderId: profile.id,
        isMine: true,
        sender: profile.nickName,
        avatar: profile.avatarUrl,
        createdAt: createdAt.toISOString(),
        time: this.formatTime(createdAt),
        text,
        quote: this.data.quotedMessage
      };
      const saved = await this.sendRoomMessageWithRetry(message, profile);
      if (this.pageUnloaded) {
        return;
      }
      this.appendMessage(saved);
      this.setData({ inputText: "", quotedMessage: null });
    } catch (error) {
      if (this.pageUnloaded) {
        return;
      }
      this.showSendFailed(error, "消息");
    } finally {
      this.setDataIfAlive({ sending: false });
    }
  },

  async onSendEmoji(event) {
    const emojiId = event.currentTarget.dataset.id;
    const emojiValue = event.currentTarget.dataset.value;
    const emoji = findEmoji(emojiId, emojiValue);
    if (!emoji || this.data.sending || !this.data.room) {
      return;
    }
    if (!this.canCurrentUserChat()) {
      wx.showToast({ title: "占位后才能发言", icon: "none" });
      return;
    }

    this.setData({ sending: true });
    let message = null;
    try {
      const profile = await this.ensureMessageSender();
      if (this.pageUnloaded) {
        return;
      }
      const createdAt = new Date();
      message = {
        type: "emoji",
        senderType: profile.senderType,
        senderId: profile.id,
        isMine: true,
        sender: profile.nickName || "我",
        avatar: profile.avatarUrl,
        createdAt: createdAt.toISOString(),
        time: this.formatTime(createdAt),
        text: emoji.value,
        emojiId: emoji.id,
        quote: this.data.quotedMessage
      };
      const saved = await this.sendRoomMessageWithRetry(message, profile);
      if (this.pageUnloaded) {
        return;
      }
      this.rememberRecentEmoji(emoji);
      this.appendMessage(saved);
      this.setData({ emojiPanelOpen: true, quotedMessage: null });
    } catch (error) {
      if (this.pageUnloaded) {
        return;
      }
      this.showSendFailed(error, "表情");
    } finally {
      this.setDataIfAlive({ sending: false });
    }
  },

  onVoiceTouchStart() {
    if (!this.data.room || this.data.sending || this.data.voiceRecording) {
      return;
    }
    if (!this.canCurrentUserChat()) {
      wx.showToast({ title: "占位后才能发言", icon: "none" });
      return;
    }
    if (!this.recorderManager) {
      wx.showToast({ title: "当前环境不支持录音", icon: "none" });
      return;
    }
    this.recordStartedAt = Date.now();
    this.lightFeedback("medium");
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
    this.lightFeedback("light");
    this.recorderManager.stop();
  },

  cancelVoiceRecord() {
    if (this.data.voiceRecording && this.recorderManager) {
      this.lightFeedback("light");
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
    if (this.pageUnloaded) {
      return;
    }
    this.setDataIfAlive({
      voiceRecording: false,
      voiceRecordSeconds: 0
    });
    if (wasCanceled) {
      return;
    }
    if (!res.tempFilePath) {
      this.showToastIfAlive({ title: "录音没有生成文件", icon: "none" });
      return;
    }
    if (durationSeconds < 1) {
      this.showToastIfAlive({ title: "录音时间太短", icon: "none" });
      return;
    }
    this.setDataIfAlive({
      voiceReview: {
        tempFilePath: res.tempFilePath,
        durationSeconds,
        duration: `${durationSeconds}''`
      }
    });
  },

  startRecordTimer() {
    this.stopRecordTimer();
    this.lastRecordSecond = -1;
    this.recordTimer = setInterval(() => {
      if (this.pageUnloaded) {
        this.stopRecordTimer();
        return;
      }
      const seconds = Math.max(Math.floor((Date.now() - this.recordStartedAt) / 1000), 0);
      if (seconds !== this.lastRecordSecond) {
        this.lastRecordSecond = seconds;
        this.setDataIfAlive({ voiceRecordSeconds: seconds });
      }
    }, 300);
  },

  stopRecordTimer() {
    if (this.recordTimer) {
      clearInterval(this.recordTimer);
      this.recordTimer = null;
    }
    this.lastRecordSecond = -1;
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
    let message = null;
    try {
      const profile = await this.ensureMessageSender();
      if (this.pageUnloaded) {
        return;
      }
      const createdAt = new Date();
      message = {
        type: "voice",
        senderType: profile.senderType,
        senderId: profile.id,
        isMine: true,
        sender: profile.nickName || "我",
        avatar: profile.avatarUrl,
        createdAt: createdAt.toISOString(),
        time: this.formatTime(createdAt),
        duration: review.duration,
        durationSeconds: review.durationSeconds,
        voicePath: review.tempFilePath,
        text: "语音消息",
        quote: this.data.quotedMessage
      };
      const saved = await this.sendRoomMessageWithRetry(message, profile);
      if (this.pageUnloaded) {
        return;
      }
      this.appendMessage(saved);
      this.setData({ voiceReview: null, quotedMessage: null });
    } catch (error) {
      if (this.pageUnloaded) {
        return;
      }
      this.showSendFailed(error, "语音消息");
    } finally {
      this.setDataIfAlive({ sending: false });
    }
  },

  onChoosePhoto() {
    this.setData({ plusPanelOpen: false });
    if (!this.canCurrentUserChat()) {
      wx.showToast({ title: "占位后才能发言", icon: "none" });
      return;
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ["image", "video"],
      sourceType: ["album", "camera"],
      success: async (res) => {
        const file = res.tempFiles[0];
        const isVideo = file.fileType === "video" || /\.(mp4|mov|m4v)$/i.test(file.tempFilePath || "");
        let message = null;
        try {
          const profile = await this.ensureMessageSender();
          if (this.pageUnloaded) {
            return;
          }
          const createdAt = new Date();
          message = {
            type: isVideo ? "video" : "photo",
            senderType: profile.senderType,
            senderId: profile.id,
            isMine: true,
            sender: profile.nickName || "我",
            avatar: profile.avatarUrl,
            createdAt: createdAt.toISOString(),
            time: this.formatTime(createdAt),
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
          const saved = await this.sendRoomMessageWithRetry(message, profile);
          if (this.pageUnloaded) {
            return;
          }
          this.appendMessage(saved);
          this.setData({ quotedMessage: null });
        } catch (error) {
          if (this.pageUnloaded) {
            return;
          }
          this.showSendFailed(error, "媒体消息");
        }
      }
    });
  },

  onQuoteMessage(event) {
    const message = this.findMessageById(event.currentTarget.dataset.id);
    if (!message) {
      return;
    }
    const itemList = this.data.adminMode ? ["引用", "删除消息"] : ["引用", "举报"];
    wx.showActionSheet({
      itemList,
      success: (res) => {
        if (res.tapIndex === 0) {
          this.setData({ quotedMessage: this.buildQuoteFromMessage(message) });
          wx.showToast({ title: "已引用消息", icon: "none" });
          return;
        }
        if (this.data.adminMode) {
          this.deleteMessageAsAdmin(message);
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

  deleteMessageAsAdmin(message) {
    if (!message || !message.id || message.isDeleted) {
      return;
    }
    wx.showModal({
      title: "删除消息",
      content: "删除后房间内会显示该消息已被管理员删除。",
      confirmText: "删除",
      confirmColor: "#d93025",
      success: async (res) => {
        if (!res.confirm) {
          return;
        }
        try {
          const updated = await api.deleteMessage(message.id, "管理员删除", this.data.adminId || "admin_mimei", this.data.adminKey);
          if (this.pageUnloaded) {
            return;
          }
          this.replaceMessage(updated);
          this.showToastIfAlive({ title: "消息已删除", icon: "success" });
        } catch (error) {
          this.showToastIfAlive({ title: error.message || "删除失败", icon: "none" });
        }
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
      this.showToastIfAlive({ title: "举报已提交", icon: "none" });
    } catch (error) {
      console.warn("举报提交失败", error);
      this.showToastIfAlive({ title: error.message || "举报提交失败", icon: "none" });
    }
  },

  clearQuote() {
    this.setData({ quotedMessage: null });
  },

  loadRecentEmojis() {
    let recent = [];
    try {
      recent = wx.getStorageSync(RECENT_EMOJI_STORAGE_KEY) || [];
    } catch (error) {
      recent = [];
    }
    const normalized = recent
      .map((emoji) => findEmoji(emoji.id, emoji.value))
      .filter(Boolean)
      .slice(0, MAX_RECENT_EMOJIS);
    this.setData({
      recentEmojis: normalized,
      emojiGroups: buildEmojiTabs(normalized.length)
    });
  },

  rememberRecentEmoji(emoji) {
    if (!emoji || !emoji.id) {
      return;
    }
    const nextRecent = [
      emoji,
      ...(this.data.recentEmojis || []).filter((item) => item.id !== emoji.id)
    ].slice(0, MAX_RECENT_EMOJIS);
    const update = {
      recentEmojis: nextRecent,
      emojiGroups: buildEmojiTabs(nextRecent.length)
    };
    if (this.data.activeEmojiGroupKey === RECENT_EMOJI_GROUP_KEY) {
      const pager = getEmojiPager(RECENT_EMOJI_GROUP_KEY, nextRecent);
      update.emojiPages = pager.pages;
      update.emojiTotalCount = pager.total;
      update.emojiPageIndex = Math.min(this.data.emojiPageIndex, pager.pages.length - 1);
    }
    this.setData(update);
    try {
      wx.setStorageSync(RECENT_EMOJI_STORAGE_KEY, nextRecent);
    } catch (error) {
      console.warn("保存最近表情失败", error);
    }
  },

  findMessageById(id) {
    return (this.data.room && this.data.room.messages || []).find((message) => message.id === id);
  },

  findMessageIndexById(id) {
    if (!id || !this.data.room || !this.data.room.messages) {
      return -1;
    }
    return this.data.room.messages.findIndex((message) => message.id === id);
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
    if (message.type === "emoji") {
      return "[表情]";
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
    if ((message.type === "photo" || message.type === "emoji") && message.image) {
      this.openMediaPreview(message.image);
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
    const userId = event.currentTarget.dataset.userId;
    if (userId && userId === (this.data.profileForm && this.data.profileForm.id)) {
      this.openProfileEditor();
      return;
    }
    const url = event.currentTarget.dataset.url;
    if (!url) {
      return;
    }
    this.openMediaPreview(url);
  },

  openMediaPreview(url) {
    if (!url) {
      return;
    }
    this.mediaPreviewScale = 1;
    this.mediaPreviewLastTapAt = 0;
    this.lightFeedback();
    this.setData({
      mediaPreview: {
        visible: true,
        url,
        scale: 1,
        x: 0,
        y: 0
      }
    });
  },

  closeMediaPreview() {
    this.mediaPreviewScale = 1;
    this.mediaPreviewLastTapAt = 0;
    if (this.previewScaleTimer) {
      clearTimeout(this.previewScaleTimer);
      this.previewScaleTimer = null;
    }
    this.lightFeedback();
    this.setData({
      "mediaPreview.visible": false,
      "mediaPreview.url": "",
      "mediaPreview.scale": 1,
      "mediaPreview.x": 0,
      "mediaPreview.y": 0
    });
  },

  onMediaPreviewScale(event) {
    const scale = event.detail && event.detail.scale;
    if (scale) {
      this.mediaPreviewScale = scale;
    }
  },

  onMediaPreviewImageTap(event) {
    const now = event.timeStamp || Date.now();
    const lastTapAt = this.mediaPreviewLastTapAt || 0;
    if (now - lastTapAt > 0 && now - lastTapAt < 280) {
      const currentScale = this.mediaPreviewScale || this.data.mediaPreview.scale || 1;
      const nextScale = currentScale > 1 ? 1 : 2;
      this.mediaPreviewScale = nextScale;
      this.mediaPreviewLastTapAt = 0;
      this.lightFeedback();
      this.setMediaPreviewTargetScale(nextScale);
      return;
    }
    this.mediaPreviewLastTapAt = now;
  },

  setMediaPreviewTargetScale(nextScale) {
    const currentTargetScale = this.data.mediaPreview.scale || 1;
    if (this.previewScaleTimer) {
      clearTimeout(this.previewScaleTimer);
      this.previewScaleTimer = null;
    }
    if (nextScale === 1 && currentTargetScale === 1) {
      this.setData({
        "mediaPreview.scale": 1.01,
        "mediaPreview.x": 0,
        "mediaPreview.y": 0
      });
      this.previewScaleTimer = setTimeout(() => {
        this.previewScaleTimer = null;
        if (this.pageUnloaded || !this.data.mediaPreview.visible) {
          return;
        }
        this.setData({
          "mediaPreview.scale": 1,
          "mediaPreview.x": 0,
          "mediaPreview.y": 0
        });
      }, 16);
      return;
    }
    this.setData({
      "mediaPreview.scale": nextScale,
      "mediaPreview.x": 0,
      "mediaPreview.y": 0
    });
  },

  noop() {
  },

  markVoicePlaying(id) {
    if (this.pageUnloaded) {
      return;
    }
    const messages = this.data.room && this.data.room.messages || [];
    if (!messages.length) {
      this.currentVoicePlayingId = "";
      return;
    }
    const previousId = this.currentVoicePlayingId || "";
    const previousIndex = previousId
      ? this.findMessageIndexById(previousId)
      : messages.findIndex((message) => message.playing);
    const nextIndex = id ? this.findMessageIndexById(id) : -1;
    const patch = {};
    if (previousIndex >= 0 && previousIndex !== nextIndex && messages[previousIndex].playing) {
      patch[`room.messages[${previousIndex}].playing`] = false;
    }
    if (nextIndex >= 0 && !messages[nextIndex].playing) {
      patch[`room.messages[${nextIndex}].playing`] = true;
    }
    this.currentVoicePlayingId = id || "";
    if (Object.keys(patch).length) {
      this.setData(patch);
    }
  },

  updateMessage(id, patch) {
    const index = this.findMessageIndexById(id);
    if (index < 0) {
      return;
    }
    this.setData({
      [`room.messages[${index}]`]: {
        ...this.data.room.messages[index],
        ...patch
      }
    });
    this.persistRoomMessages();
  },

  toggleFlash() {
    this.lightFeedback();
    this.setData({ flashEnabled: !this.data.flashEnabled });
  },

  setFlashSeconds(event) {
    const seconds = Number(event.currentTarget.dataset.seconds);
    if (!seconds) {
      return;
    }
    if (seconds !== this.data.flashSeconds) {
      this.lightFeedback();
    }
    this.setData({ flashSeconds: seconds });
  },

  async onLike(event) {
    const { id } = event.currentTarget.dataset;
    this.likeMessageById(id);
  },

  onMessageTap(event) {
    const id = event.currentTarget.dataset.id;
    const now = event.timeStamp || Date.now();
    if (this.lastMessageTap && this.lastMessageTap.id === id && now - this.lastMessageTap.time < 320) {
      this.lastMessageTap = null;
      this.likeMessageById(id);
      return;
    }
    this.lastMessageTap = { id, time: now };
  },

  async likeMessageById(id) {
    if (!this.data.room || !id) {
      return;
    }
    this.likingMessageIds = this.likingMessageIds || {};
    if (this.likingMessageIds[id]) {
      return;
    }
    this.likingMessageIds[id] = true;
    this.lightFeedback();
    this.setData({ likedPulseId: id });
    if (this.likePulseTimer) {
      clearTimeout(this.likePulseTimer);
    }
    this.likePulseTimer = setTimeout(() => {
      this.setDataIfAlive({ likedPulseId: "" });
      this.likePulseTimer = null;
    }, 520);
    try {
      const message = await api.likeMessage(this.data.room.partyId, id);
      if (this.pageUnloaded) {
        return;
      }
      this.replaceMessage(message);
    } catch (error) {
      if (this.pageUnloaded) {
        return;
      }
      console.warn("点赞同步失败", error);
      const index = this.findMessageIndexById(id);
      if (index >= 0) {
        const message = this.data.room.messages[index];
        this.updateMessage(id, {
          likeCount: Number(message.likeCount || 0) + 1
        });
      }
    } finally {
      delete this.likingMessageIds[id];
    }
  },

  canCurrentUserChat() {
    return this.data.canChat;
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
        try {
          await api.recordManagerWechatAction(room.partyId, room.manager.id || room.manager.name);
        } catch (error) {
          console.warn("管理员微信复制记录失败", error);
        }
        this.showToastIfAlive({
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
    if (this.pageUnloaded) {
      return;
    }
    const profile = app.globalData.userProfile || this.data.profileForm;
    if (!room || !templateId || !openid || !profile || !profile.id || !wx.requestSubscribeMessage) {
      return;
    }
    this.setDataIfAlive({ notifySaving: true });
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
      this.setDataIfAlive({ notifyEnabled: status === "accepted" });
    } catch (error) {
      console.warn("订阅消息授权失败", error);
    } finally {
      this.setDataIfAlive({ notifySaving: false });
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
    const index = this.findMessageIndexById(nextMessage.id);
    if (index >= 0) {
      this.setData({
        [`room.messages[${index}]`]: {
          ...this.data.room.messages[index],
          ...nextMessage
        }
      });
      this.persistRoomMessages();
      return;
    }
    this.setData({
      "room.messages": [...(this.data.room.messages || []), nextMessage]
    });
    this.persistRoomMessages();
  },

  async syncRoomMessagesFromServer() {
    const room = this.data.room;
    if (!room || !room.partyId || !room.tableId) {
      return;
    }
    try {
      const serverMessages = await api.getRoomMessages(room.partyId, room.tableId);
      if (this.pageUnloaded || !this.data.room || this.data.room.partyId !== room.partyId || this.data.room.tableId !== room.tableId) {
        return;
      }
      const mergedRoom = this.mergeLocalRoomMessages({
        ...this.data.room,
        messages: [
          ...(this.data.room.messages || []),
          ...(serverMessages || [])
        ]
      });
      const preparedRoom = this.decorateRoomAvatars(this.prepareFlashMessages(this.hydrateRoomMessageProfiles(mergedRoom)));
      this.setData({
        "room.messages": preparedRoom.messages || []
      });
      this.persistRoomMessages();
      this.cacheVisibleMedia();
      this.startFlashCountdown();
      this.scrollChatToBottom();
    } catch (error) {
      console.warn("同步房间消息失败", error);
    }
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
      return;
    }
    if (payload.type === "user.profile.updated" && payload.user) {
      this.applyUserProfileUpdate(payload.user);
      return;
    }
    if (payload.type === "member.updated" && payload.member) {
      this.applyMemberUpdate(payload.member, payload.table);
      return;
    }
    if (payload.type === "member.presence.updated") {
      this.applyMemberPresenceUpdate(payload.userId, payload.online);
      return;
    }
    if (payload.type === "room.updated" && payload.room) {
      this.applyRoomRealtimeUpdate(payload.room);
      return;
    }
    if (payload.type === "member.removed" && payload.room) {
      this.applyRoomRealtimeUpdate(payload.room);
      return;
    }
    if (payload.type === "party.ended") {
      this.handlePartyEnded();
    }
  },

  handlePartyEnded() {
    this.closeRoomSocket();
    this.setData({
      canChat: false,
      "room.statusText": "已结束",
      "room.room.seatStatusText": "已结束"
    });
    wx.showToast({ title: "该局已结束", icon: "none" });
  },

  applyUserProfileUpdate(user = {}) {
    if (!this.data.room || !user.id) {
      return;
    }
    const name = user.nickName || user.nickname || user.name || "新朋友";
    const avatar = user.avatar || user.avatarUrl || "";
    const gender = user.gender || "unknown";
    const bannedAt = user.bannedAt || user.banned_at || "";
    const banReason = user.banReason || user.ban_reason || "";
    const avatarText = name ? String(name).slice(0, 1).toUpperCase() : "?";
    const currentUserId = this.data.profileForm && this.data.profileForm.id;
    const members = (this.data.room.members || []).map((member) => {
      if (member.id !== user.id) {
        return member;
      }
      return {
        ...member,
        name,
        gender,
        avatar,
        avatarText,
        bannedAt,
        banReason
      };
    });
    const messages = (this.data.room.messages || []).map((message) => {
      if (message.senderId !== user.id) {
        return message;
      }
      return {
        ...message,
        sender: name,
        avatar,
        avatarText
      };
    });
    const dataPatch = {
      "room.members": this.sortMembers(members),
      "room.messages": messages
    };
    if (currentUserId && user.id === currentUserId) {
      const nextProfile = {
        ...this.data.profileForm,
        ...user,
        nickName: name,
        avatarUrl: user.avatarUrl || avatar,
        avatar,
        avatarText,
        gender,
        bannedAt,
        banReason,
        remoteSynced: true,
        agreementAccepted: true,
        ageConfirmed: true
      };
      app.saveUserProfile(nextProfile);
      dataPatch.profileForm = nextProfile;
    }
    dataPatch.canChat = this.computeCanChat({
      ...this.data.room,
      members: dataPatch["room.members"]
    }, dataPatch.profileForm || this.data.profileForm);
    this.setData(dataPatch);
    this.persistRoomMessages();
  },

  applyMemberUpdate(member = {}, table = null) {
    if (!this.data.room || !member.id) {
      return;
    }
    let found = false;
    const members = (this.data.room.members || []).map((item) => {
      if (item.id === member.id || item.memberId === member.memberId) {
        found = true;
        return {
          ...item,
          ...member
        };
      }
      return item;
    });
    if (!found) {
      members.push(member);
    }
    const sortedMembers = this.sortMembers(members);
    const dataPatch = {
      "room.members": sortedMembers,
      memberTransitionId: member.id,
      canChat: this.computeCanChat({
        ...this.data.room,
        members: sortedMembers
      }, this.data.profileForm)
    };
    if (table && table.capacity) {
      const memberCount = table.memberCount || 0;
      dataPatch["room.room.capacity"] = `${memberCount}/${table.capacity} 占位`;
      dataPatch["room.room.openSeats"] = table.openSeats;
      dataPatch["room.room.seatStatusText"] = table.openSeats > 0 ? "人数未满" : "人数已满";
      dataPatch["room.statusText"] = table.statusText || dataPatch["room.room.seatStatusText"];
    }
    this.setData(dataPatch);
    if (this.memberTransitionTimer) {
      clearTimeout(this.memberTransitionTimer);
    }
    this.memberTransitionTimer = setTimeout(() => {
      if (this.data.memberTransitionId === member.id) {
        this.setData({ memberTransitionId: "" });
      }
      this.memberTransitionTimer = null;
    }, 900);
  },

  applyMemberPresenceUpdate(userId, online) {
    if (!this.data.room || !userId) {
      return;
    }
    const members = (this.data.room.members || []).map((member) => (
      member.id === userId ? { ...member, online: !!online } : member
    ));
    const messages = (this.data.room.messages || []).map((message) => {
      if (message.senderId !== userId) {
        return message;
      }
      return {
        ...message,
        online: !!online
      };
    });
    this.setData({
      "room.members": this.sortMembers(members),
      "room.messages": messages
    });
  },

  applyRoomRealtimeUpdate(nextRoom = {}) {
    if (!this.data.room) {
      return;
    }
    const members = this.sortMembers(nextRoom.members || this.data.room.members || []);
    const dataPatch = {
      room: {
        ...this.data.room,
        ...nextRoom,
        messages: this.data.room.messages || [],
        members
      },
      canChat: this.computeCanChat({
        ...this.data.room,
        ...nextRoom,
        members
      }, this.data.profileForm)
    };
    this.setData(dataPatch);
  },

  sortMembers(members = []) {
    return members.slice().sort((left, right) => {
      const leftHead = left.isHead || left.role === "局头" || left.role === "head" ? 0 : 1;
      const rightHead = right.isHead || right.role === "局头" || right.role === "head" ? 0 : 1;
      if (leftHead !== rightHead) {
        return leftHead - rightHead;
      }
      const leftRank = left.seatStatus === "seated" ? 0 : 1;
      const rightRank = right.seatStatus === "seated" ? 0 : 1;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return String(left.memberId || left.id || "").localeCompare(String(right.memberId || right.id || ""));
    });
  },

  updateCanChat() {
    this.setData({
      canChat: this.computeCanChat(this.data.room, this.data.profileForm)
    });
  },

  computeCanChat(room = this.data.room, profile = this.data.profileForm) {
    if (this.data.adminMode) {
      return true;
    }
    if (profile && (profile.bannedAt || profile.banned_at)) {
      return false;
    }
    const members = room && room.members || [];
    const member = members.find((item) => item.id === (profile && profile.id));
    if (member && (member.bannedAt || member.banned_at)) {
      return false;
    }
    return !!(member && member.seatStatus === "seated");
  },

  scrollChatToBottom() {
    this.setData({ chatScrollTarget: "" });
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
    }
    this.scrollTimer = setTimeout(() => {
      if (this.pageUnloaded) {
        return;
      }
      this.setData({ chatScrollTarget: "chat-bottom" });
      this.scrollTimer = null;
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

  hydrateRoomMessageProfiles(room) {
    if (!room || !room.messages || !room.members) {
      return room;
    }
    const memberById = {};
    room.members.forEach((member) => {
      if (member && member.id) {
        memberById[member.id] = member;
      }
    });
    return {
      ...room,
      messages: room.messages.map((message) => {
        const member = memberById[message.senderId];
        if (!member) {
          return message;
        }
        return {
          ...message,
          sender: member.name || message.sender,
          avatar: member.avatar || message.avatar,
          avatarText: member.avatarText || message.avatarText
        };
      })
    };
  },

  prepareDisplayMessage(message) {
    const normalizedMessage = message && message.type === "emoji"
      ? {
        ...message,
        text: message.text || "",
        image: message.image || message.mediaUrl || ""
      }
      : message;
    const nextMessage = this.prepareFlashMessage(normalizedMessage);
    const messageWithMineState = nextMessage
      ? {
        ...nextMessage,
        isMine: this.isMessageFromCurrentSender(nextMessage)
      }
      : nextMessage;
    if (messageWithMineState && messageWithMineState.quote && !messageWithMineState.quote.summary) {
      return {
        ...messageWithMineState,
        quote: {
          ...messageWithMineState.quote,
          summary: this.getQuoteSummary(messageWithMineState.quote)
        }
      };
    }
    return messageWithMineState;
  },

  isMessageFromCurrentSender(message = {}) {
    const senderType = message.senderType || "user";
    const senderId = message.senderId || "";
    if (!senderId) {
      return false;
    }
    if (senderType === "admin") {
      return !!(this.data.adminMode && senderId === (this.data.adminId || "admin_mimei"));
    }
    const currentProfile = this.data.profileForm && this.data.profileForm.id ? this.data.profileForm : (app.globalData.userProfile || {});
    return !!(!this.data.adminMode && currentProfile.id && senderId === currentProfile.id);
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
    let shouldPersist = false;
    const patch = {};
    messages.forEach((message, index) => {
      if (!message.isFlash || message.flashExpired) {
        return;
      }
      const expiresAt = this.getFlashExpiresAt(message);
      const remaining = expiresAt ? Math.max(Math.ceil((expiresAt - Date.now()) / 1000), 0) : 0;
      const expired = remaining <= 0;
      const countdownText = `${remaining} 秒后自动销毁`;
      hasActiveFlash = hasActiveFlash || remaining > 0;
      if (message.flashRemainingSeconds !== remaining) {
        patch[`room.messages[${index}].flashRemainingSeconds`] = remaining;
      }
      if (message.flashCountdownText !== countdownText) {
        patch[`room.messages[${index}].flashCountdownText`] = countdownText;
      }
      if (message.flashExpired !== expired) {
        patch[`room.messages[${index}].flashExpired`] = expired;
        shouldPersist = shouldPersist || expired;
      }
    });

    if (Object.keys(patch).length) {
      this.setData(patch);
    }
    if (shouldPersist) {
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

  getBeijingParts(date) {
    const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    return {
      year: beijing.getUTCFullYear(),
      month: beijing.getUTCMonth() + 1,
      day: beijing.getUTCDate(),
      hour: beijing.getUTCHours(),
      minute: beijing.getUTCMinutes()
    };
  },

  beijingDateTimestamp(year, month, day, hour = 0, minute = 0) {
    return Date.UTC(year, month - 1, day, hour - 8, minute, 0);
  },

  formatTime(date) {
    if (!date || isNaN(date.getTime())) {
      return "";
    }
    const beijing = this.getBeijingParts(date);
    const today = this.getBeijingParts(new Date());
    const messageDay = Date.UTC(beijing.year, beijing.month - 1, beijing.day);
    const todayDay = Date.UTC(today.year, today.month - 1, today.day);
    const dayDiff = Math.round((todayDay - messageDay) / 86400000);
    const hour = `${beijing.hour}`.padStart(2, "0");
    const minute = `${beijing.minute}`.padStart(2, "0");
    const time = `${hour}:${minute}`;
    if (dayDiff === 0) {
      return `今天 ${time}`;
    }
    if (dayDiff === 1) {
      return `昨天 ${time}`;
    }
    if (beijing.year === today.year) {
      return `${beijing.month}月${beijing.day}日 ${time}`;
    }
    return `${beijing.year}-${`${beijing.month}`.padStart(2, "0")}-${`${beijing.day}`.padStart(2, "0")} ${time}`;
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
    const messagesById = {};
    localMessages.forEach((message) => {
      if (!message || !message.id) {
        return;
      }
      messagesById[message.id] = message;
    });
    (room.messages || []).forEach((message) => {
      if (!message || !message.id) {
        return;
      }
      messagesById[message.id] = {
        ...(messagesById[message.id] || {}),
        ...message
      };
    });
    const messages = Object.keys(messagesById)
      .map((id) => messagesById[id])
      .sort((left, right) => {
        const leftTime = this.parseMessageSortTime(left);
        const rightTime = this.parseMessageSortTime(right);
        if (leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        return String(left.id || "").localeCompare(String(right.id || ""));
      });
    return {
      ...room,
      messages: messages.slice(-80)
    };
  },

  parseMessageSortTime(message = {}) {
    const raw = message.createdAt || message.created_at || message.flashStartedAt || "";
    const parsed = raw ? this.parseApiDate(raw).getTime() : NaN;
    if (!isNaN(parsed)) {
      return parsed;
    }
    const text = String(message.time || "");
    const today = this.getBeijingParts(new Date());
    const fullDate = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})$/);
    if (fullDate) {
      return this.beijingDateTimestamp(Number(fullDate[1]), Number(fullDate[2]), Number(fullDate[3]), Number(fullDate[4]), Number(fullDate[5]));
    }
    const monthDate = text.match(/^(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})$/);
    if (monthDate) {
      return this.beijingDateTimestamp(today.year, Number(monthDate[1]), Number(monthDate[2]), Number(monthDate[3]), Number(monthDate[4]));
    }
    const relativeTime = text.match(/^(今天|昨天)\s+(\d{1,2}):(\d{2})$/);
    if (relativeTime) {
      const dayOffset = relativeTime[1] === "昨天" ? -1 : 0;
      const day = new Date(Date.UTC(today.year, today.month - 1, today.day + dayOffset));
      return this.beijingDateTimestamp(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), Number(relativeTime[2]), Number(relativeTime[3]));
    }
    const timeOnly = text.match(/^(\d{1,2}):(\d{2})$/);
    if (timeOnly) {
      return this.beijingDateTimestamp(today.year, today.month, today.day, Number(timeOnly[1]), Number(timeOnly[2]));
    }
    return 0;
  },

  persistRoomMessages() {
    const room = this.data.room;
    const key = this.getLocalMessageKey(room);
    if (!key || !room || !room.messages) {
      return;
    }
    const messages = room.messages
      .filter((message) => message && !message.flashExpired)
      .map((message) => {
        const { playing, ...persistedMessage } = message;
        return persistedMessage;
      })
      .slice(-80);
    wx.setStorageSync(key, messages);
  },

  cacheVisibleMedia() {
    const messages = this.data.room && this.data.room.messages || [];
    messages.slice(-30).forEach((message) => this.cacheMessageMedia(message));
  },

  cacheMessageMedia(message) {
    if (!message || message.localCached || message.isFlash || message.type === "video") {
      return;
    }
    const mediaUrl = message.mediaUrl || message.image || message.video || message.voicePath || "";
    if (!/^https?:\/\//.test(mediaUrl) || !wx.downloadFile || !wx.getFileSystemManager) {
      return;
    }
    this.mediaCacheQueue = this.mediaCacheQueue || [];
    this.mediaCacheKeys = this.mediaCacheKeys || {};
    const cacheKey = `${message.id || ""}:${mediaUrl}`;
    if (this.mediaCacheKeys[cacheKey]) {
      return;
    }
    this.mediaCacheKeys[cacheKey] = true;
    this.mediaCacheQueue.push({ message, mediaUrl });
    this.pumpMediaCacheQueue();
  },

  pumpMediaCacheQueue() {
    this.mediaCacheQueue = this.mediaCacheQueue || [];
    this.mediaCacheActive = this.mediaCacheActive || 0;
    if (this.pageUnloaded || this.mediaCacheActive >= 2 || !this.mediaCacheQueue.length) {
      return;
    }
    const task = this.mediaCacheQueue.shift();
    const { message, mediaUrl } = task;
    this.mediaCacheActive += 1;
    const finish = () => {
      this.mediaCacheActive = Math.max(0, (this.mediaCacheActive || 1) - 1);
      this.pumpMediaCacheQueue();
    };
    wx.downloadFile({
      url: mediaUrl,
      success: (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300 || !res.tempFilePath) {
          finish();
          return;
        }
        wx.getFileSystemManager().saveFile({
          tempFilePath: res.tempFilePath,
          success: (saveRes) => {
            if (this.pageUnloaded) {
              return;
            }
            const savedPath = saveRes.savedFilePath;
            const patch = { localCached: true, mediaUrl: savedPath };
            if (message.type === "photo") {
              patch.image = savedPath;
            } else if (message.type === "emoji") {
              patch.image = savedPath;
            } else if (message.type === "video") {
              patch.video = savedPath;
            } else if (message.type === "voice") {
              patch.voicePath = savedPath;
            }
            this.updateMessage(message.id, patch);
          },
          complete: finish
        });
      },
      fail: finish
    });
  }
});
