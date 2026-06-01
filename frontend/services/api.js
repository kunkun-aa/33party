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

function adminLogin(adminId, code) {
  return request("/api/admin/login", {
    method: "POST",
    data: {
      adminId,
      code
    }
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
  return {
    ...profile,
    id: profile.id,
    nickName: profile.nickName || profile.nickname || "新朋友",
    avatarUrl: profile.avatarUrl || profile.avatar_url || "",
    gender: profile.gender || "unknown",
    agreementAcceptedAt: profile.agreementAcceptedAt || profile.agreement_accepted_at || "",
    ageConfirmedAt: profile.ageConfirmedAt || profile.age_confirmed_at || "",
    agreementAccepted: !!(profile.agreementAccepted || profile.agreementAcceptedAt || profile.agreement_accepted_at),
    ageConfirmed: !!(profile.ageConfirmed || profile.ageConfirmedAt || profile.age_confirmed_at),
    bannedAt: profile.bannedAt || profile.banned_at || "",
    banReason: profile.banReason || profile.ban_reason || ""
  };
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

function formatBeijingTime(date) {
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const hour = `${beijing.getUTCHours()}`.padStart(2, "0");
  const minute = `${beijing.getUTCMinutes()}`.padStart(2, "0");
  return `${hour}:${minute}`;
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
  const currentUserId = app.globalData.userProfile && app.globalData.userProfile.id;
  const createdAt = parseApiDate(message.createdAt) || new Date();
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
    type: isDeleted ? "text" : (message.kind || message.type || "text"),
    senderId,
    senderType: message.senderType || message.sender_type || "user",
    sender: sender.displayName || sender.nickname || message.sender || "系统",
    avatar: sender.avatarUrl || message.avatar || "",
    time: message.time || formatBeijingTime(createdAt),
    text: isDeleted ? "该消息已被管理员删除" : message.text,
    image: isDeleted ? "" : (message.mediaUrl || message.image),
    video: isDeleted ? "" : (message.mediaUrl || message.video || ""),
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
    isMine: !!(message.isMine || (currentUserId && senderId && currentUserId === senderId))
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
    members: (room.members || []).map((member) => ({
      id: member.id,
      memberId: member.memberId,
      name: member.nickname || member.name,
      role: member.role || "成员",
      gender: member.gender || "unknown",
      seatStatus: member.seatStatus || "ghost",
      seatStatusText: member.seatStatus === "seated" ? "已占位" : "未占位",
      online: member.online !== false,
      avatar: member.avatarUrl || member.avatar || "",
      bannedAt: member.bannedAt || "",
      banReason: member.banReason || ""
    })),
    messages: (room.messages || []).map(normalizeMessage).filter((message) => !message.flashExpired)
  };
}

function normalizeAdminTable(table = {}, party = {}) {
  const recentMessage = table.recentMessage || {};
  const members = table.members || [];
  const status = table.status || "available";
  const headMember = table.head || members.find((member) => member.memberId === table.headMemberId) || null;

  return {
    id: table.id,
    tableNo: table.tableNo,
    title: table.title || party.title || "",
    status,
    statusText: table.statusText || (status === "full" ? "人数已满" : "人数未满"),
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
    note: table.openSeats > 0 ? `还有 ${table.openSeats} 个空位` : "已满员，留意现场秩序",
    members: members.map((member) => ({
      id: member.id,
      memberId: member.memberId,
      name: member.nickname || member.name,
      role: member.memberId && (member.memberId === table.headMemberId || (headMember && member.memberId === headMember.memberId)) ? "局头" : "成员",
      gender: member.gender || "unknown",
      seatStatus: member.seatStatus || "ghost",
      seatStatusText: member.seatStatus === "seated" ? "已占位" : "未占位",
      avatar: (member.nickname || member.name || "?").slice(0, 1),
      online: member.online !== false,
      wechatId: member.wechatId || "",
      bannedAt: member.bannedAt || "",
      banReason: member.banReason || "",
      banned: !!member.bannedAt
    }))
  };
}

async function getRoomByEntry(entry) {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve(buildRoom(entry));
  }

  if (entry.partyId && entry.tableId) {
    const roomRes = await request("/api/room", {
      data: {
        partyId: entry.partyId,
        tableId: entry.tableId,
        userId: app.globalData.userProfile && app.globalData.userProfile.id
      }
    });
    return normalizeRoom(roomRes);
  }

  const scene = entry.scene || entry.inviteCode || "party_demo";
  const sceneRes = await request("/api/party/by-scene", {
    data: { scene }
  });
  const partyId = sceneRes.party.id;
  const tableId = entry.tableId || sceneRes.defaultTableId;
  const roomRes = await request("/api/room", {
    data: {
      partyId,
      tableId,
      userId: app.globalData.userProfile && app.globalData.userProfile.id
    }
  });
  return normalizeRoom(roomRes);
}

function getAdminDashboard(partyId = "party_demo", adminId = "admin_mimei", adminKey = "") {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve(null);
  }

  return request("/api/admin/tables", {
    data: {
      partyId,
      adminId
    },
    header: adminHeader(adminKey)
  }).then((res) => {
    const tables = (res.tables || []).map((table) => normalizeAdminTable(table, res.party));
    return {
      adminProfile: {
        id: res.party.admin.id,
        name: res.party.admin.displayName,
        wechatId: res.party.admin.wechatId,
        visibleToUsers: true
      },
      party: res.party,
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
        admin: { id: form.adminId || "admin_mimei", displayName: "管理员" },
        bar: {
          name: form.barName || "33 Party Lounge",
          address: form.barAddress || ""
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
      latitude: form.latitude,
      longitude: form.longitude
    }
  }).then((res) => ({
    party: res.party,
    tables: (res.tables || []).map((table) => normalizeAdminTable(table, res.party))
  }));
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

function updateUserProfile(profile) {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve(normalizeProfile({
      ...profile,
      id: profile.id || `local_${Date.now()}`
    }));
  }
  return request("/api/users/profile", {
    method: "POST",
    data: {
      id: profile.id,
      openid: profile.openid,
      nickname: profile.nickName || profile.nickname,
      avatarUrl: profile.avatarUrl,
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

async function sendRoomMessage(roomId, tableId, message) {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve({
      ...message,
      id: `local_msg_${Date.now()}`
    });
  }
  const localMediaPath = message.mediaUrl || message.image || message.video || message.voicePath;
  const mediaUpload = await uploadMedia(localMediaPath, message.type);
  const stableMediaUrl = mediaUpload.mediaUrl || localMediaPath;
  return request("/api/messages", {
    method: "POST",
    data: {
      partyId: roomId,
      tableId,
      senderType: "user",
      senderId: app.globalData.userProfile && app.globalData.userProfile.id,
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
    return Promise.resolve({ ok: true, memberId, seatStatus });
  }
  return request("/api/admin/members/seat", {
    method: "POST",
    header: adminHeader(adminKey),
    data: { memberId, seatStatus }
  });
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
  updateAdminProfile,
  createAdminParty,
  setTableHead,
  joinParty,
  updateUserProfile,
  submitReport,
  saveMessageSubscription,
  sendRoomMessage,
  uploadMedia,
  likeMessage,
  connectRoomSocket,
  setMemberSeat,
  kickMember,
  getAdminReports,
  resolveReport,
  deleteMessage,
  banUser,
  unbanUser,
  recordManagerWechatAction
};
