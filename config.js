const env = "prod";

const configs = {
  dev: {
    apiBaseUrl: "http://127.0.0.1:7893",
    messageTemplateId: ""
  },
  prod: {
    apiBaseUrl: "https://api.kunsir.ltd",
    messageTemplateId: ""
  }
};

module.exports = configs[env];
