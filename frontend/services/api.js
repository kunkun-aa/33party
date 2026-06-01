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
        reject(new Error(`Request failed: ${res.statusCode}`));
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

function normalizeProfile(profile = {}) {
  return {
    ...profile,
    id: profile.id,
    nickName: profile.nickName || profile.nickname || "新朋友",
    avatarUrl: profile.avatarUrl || profile.avatar_url || "",
    gender: profile.gender || "unknown"
  };
}

function normalizeMessage(message = {}) {
  const sender = message.sender || {};
  const senderId = sender.id || message.senderId || message.sender_id || "";
  const currentUserId = app.globalData.userProfile && app.globalData.userProfile.id;
  const createdAt = message.createdAt ? new Date(message.createdAt.replace(" ", "T")) : new Date();
  const hour = `${createdAt.getHours()}`.padStart(2, "0");
  const minute = `${createdAt.getMinutes()}`.padStart(2, "0");

  return {
    id: message.id,
    type: message.kind || message.type || "text",
    senderId,
    senderType: message.senderType || message.sender_type || "user",
    sender: sender.displayName || sender.nickname || message.sender || "系统",
    avatar: sender.avatarUrl || message.avatar || "",
    time: message.time || `${hour}:${minute}`,
    text: message.text,
    image: message.mediaUrl || message.image,
    duration: message.duration || (message.durationSeconds ? `${message.durationSeconds}''` : "06''"),
    likeCount: message.likeCount || message.likeCount === 0 ? message.likeCount : (message.likes || 0),
    isFlash: !!message.isFlash,
    flashSeconds: message.flashSeconds || 10,
    flashExpiresAt: message.flashExpiresAt || "",
    flashExpired: !!(message.isFlash && message.flashExpiresAt && new Date(message.flashExpiresAt.replace(" ", "T")).getTime() <= Date.now()),
    isMine: !!(message.isMine || (currentUserId && senderId && currentUserId === senderId))
  };
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
    liveTag: party.startsAt ? `开局时间 ${party.startsAt}` : room.liveTag || "今晚主局",
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
      avatar: member.avatarUrl || member.avatar || ""
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
    updatedAt: recentMessage.createdAt || "刚刚",
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
      wechatId: member.wechatId || ""
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
      wechatId: profile.wechatId
    }
  }).then((res) => normalizeProfile(res.user));
}

function sendRoomMessage(roomId, tableId, message) {
  if (!app.globalData.apiBaseUrl) {
    return Promise.resolve({
      ...message,
      id: `local_msg_${Date.now()}`
    });
  }
  return request("/api/messages", {
    method: "POST",
    data: {
      partyId: roomId,
      tableId,
      senderType: "user",
      senderId: app.globalData.userProfile && app.globalData.userProfile.id,
      kind: message.type,
      text: message.text,
      mediaUrl: message.image,
      durationSeconds: message.durationSeconds,
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
  getAdminDashboard,
  adminLogin,
  bindAdminOpenid,
  getTableInvite,
  updateAdminProfile,
  createAdminParty,
  setTableHead,
  joinParty,
  updateUserProfile,
  sendRoomMessage,
  likeMessage,
  setMemberSeat,
  kickMember,
  recordManagerWechatAction
};
