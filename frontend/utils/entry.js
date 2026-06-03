function parseScene(scene = "") {
  const decoded = decodeURIComponent(scene || "");
  return decoded.split("&").reduce((memo, item) => {
    const [key, value] = item.split("=");
    if (key && value) {
      memo[key] = value;
    }
    return memo;
  }, {});
}

function parseEntry(options = {}) {
  const sceneParams = parseScene(options.scene);
  return {
    scene: options.scene || "",
    partyId: options.partyId || sceneParams.partyId || sceneParams.p || "",
    tableId: options.tableId || sceneParams.tableId || sceneParams.t || "",
    inviteCode: options.inviteCode || sceneParams.inviteCode || sceneParams.i || "",
    adminMode: options.admin === "1" || options.adminMode === "1" || sceneParams.admin === "1",
    adminId: options.adminId || sceneParams.adminId || "",
    adminKey: options.adminKey || sceneParams.adminKey || ""
  };
}

module.exports = {
  parseEntry,
  parseScene
};
