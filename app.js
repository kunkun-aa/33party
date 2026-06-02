const config = require("./config");

App({
  globalData: {
    apiBaseUrl: config.apiBaseUrl,
    messageTemplateId: config.messageTemplateId || "",
    userProfile: null,
    theme: "dark"
  },

  onLaunch() {
    const profile = wx.getStorageSync("partyUserProfile");
    if (profile) {
      this.globalData.userProfile = profile;
    }
    const savedTheme = wx.getStorageSync("partyTheme");
    if (savedTheme === "light" || savedTheme === "dark") {
      this.globalData.theme = savedTheme;
    }
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
