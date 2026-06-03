const env = "prod";

const configs = {
  dev: {
    apiBaseUrl: "http://127.0.0.1:7893",
    messageTemplateId: "",
    defaultAdminId: "admin_mimei",
    defaultAdminPartyId: "party_demo",
    autoAdminRedirect: true
  },
  prod: {
    apiBaseUrl: "https://api.kunsir.ltd",
    messageTemplateId: "",
    defaultAdminId: "admin_mimei",
    defaultAdminPartyId: "party_demo",
    autoAdminRedirect: true
  }
};

module.exports = configs[env];
