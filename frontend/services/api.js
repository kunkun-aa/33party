const { buildRoom } = require("./mock");

const app = getApp();

function toQuery(data = {}) {
  const pairs = Object.keys(data)
    .filter((key) => data[key] !== undefined && data[key] !== null && data[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`);
  return pairs.length ? `?${pairs.join("&")}` : "";
}

function request(path, options = {}) {
  const baseUrl = app.globalData.apiBaseUrl;
  if (!baseUrl) {
    return Promise.reject(new Error("API base url is not configured"));
  }

  const method = options.method || "GET";
  const url = method === "GET" ? `${baseUrl}${path}${toQuery(options.data)}` : `${baseUrl}${path}`;

  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data: method === "GET" ? {} : options.data || {},
      header: {
        "content-type": "application/json",
        ...(options.header || {})
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        reject(new Error((res.data && res.data.error) || `Request failed: ${res.statusCode}`));
      },
      fail: reject
    });
  });
}

function buildUrl(path, params = {}) {
  const baseUrl = app.globalData.apiBaseUrl;
  if (!baseUrl) {
    return "";
  }
  return `${baseUrl}${path}${toQuery(params)}`;
}

function toWebSocketUrl(url = "") {
  if (url.indexOf("https://") === 0) {
    return `wss://${url.slice("https://".length)}`;
  }
  if (url.indexOf("http://") === 0) {
    return `ws://${url.slice("http://".length)}`;
  }
  return url;
}

function isLocalFilePath(path = "") {
  return /^(wxfile|http:\/\/tmp|file):\/\//.test(path) || /^\/(tmp|var|private|storage)\//.test(path);
}

function isRemoteFilePath(path = "") {
  return /^https?:\/\//.test(path) && !/^http:\/\/tmp/.test(path);
}

function normalizeAvatarUrl(path = "") {
  return isRemoteFilePath(path) ? path : "";
}

function avatarInitial(name = "") {
  const text = String(name || "?").trim();
  return text ? text.slice(0, 1).toUpperCase() : "?";
}

function uploadMedia(filePath, mediaType = "file") {
  const baseUrl = app.globalData.apiBaseUrl;
  if (!baseUrl || !filePath || !isLocalFilePath(filePath)) {
    return Promise.resolve({ mediaUrl: filePath });
  }

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${baseUrl}/api/uploads`,
      filePath,
      name: "file",
      formData: { mediaType },
      success(res) {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Upload failed: ${res.statusCode}`));
          return;
        }
        try {
          const data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
          resolve(data);
        } catch (error) {
          reject(error);
        }
      },
      fail: reject
    });
  });
}

function adminHeader(adminKey = "") {
  if (!adminKey) {
    return {};
  }
  if (adminKey.indexOf("token:") === 0) {
    return { "X-Admin-Token": adminKey.slice(6) };
  }
  return { "X-Admin-Key": adminKey };
}

function getStoredAdminSession() {
  const session = app.globalData.adminSession || wx.getStorageSync("partyAdminSession") || {};
  return session && typeof session === "object" ? session : {};
}

function adminLogin(adminId, code) {
  const data = { code };
  if (adminId) {
    data.adminId = adminId;
  }
  return request("/api/admin/login", {
    method: "POST",
    data
  });
}

function bindAdminOpenid(adminId, code, adminKey) {
  return request("/api/admin/bind-openid", {
    method: "POST",
    header: adminHeader(adminKey),
    data: {
      adminId,
      code
    }
  });
}

function getConfig() {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve({
      messageTemplateId: app.globalData.messageTemplateId || "",
      subscribeMessageEnabled: !!app.globalData.messageTemplateId
    });
  }
  return request("/api/config").then((res) => {
    app.globalData.messageTemplateId = res.messageTemplateId || app.globalData.messageTemplateId || "";
    return res;
  });
}

function userLogin(code) {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve({
      openid: `local_openid_${Date.now()}`,
      user: null
    });
  }
  return request("/api/users/login", {
    method: "POST",
    data: { code }
  });
}

function normalizeProfile(profile = {}) {
  const name = profile.nickName || profile.nickname || "新朋友";
  return {
    ...profile,
    id: profile.id,
    nickName: name,
    avatarUrl: profile.avatarUrl || profile.avatar_url || "",
    avatar: normalizeAvatarUrl(profile.avatarUrl || profile.avatar_url || ""),
    avatarText: avatarInitial(name),
    gender: profile.gender || "unknown",
    agreementAcceptedAt: profile.agreementAcceptedAt || profile.agreement_accepted_at || "",
    ageConfirmedAt: profile.ageConfirmedAt || profile.age_confirmed_at || "",
    agreementAccepted: !!(profile.agreementAccepted || profile.agreementAcceptedAt || profile.agreement_accepted_at),
    ageConfirmed: !!(profile.ageConfirmed || profile.ageConfirmedAt || profile.age_confirmed_at),
    bannedAt: profile.bannedAt || profile.banned_at || "",
    banReason: profile.banReason || profile.ban_reason || ""
  };
}

function normalizeMember(member = {}) {
  const name = member.nickname || member.nickName || member.name || "新朋友";
  const avatarUrl = normalizeAvatarUrl(member.avatarUrl || member.avatar_url || member.avatar || "");
  const rawRole = member.role || "成员";
  const isHead = !!member.isHead || rawRole === "head" || rawRole === "局头";
  return {
    id: member.id,
    memberId: member.memberId,
    name,
    role: isHead ? "局头" : rawRole === "guest" ? "成员" : rawRole,
    isHead,
    gender: member.gender || "unknown",
    seatStatus: member.seatStatus || "ghost",
    seatStatusText: member.seatStatus === "seated" ? "已占位" : "未占位",
    online: member.online !== false,
    avatar: avatarUrl,
    avatarUrl,
    avatarText: avatarInitial(name),
    bannedAt: member.bannedAt || "",
    banReason: member.banReason || ""
  };
}

function sortMembers(members = []) {
  return members.slice().sort((left, right) => {
    const leftHead = left.isHead || left.role === "局头" ? 0 : 1;
    const rightHead = right.isHead || right.role === "局头" ? 0 : 1;
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
}

function parseApiDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
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
}

function getBeijingParts(date) {
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return {
    year: beijing.getUTCFullYear(),
    month: beijing.getUTCMonth() + 1,
    day: beijing.getUTCDate(),
    hour: beijing.getUTCHours(),
    minute: beijing.getUTCMinutes()
  };
}

function formatBeijingTime(date) {
  if (!date || isNaN(date.getTime())) {
    return "";
  }
  const beijing = getBeijingParts(date);
  const hour = `${beijing.hour}`.padStart(2, "0");
  const minute = `${beijing.minute}`.padStart(2, "0");
  return `${hour}:${minute}`;
}

function formatBeijingChatTime(date, now = new Date()) {
  if (!date || isNaN(date.getTime())) {
    return "";
  }
  const beijing = getBeijingParts(date);
  const today = getBeijingParts(now);
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
}

function formatBeijingDateTime(value) {
  const date = parseApiDate(value);
  if (!date || isNaN(date.getTime())) {
    return value ? String(value).replace(/(:\d{2})(?:\.\d+)?$/, "") : "";
  }
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = beijing.getUTCFullYear();
  const month = `${beijing.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${beijing.getUTCDate()}`.padStart(2, "0");
  const hour = `${beijing.getUTCHours()}`.padStart(2, "0");
  const minute = `${beijing.getUTCMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function normalizeMessage(message = {}) {
  const sender = message.sender || {};
  const quote = message.quote || message.quotedMessage || null;
  const isDeleted = !!(message.isDeleted || message.deleted_at);
  const senderId = sender.id || message.senderId || message.sender_id || "";
  const senderName = sender.displayName || sender.nickname || message.sender || "系统";
  const currentUserId = app.globalData.userProfile && app.globalData.userProfile.id;
  const senderType = message.senderType || message.sender_type || "user";
  const rawCreatedAt = message.createdAt || message.created_at || "";
  const parsedCreatedAt = parseApiDate(rawCreatedAt);
  const createdAt = parsedCreatedAt && !isNaN(parsedCreatedAt.getTime()) ? parsedCreatedAt : new Date();
  const type = isDeleted ? "text" : (message.kind || message.type || "text");
  const mediaUrl = message.mediaUrl || message.media_url || "";
  const flashExpiresAt = message.flashExpiresAt || message.flash_expires_at || "";
  const flashExpiresDate = parseApiDate(flashExpiresAt);
  const computedFlashSeconds = flashExpiresDate && createdAt
    ? Math.max(Math.round((flashExpiresDate.getTime() - createdAt.getTime()) / 1000), 1)
    : 0;
  const flashRemainingSeconds = flashExpiresDate
    ? Math.max(Math.ceil((flashExpiresDate.getTime() - Date.now()) / 1000), 0)
    : Number(message.flashRemainingSeconds || message.flashSeconds || computedFlashSeconds || 0);

  return {
    id: message.id,
    type,
    senderId,
    senderType,
    sender: senderName,
    avatar: normalizeAvatarUrl(sender.avatarUrl || message.avatar || ""),
    avatarText: avatarInitial(senderName),
    createdAt: rawCreatedAt,
    time: rawCreatedAt ? formatBeijingChatTime(createdAt) : (message.time || formatBeijingChatTime(createdAt) || formatBeijingTime(createdAt)),
    text: isDeleted ? "该消息已被管理员删除" : (message.text || ""),
    image: isDeleted ? "" : (type === "emoji" ? (mediaUrl || message.image || "") : (mediaUrl || message.image || "")),
    video: isDeleted ? "" : (mediaUrl || message.video || ""),
    duration: message.duration || (message.durationSeconds ? `${message.durationSeconds}''` : "06''"),
    durationSeconds: message.durationSeconds || message.duration_seconds || 6,
    voicePath: message.voicePath || message.mediaUrl || "",
    playing: false,
    quote: !isDeleted && quote && quote.id ? {
      id: quote.id,
      sender: quote.sender || "对方",
      type: quote.type || quote.kind || "text",
      text: quote.text || "",
      mediaUrl: quote.mediaUrl || quote.image || "",
      durationSeconds: quote.durationSeconds || quote.duration_seconds || 0,
      summary: quote.summary || buildQuoteSummary(quote)
    } : null,
    likeCount: message.likeCount || message.likeCount === 0 ? message.likeCount : (message.likes || 0),
    isFlash: !!(message.isFlash || message.is_flash),
    flashSeconds: message.flashSeconds || computedFlashSeconds || 10,
    flashRemainingSeconds,
    flashExpiresAt,
    flashExpired: !!((message.isFlash || message.is_flash) && flashExpiresDate && flashExpiresDate.getTime() <= Date.now()),
    isDeleted,
    deletedAt: message.deletedAt || message.deleted_at || "",
    deleteReason: message.deleteReason || message.delete_reason || "",
    isMine: !!(senderType === "user" && (message.isMine || (currentUserId && senderId && currentUserId === senderId)))
  };
}

function normalizeReport(report = {}) {
  const targetMessage = report.targetMessage ? normalizeMessage(report.targetMessage) : null;
  const targetUser = report.targetUser || {};
  const reporter = report.reporter || {};
  return {
    id: report.id,
    partyId: report.partyId || report.party_id,
    tableId: report.tableId || report.table_id,
    tableNo: report.tableNo || report.table_no || "",
    reporterType: report.reporterType || report.reporter_type,
    reporterId: report.reporterId || report.reporter_id,
    reporterName: reporter.nickname || reporter.displayName || report.reporterId || report.reporter_id || "",
    targetType: report.targetType || report.target_type,
    targetId: report.targetId || report.target_id,
    targetUserId: report.targetUserId || report.target_user_id || (targetUser && targetUser.id) || "",
    targetMemberId: report.targetMemberId || report.target_member_id || "",
    targetUserName: targetUser.nickname || targetUser.name || "",
    targetUserBannedAt: targetUser.bannedAt || targetUser.banned_at || "",
    targetMessage,
    reason: report.reason || "",
    detail: report.detail || "",
    status: report.status || "pending",
    createdAt: report.createdAt || report.created_at || "",
    createdText: formatBeijingDateTime(report.createdAt || report.created_at),
    handledAt: report.handledAt || report.handled_at || "",
    handledBy: report.handledBy || report.handled_by || ""
  };
}

function buildQuoteSummary(quote = {}) {
  const type = quote.type || quote.kind;
  if (type === "emoji") {
    return "[表情]";
  }
  if (type === "photo") {
    return "[图片]";
  }
  if (type === "video") {
    return "[视频]";
  }
  if (type === "voice") {
    const duration = quote.duration || (quote.durationSeconds ? `${quote.durationSeconds}''` : "");
    return duration ? `[语音 ${duration}]` : "[语音]";
  }
  return quote.text || "消息";
}

function normalizeRoom(payload = {}) {
  const room = payload.room || payload;
  const party = room.party || {};
  const table = room.table || {};
  const admin = party.admin || {};
  const bar = party.bar || {};
  const memberCount = table.memberCount || 0;
  const capacity = table.capacity || 0;
  const openSeats = table.openSeats || Math.max(capacity - memberCount, 0);

  return {
    partyId: party.id || room.partyId,
    tableId: table.id || room.tableId,
    scene: table.shareScene || party.sceneCode || room.scene,
    title: party.title || room.title || "33 Party 主局",
    statusText: table.statusText || room.statusText || (openSeats > 0 ? "人数未满" : "人数已满"),
    liveTag: party.startsAt ? `开局时间 ${formatBeijingDateTime(party.startsAt)}` : room.liveTag || "今晚主局",
    manager: {
      id: admin.id,
      name: admin.displayName || room.manager?.name || "局头",
      role: "局头 / 管理员",
      avatar: admin.avatarUrl || room.manager?.avatar || "",
      wechatId: admin.wechatId || room.manager?.wechatId || "",
      contactHint: "到店、拼桌、改人数请先加管理员"
    },
    venue: {
      name: bar.name || room.venue?.name || "33 Party Lounge",
      address: bar.address || room.venue?.address || "",
      latitude: bar.latitude || room.venue?.latitude || 0,
      longitude: bar.longitude || room.venue?.longitude || 0,
      distance: room.venue?.distance || "现场确认"
    },
    room: {
      tableName: table.tableNo ? `${table.tableNo} 主桌` : room.room?.tableName || "主桌",
      roomName: table.statusText || room.room?.roomName || "拼台房间",
      minSpend: room.room?.minSpend || "到店确认",
      capacity: table.capacity ? `${memberCount}/${table.capacity} 占位` : room.room?.capacity || "",
      seatStatusText: openSeats > 0 ? "人数未满" : "人数已满",
      openSeats,
      entryCode: table.shareScene || room.room?.entryCode || ""
    },
    members: sortMembers((room.members || []).map((member) => {
      const normalized = normalizeMember(member);
      const isHead = normalized.isHead || (
        normalized.memberId && table.headMemberId && normalized.memberId === table.headMemberId
      );
      return {
        ...normalized,
        role: isHead ? "局头" : normalized.role,
        isHead
      };
    })),
    messages: (room.messages || []).map(normalizeMessage).filter((message) => !message.flashExpired)
  };
}

function normalizeAdminTable(table = {}, party = {}) {
  const recentMessage = table.recentMessage || {};
  const members = table.members || [];
  const status = table.status || "available";
  const headMember = table.head || members.find((member) => member.memberId === table.headMemberId) || null;
  const isEnded = status === "ended";

  return {
    id: table.id,
    partyId: table.partyId || table.party_id || party.id || "",
    tableNo: table.tableNo,
    title: table.title || party.title || "",
    startsAt: table.startsAt || party.startsAt || "",
    startsAtText: formatBeijingDateTime(table.startsAt || party.startsAt || ""),
    barName: table.barName || party.barName || party.bar?.name || "",
    barAddress: table.barAddress || party.barAddress || party.bar?.address || "",
    latitude: table.latitude || party.latitude || party.bar?.latitude || "",
    longitude: table.longitude || party.longitude || party.bar?.longitude || "",
    endedAt: table.endedAt || table.ended_at || "",
    status,
    statusText: table.statusText || (isEnded ? "已结束" : status === "full" ? "人数已满" : "人数未满"),
    headMemberId: table.headMemberId || (headMember && headMember.memberId) || "",
    head: headMember ? (headMember.nickname || headMember.name) : "未指定",
    memberCount: table.memberCount || members.length || 0,
    totalMemberCount: table.totalMemberCount || members.length || 0,
    ghostCount: table.ghostCount || 0,
    openSeats: table.openSeats || 0,
    capacity: table.capacity || 0,
    messageCount: table.messageCount || 0,
    photoCount: table.photoBurstCount || table.photoCount || 0,
    lastMessage: recentMessage.text || "暂无新消息",
    updatedAt: recentMessage.createdAt ? formatBeijingDateTime(recentMessage.createdAt) : "刚刚",
    joinCode: table.shareScene,
    joinLink: `33party://join?scene=${table.shareScene}`,
    note: isEnded ? "已结束，可删除归档" : table.openSeats > 0 ? `还有 ${table.openSeats} 个空位` : "已满员，留意现场秩序",
    members: members.map((member) => {
      const name = member.nickname || member.nickName || member.name || "新朋友";
      const avatarUrl = normalizeAvatarUrl(member.avatarUrl || member.avatar_url || "");
      return {
        id: member.id,
        memberId: member.memberId,
        name,
        role: member.memberId && (member.memberId === table.headMemberId || (headMember && member.memberId === headMember.memberId)) ? "局头" : "成员",
        gender: member.gender || "unknown",
        seatStatus: member.seatStatus || "ghost",
        seatStatusText: member.seatStatus === "seated" ? "已占位" : "未占位",
        avatar: avatarUrl,
        avatarUrl,
        avatarText: avatarInitial(name),
        online: member.online !== false,
        wechatId: member.wechatId || "",
        bannedAt: member.bannedAt || "",
        banReason: member.banReason || "",
        banned: !!member.bannedAt
      };
    })
  };
}

async function getRoomByEntry(entry) {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve(buildRoom(entry));
  }

  const viewer = entry.adminMode
    ? { adminId: entry.adminId || getStoredAdminSession().adminId || "" }
    : { userId: app.globalData.userProfile && app.globalData.userProfile.id };

  if (entry.partyId && entry.tableId) {
    const roomRes = await request("/api/room", {
      data: {
        partyId: entry.partyId,
        tableId: entry.tableId,
        ...viewer
      }
    });
    return normalizeRoom(roomRes);
  }

  const scene = entry.scene || entry.inviteCode || "";
  const sceneRes = scene
    ? await request("/api/party/by-scene", { data: { scene } })
    : await request("/api/party/current");
  const partyId = sceneRes.party.id;
  const tableId = entry.tableId || sceneRes.defaultTableId;
  const roomRes = await request("/api/room", {
    data: {
      partyId,
      tableId,
      ...viewer
    }
  });
  return normalizeRoom(roomRes);
}

function getAdminDashboard(partyId = "", adminId = "admin_mimei", adminKey = "") {
  if (!app.globalData.apiBaseUrl) {
    return Promise.reject(new Error("API base url is not configured"));
  }

  return request("/api/admin/tables", {
    data: {
      partyId,
      adminId
    },
    header: adminHeader(adminKey)
  }).then((res) => {
    const tables = (res.tables || []).map((table) => normalizeAdminTable(table, res.party));
    const admin = (res.party && res.party.admin) || res.admin || {};
    return {
      adminProfile: {
        id: admin.id || adminId,
        name: admin.displayName || "管理员",
        wechatId: admin.wechatId || "",
        visibleToUsers: true
      },
      party: res.party || null,
      tables
    };
  });
}

function getTableInvite(tableId, adminId = "admin_mimei", adminKey = "") {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve({
      scene: tableId,
      path: "frontend/pages/room/index",
      query: `scene=${tableId}`,
      urlLink: "",
      qrcodeUrl: ""
    });
  }
  return request("/api/admin/tables/invite", {
    data: {
      tableId,
      adminId
    },
    header: adminHeader(adminKey)
  });
}

function downloadTableQrcode(tableId, adminId = "admin_mimei", adminKey = "") {
  if (!app.globalData.apiBaseUrl || !wx.downloadFile) {
    return Promise.resolve("");
  }
  // Check local cache first — QR codes don't change for the same table.
  const cacheKey = `partyQrcode:table:${tableId}`;
  const cached = _getCachedQrcode(cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }
  if (_QRCODE_PENDING[cacheKey]) {
    return _QRCODE_PENDING[cacheKey];
  }
  const url = buildUrl("/api/admin/tables/qrcode", {
    tableId,
    adminId
  });
  _QRCODE_PENDING[cacheKey] = new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      header: adminHeader(adminKey),
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve(_saveQrcodeToCache(cacheKey, res.tempFilePath) || res.tempFilePath);
          return;
        }
        reject(new Error(`Qrcode download failed: ${res.statusCode}`));
      },
      fail: reject
    });
  }).finally(() => {
    delete _QRCODE_PENDING[cacheKey];
  });
  return _QRCODE_PENDING[cacheKey];
}

function downloadRoomQrcode(scene) {
  if (!app.globalData.apiBaseUrl || !wx.downloadFile || !scene) {
    return Promise.resolve("");
  }
  // Check local cache first — QR codes don't change for the same scene.
  const cacheKey = `partyQrcode:room:${scene}`;
  const cached = _getCachedQrcode(cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }
  if (_QRCODE_PENDING[cacheKey]) {
    return _QRCODE_PENDING[cacheKey];
  }
  const url = buildUrl("/api/party/qrcode", { scene });
  _QRCODE_PENDING[cacheKey] = new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve(_saveQrcodeToCache(cacheKey, res.tempFilePath) || res.tempFilePath);
          return;
        }
        reject(new Error(`Qrcode download failed: ${res.statusCode}`));
      },
      fail: reject
    });
  }).finally(() => {
    delete _QRCODE_PENDING[cacheKey];
  });
  return _QRCODE_PENDING[cacheKey];
}

// Local file-system cache for QR code images.
// WeChat mini-program QR codes don't change for the same scene,
// so persisting them avoids repeated downloads from the backend.
const _QRCODE_CACHE_PREFIX = "partyQrcodeCache_";
const _QRCODE_CACHE_MAX_AGE_MS = 86400_000; // 24 hours
const _QRCODE_PENDING = {};

function _getCachedQrcode(key) {
  try {
    const record = wx.getStorageSync(_QRCODE_CACHE_PREFIX + key);
    if (!record || !record.path || !record.savedAt) {
      return null;
    }
    if (Date.now() - record.savedAt > _QRCODE_CACHE_MAX_AGE_MS) {
      // Expired — clean up
      wx.removeStorageSync(_QRCODE_CACHE_PREFIX + key);
      return null;
    }
    // Verify the cached file still exists on disk
    try {
      wx.getFileSystemManager().accessSync(record.path);
    } catch (_e) {
      wx.removeStorageSync(_QRCODE_CACHE_PREFIX + key);
      return null;
    }
    return record.path;
  } catch (_e) {
    return null;
  }
}

function _saveQrcodeToCache(key, tempPath) {
  if (!tempPath || !wx.getFileSystemManager) {
    return "";
  }
  try {
    const fs = wx.getFileSystemManager();
    const saved = fs.saveFileSync(tempPath);
    wx.setStorageSync(_QRCODE_CACHE_PREFIX + key, {
      path: saved,
      savedAt: Date.now()
    });
    return saved;
  } catch (_e) {
    // If we can't persist, the download still succeeded — just won't be cached.
    return "";
  }
}

function updateAdminProfile(profile) {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve({
      adminProfile: {
        id: profile.adminId || "admin_mimei",
        name: profile.displayName || "33Party 客服",
        wechatId: profile.wechatId,
        visibleToUsers: true
      }
    });
  }
  return request("/api/admin/profile", {
    method: "POST",
    header: adminHeader(profile.adminKey),
    data: {
      adminId: profile.adminId || "admin_mimei",
      displayName: profile.displayName,
      wechatId: profile.wechatId
    }
  }).then((res) => ({
    adminProfile: {
      id: res.admin.id,
      name: res.admin.displayName,
      wechatId: res.admin.wechatId,
      visibleToUsers: true
    }
  }));
}

function createAdminParty(form) {
  if (!app.globalData.apiBaseUrl) {
    const tableNo = form.tableNo || "A01";
    const capacity = Number(form.capacity || 8);
    return Promise.resolve({
      party: {
        id: `local_party_${Date.now()}`,
        title: form.title,
        startsAt: form.startsAt,
        admin: { id: form.adminId || "admin_mimei", displayName: "管理员" },
        bar: {
          name: form.barName || "33 Party Lounge",
          address: form.barAddress || "",
          latitude: form.latitude || 0,
          longitude: form.longitude || 0
        }
      },
      tables: [normalizeAdminTable({
        id: `local_table_${Date.now()}`,
        tableNo,
        title: form.title,
        status: "available",
        statusText: "人数未满",
        memberCount: 0,
        totalMemberCount: 0,
        ghostCount: 0,
        openSeats: capacity,
        capacity,
        messageCount: 0,
        photoCount: 0,
        shareScene: `${tableNo.toLowerCase()}_local`,
        members: []
      }, { admin: { displayName: "管理员" } })]
    });
  }
  return request("/api/admin/parties", {
    method: "POST",
    header: adminHeader(form.adminKey),
    data: {
      adminId: form.adminId || "admin_mimei",
      title: form.title,
      tableNo: form.tableNo,
      capacity: Number(form.capacity || 8),
      barName: form.barName,
      barAddress: form.barAddress,
      startsAt: form.startsAt,
      latitude: form.latitude,
      longitude: form.longitude
    }
  }).then((res) => ({
    party: res.party,
    table: res.table ? normalizeAdminTable(res.table, res.party) : null,
    tables: (res.tables || []).map((table) => normalizeAdminTable(table, res.party))
  }));
}

function updateAdminParty(form) {
  if (!app.globalData.apiBaseUrl) {
    const capacity = Number(form.capacity || 8);
    return Promise.resolve({
      party: {
        id: form.partyId,
        title: form.title,
        startsAt: form.startsAt,
        admin: { id: form.adminId || "admin_mimei", displayName: "管理员" },
        bar: {
          name: form.barName || "33 Party Lounge",
          address: form.barAddress || "",
          latitude: form.latitude || 0,
          longitude: form.longitude || 0
        }
      },
      table: normalizeAdminTable({
        id: form.tableId,
        partyId: form.partyId,
        tableNo: form.tableNo,
        title: form.title,
        capacity,
        openSeats: capacity,
        barName: form.barName,
        barAddress: form.barAddress,
        latitude: form.latitude,
        longitude: form.longitude,
        startsAt: form.startsAt,
        members: []
      }, { id: form.partyId, title: form.title, startsAt: form.startsAt })
    });
  }
  return request("/api/admin/parties/update", {
    method: "POST",
    header: adminHeader(form.adminKey),
    data: {
      adminId: form.adminId || "admin_mimei",
      partyId: form.partyId,
      tableId: form.tableId,
      title: form.title,
      tableNo: form.tableNo,
      capacity: Number(form.capacity || 8),
      barName: form.barName,
      barAddress: form.barAddress,
      startsAt: form.startsAt,
      latitude: form.latitude,
      longitude: form.longitude
    }
  }).then((res) => ({
    party: res.party,
    table: normalizeAdminTable(res.table || {}, res.party)
  }));
}

function endAdminParty(partyId, adminId = "admin_mimei", adminKey = "") {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve({ ok: true, party: { id: partyId, status: "ended" }, tables: [] });
  }
  return request("/api/admin/parties/end", {
    method: "POST",
    header: adminHeader(adminKey),
    data: {
      partyId,
      adminId
    }
  }).then((res) => ({
    party: res.party,
    tables: (res.tables || []).map((table) => normalizeAdminTable(table, res.party))
  }));
}

function deleteEndedParties(partyIds = [], adminId = "admin_mimei", adminKey = "") {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve({ ok: true, deletedPartyIds: partyIds });
  }
  return request("/api/admin/parties/delete", {
    method: "POST",
    header: adminHeader(adminKey),
    data: {
      partyIds,
      adminId
    }
  });
}

function setTableHead(tableId, memberId = "", adminKey = "") {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve({ ok: true, tableId, memberId });
  }
  return request("/api/admin/tables/head", {
    method: "POST",
    header: adminHeader(adminKey),
    data: {
      tableId,
      memberId
    }
  }).then((res) => ({
    table: normalizeAdminTable(res.table || {}, {})
  }));
}

function joinParty(partyId, tableId, userId) {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve(null);
  }

  return request("/api/party/join", {
    method: "POST",
    data: {
      partyId,
      tableId,
      userId
    }
  }).then((res) => normalizeRoom(res));
}

async function updateUserProfile(profile) {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve(normalizeProfile({
      ...profile,
      id: profile.id || `local_${Date.now()}`
    }));
  }
  const avatarUpload = await uploadMedia(profile.avatarUrl, "avatar");
  return request("/api/users/profile", {
    method: "POST",
    data: {
      id: profile.id,
      openid: profile.openid,
      nickname: profile.nickName || profile.nickname,
      avatarUrl: avatarUpload.mediaUrl || profile.avatarUrl,
      gender: profile.gender || "unknown",
      wechatId: profile.wechatId,
      agreementAccepted: !!profile.agreementAccepted,
      ageConfirmed: !!profile.ageConfirmed
    }
  }).then((res) => normalizeProfile(res.user));
}

function submitReport(report) {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve({ ok: true, report: normalizeReport({ ...report, id: `local_report_${Date.now()}` }) });
  }
  return request("/api/reports", {
    method: "POST",
    data: report
  }).then((res) => normalizeReport(res.report));
}

function saveMessageSubscription(room, userId, status = "accepted", templateId = "") {
  const targetTemplateId = templateId || app.globalData.messageTemplateId;
  if (!app.globalData.apiBaseUrl || !room || !room.partyId || !room.tableId || !userId || !targetTemplateId) {
    return Promise.resolve({ ok: false, skipped: true });
  }
  return request("/api/messages/subscribe", {
    method: "POST",
    data: {
      partyId: room.partyId,
      tableId: room.tableId,
      userId,
      templateId: targetTemplateId,
      status
    }
  });
}

async function sendRoomMessage(roomId, tableId, message, options = {}) {
  if (!app.globalData.apiBaseUrl) {
    return Promise.reject(new Error("API base url is not configured"));
  }
  const localMediaPath = message.mediaUrl || message.image || message.video || message.voicePath;
  const mediaUpload = await uploadMedia(localMediaPath, message.type);
  const stableMediaUrl = mediaUpload.mediaUrl || localMediaPath;
  const senderType = message.senderType || options.senderType || "user";
  const adminKey = options.adminKey || (senderType === "admin" ? getStoredAdminSession().adminKey : "");
  return request("/api/messages", {
    method: "POST",
    header: adminHeader(adminKey),
    data: {
      partyId: roomId,
      tableId,
      senderType,
      senderId: message.senderId || options.senderId || app.globalData.userProfile && app.globalData.userProfile.id,
      kind: message.type,
      text: message.text,
      mediaUrl: stableMediaUrl,
      durationSeconds: message.durationSeconds,
      quoteMessageId: message.quote && message.quote.id,
      quoteSender: message.quote && message.quote.sender,
      quoteKind: message.quote && message.quote.type,
      quoteText: message.quote && message.quote.text,
      quoteMediaUrl: message.quote && message.quote.mediaUrl,
      quoteDurationSeconds: message.quote && message.quote.durationSeconds,
      isFlash: message.isFlash,
      flashSeconds: message.flashSeconds
    }
  }).then((res) => normalizeMessage(res.message));
}

function getRoomMessages(roomId, tableId, afterId = "") {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve([]);
  }
  return request("/api/messages", {
    data: {
      partyId: roomId,
      tableId,
      afterId
    }
  }).then((res) => (res.messages || []).map(normalizeMessage).filter((message) => !message.flashExpired));
}

function likeMessage(roomId, messageId) {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve({ roomId, messageId, ok: true });
  }
  return request("/api/messages/like", {
    method: "POST",
    data: { messageId }
  }).then((res) => normalizeMessage(res.message));
}

function connectRoomSocket(room, handlers = {}) {
  if (!app.globalData.apiBaseUrl || !room || !room.partyId || !room.tableId || !wx.connectSocket) {
    return null;
  }
  const url = toWebSocketUrl(buildUrl("/ws/room", {
    partyId: room.partyId,
    tableId: room.tableId,
    userId: app.globalData.userProfile && app.globalData.userProfile.id
  }));
  const socketTask = wx.connectSocket({ url });
  socketTask.onOpen(() => {
    if (handlers.onOpen) {
      handlers.onOpen();
    }
  });
  socketTask.onMessage((event) => {
    let payload = null;
    try {
      payload = JSON.parse(event.data);
    } catch (error) {
      return;
    }
    if ((payload.type === "message.created" || payload.type === "message.updated") && payload.message) {
      payload.message = normalizeMessage(payload.message);
    }
    if (payload.type === "user.profile.updated" && payload.user) {
      payload.user = normalizeProfile(payload.user);
    }
    if (payload.type === "member.updated" && payload.member) {
      payload.member = normalizeMember(payload.member);
    }
    if ((payload.type === "room.updated" || payload.type === "member.removed") && (payload.party || payload.table || payload.members)) {
      payload.room = normalizeRoom(payload);
      payload.members = payload.room.members;
    }
    if (handlers.onMessage) {
      handlers.onMessage(payload);
    }
  });
  socketTask.onClose((event) => {
    if (handlers.onClose) {
      handlers.onClose(event);
    }
  });
  socketTask.onError((error) => {
    if (handlers.onError) {
      handlers.onError(error);
    }
  });
  return socketTask;
}

function connectAdminSocket({ partyId = "", adminId = "admin_mimei", adminKey = "" } = {}, handlers = {}) {
  if (!app.globalData.apiBaseUrl || !partyId || !wx.connectSocket) {
    return null;
  }
  const auth = adminKey && adminKey.indexOf("token:") === 0
    ? { adminToken: adminKey.slice(6) }
    : { adminKey };
  const url = toWebSocketUrl(buildUrl("/ws/admin", {
    partyId,
    adminId,
    ...auth
  }));
  const socketTask = wx.connectSocket({ url });
  socketTask.onOpen(() => {
    if (handlers.onOpen) {
      handlers.onOpen();
    }
  });
  socketTask.onMessage((event) => {
    let payload = null;
    try {
      payload = JSON.parse(event.data);
    } catch (error) {
      return;
    }
    if (handlers.onMessage) {
      handlers.onMessage(payload);
    }
  });
  socketTask.onClose((event) => {
    if (handlers.onClose) {
      handlers.onClose(event);
    }
  });
  socketTask.onError((error) => {
    if (handlers.onError) {
      handlers.onError(error);
    }
  });
  return socketTask;
}

function setMemberSeat(memberId, seatStatus = "seated", adminKey = "") {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve({ ok: true, memberId, seatStatus, member: null, table: null });
  }
  return request("/api/admin/members/seat", {
    method: "POST",
    header: adminHeader(adminKey),
    data: { memberId, seatStatus }
  }).then((res) => ({
    ...res,
    member: res.member ? normalizeMember(res.member) : null,
    table: res.table ? normalizeAdminTable(res.table, {}) : null
  }));
}

function kickMember(memberId, adminKey = "") {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve({ ok: true, memberId });
  }
  return request("/api/admin/members/kick", {
    method: "POST",
    header: adminHeader(adminKey),
    data: { memberId }
  });
}

function getAdminReports(partyId = "party_demo", status = "pending", adminId = "admin_mimei", adminKey = "") {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve([]);
  }
  return request("/api/admin/reports", {
    data: {
      partyId,
      status,
      adminId
    },
    header: adminHeader(adminKey)
  }).then((res) => (res.reports || []).map(normalizeReport));
}

function resolveReport(reportId, status = "resolved", adminId = "admin_mimei", adminKey = "") {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve({ ok: true, reportId, status });
  }
  return request("/api/admin/reports/resolve", {
    method: "POST",
    header: adminHeader(adminKey),
    data: {
      reportId,
      status,
      adminId
    }
  }).then((res) => normalizeReport(res.report));
}

function deleteMessage(messageId, reason = "违规内容", adminId = "admin_mimei", adminKey = "") {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve({ ok: true, messageId });
  }
  return request("/api/admin/messages/delete", {
    method: "POST",
    header: adminHeader(adminKey),
    data: {
      messageId,
      reason,
      adminId
    }
  }).then((res) => normalizeMessage(res.message));
}

function banUser(userId, reason = "违规使用", partyId = "party_demo", adminId = "admin_mimei", adminKey = "") {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve(normalizeProfile({ id: userId, bannedAt: new Date().toISOString(), banReason: reason }));
  }
  return request("/api/admin/users/ban", {
    method: "POST",
    header: adminHeader(adminKey),
    data: {
      userId,
      reason,
      partyId,
      adminId
    }
  }).then((res) => normalizeProfile(res.user));
}

function unbanUser(userId, partyId = "party_demo", adminId = "admin_mimei", adminKey = "") {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve(normalizeProfile({ id: userId }));
  }
  return request("/api/admin/users/unban", {
    method: "POST",
    header: adminHeader(adminKey),
    data: {
      userId,
      partyId,
      adminId
    }
  }).then((res) => normalizeProfile(res.user));
}

function recordManagerWechatAction(roomId, managerId) {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve({
      roomId,
      managerId,
      ok: true
    });
  }
  return request("/api/contact/request", {
    method: "POST",
    data: {
      partyId: roomId,
      requesterType: "user",
      requesterId: app.globalData.userProfile && app.globalData.userProfile.id,
      targetType: "admin",
      targetId: managerId
    }
  });
}

module.exports = {
  getRoomByEntry,
  getConfig,
  getAdminDashboard,
  adminLogin,
  bindAdminOpenid,
  userLogin,
  getTableInvite,
  downloadTableQrcode,
  downloadRoomQrcode,
  updateAdminProfile,
  createAdminParty,
  updateAdminParty,
  endAdminParty,
  deleteEndedParties,
  setTableHead,
  joinParty,
  updateUserProfile,
  submitReport,
  saveMessageSubscription,
  sendRoomMessage,
  getRoomMessages,
  uploadMedia,
  likeMessage,
  connectRoomSocket,
  connectAdminSocket,
  setMemberSeat,
  kickMember,
  getAdminReports,
  resolveReport,
  deleteMessage,
  banUser,
  unbanUser,
  recordManagerWechatAction
};
