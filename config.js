const env = "prod";

const configs = {
  dev: {
    apiBaseUrl: "http://127.0.0.1:7893"
  },
  prod: {
    apiBaseUrl: "https://api.kunsir.ltd"
  }
};

module.exports = configs[env];
