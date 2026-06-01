const config = require("./config");

App({
  globalData: {
    apiBaseUrl: config.apiBaseUrl,
    userProfile: null
  },

  onLaunch() {
    const profile = wx.getStorageSync("partyUserProfile");
    if (profile) {
      this.globalData.userProfile = profile;
    }
  },

  saveUserProfile(profile) {
    this.globalData.userProfile = profile;
    wx.setStorageSync("partyUserProfile", profile);
  }
});
