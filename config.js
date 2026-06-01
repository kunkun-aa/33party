const env = "prod";

const configs = {
  dev: {
    apiBaseUrl: "http://127.0.0.1:7893"
  },
  prod: {
    apiBaseUrl: "http://13.212.104.243"
  }
};

module.exports = configs[env];
