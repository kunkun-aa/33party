const config = require("./config");

function shouldTryAdminRedirect(options = {}) {
  if (!config.autoAdminRedirect || !config.apiBaseUrl || !wx.login || !wx.request || !wx.reLaunch) {
    return false;
  }
  const path = options.path || "";
  const query = options.query || {};
  if (path === "frontend/pages/admin/index" || path === "frontend/pages/legal/index") {
    return false;
  }
  if (query.scene || query.inviteCode || query.partyId || query.tableId || query.admin || query.adminMode) {
    return false;
  }
  return true;
}

function requestAdminLogin(code) {
  return new Promise((resolve, reject) => {
    const data = { code };
    wx.request({
      url: `${config.apiBaseUrl}/api/admin/login`,
      method: "POST",
      data,
      header: {
        "content-type": "application/json"
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data || {});
          return;
        }
        reject(new Error((res.data && res.data.error) || `Request failed: ${res.statusCode}`));
      },
      fail: reject
    });
  });
}

App({
  globalData: {
    apiBaseUrl: config.apiBaseUrl,
    messageTemplateId: config.messageTemplateId || "",
    adminSession: null,
    adminRedirectPromise: null,
    adminRedirectChecking: false,
    userProfile: null,
    theme: "dark"
  },

  onLaunch(options = {}) {
    const profile = wx.getStorageSync("partyUserProfile");
    if (profile) {
      this.globalData.userProfile = profile;
    }
    const adminSession = wx.getStorageSync("partyAdminSession");
    if (adminSession) {
      this.globalData.adminSession = adminSession;
    }
    const savedTheme = wx.getStorageSync("partyTheme");
    if (savedTheme === "light" || savedTheme === "dark") {
      this.globalData.theme = savedTheme;
    }
    this.watchForAppUpdate();
    this.tryAutoAdminRedirect(options);
  },

  watchForAppUpdate() {
    if (!wx.getUpdateManager) {
      return;
    }
    const updateManager = wx.getUpdateManager();
    updateManager.onUpdateReady(() => {
      wx.showModal({
        title: "新版本可用",
        content: "重启后使用最新版本。",
        confirmText: "重启",
        showCancel: false,
        success: () => {
          updateManager.applyUpdate();
        }
      });
    });
  },

  tryAutoAdminRedirect(options = {}) {
    if (!shouldTryAdminRedirect(options)) {
      this.globalData.adminRedirectPromise = Promise.resolve(false);
      return this.globalData.adminRedirectPromise;
    }
    this.globalData.adminRedirectChecking = true;
    const redirectPromise = new Promise((resolve) => {
      wx.login({
        success: async (res) => {
          if (!res.code) {
            resolve(false);
            return;
          }
          try {
            const loginRes = await requestAdminLogin(res.code);
            if (!loginRes || !loginRes.token || !loginRes.admin) {
              resolve(false);
              return;
            }
            const adminSession = {
              adminId: loginRes.admin.id,
              adminKey: `token:${loginRes.token}`,
              partyId: loginRes.party && loginRes.party.id || "",
              expiresAt: loginRes.expiresAt || 0
            };
            this.globalData.adminSession = adminSession;
            wx.setStorageSync("partyAdminSession", adminSession);
            wx.reLaunch({
              url: "/frontend/pages/admin/index"
            });
            resolve(true);
          } catch (error) {
            console.info("当前微信不是管理员或管理员未绑定", error);
            resolve(false);
          }
        },
        fail: () => resolve(false)
      });
    }).finally(() => {
      this.globalData.adminRedirectChecking = false;
    });
    this.globalData.adminRedirectPromise = redirectPromise;
    return redirectPromise;
  },

  waitForAdminRedirect() {
    return this.globalData.adminRedirectPromise || Promise.resolve(false);
  },

  saveUserProfile(profile) {
    this.globalData.userProfile = profile;
    wx.setStorageSync("partyUserProfile", profile);
  },

  getTheme() {
    return this.globalData.theme || "dark";
  },

  setTheme(theme) {
    const nextTheme = theme === "light" ? "light" : "dark";
    this.globalData.theme = nextTheme;
    wx.setStorageSync("partyTheme", nextTheme);
    return nextTheme;
  },

  toggleTheme() {
    return this.setTheme(this.getTheme() === "dark" ? "light" : "dark");
  }
});
