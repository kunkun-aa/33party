const mockRoom = {
  partyId: "party_mock_0529",
  tableId: "A08",
  scene: "mock_scene_A08",
  title: "33 Party 主局",
  statusText: "人数未满",
  liveTag: "今晚 21:30 开局",
  manager: {
    name: "Mika",
    role: "局头 / 管理员",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=160&q=80",
    wechatId: "Mika33Party",
    contactHint: "到店、拼桌、改人数请先加管理员"
  },
  venue: {
    name: "NOX Cocktail Club",
    address: "上海市静安区铜仁路 88 号 B1",
    latitude: 31.2304,
    longitude: 121.4737,
    distance: "距你约 1.8km"
  },
  room: {
    tableName: "A08 主桌",
    roomName: "人数未满",
    minSpend: "低消 3680",
    capacity: "4/8 占位",
    seatStatusText: "人数未满",
    openSeats: 4,
    entryCode: "A08-33"
  },
  members: [
    {
      id: "u1",
      memberId: "mock_u1",
      name: "Mika",
      role: "局头",
      gender: "female",
      seatStatus: "seated",
      seatStatusText: "已占位",
      online: true,
      avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=160&q=80"
    },
    {
      id: "u2",
      memberId: "mock_u2",
      name: "Leo",
      role: "已到店",
      gender: "male",
      seatStatus: "seated",
      seatStatusText: "已占位",
      online: true,
      avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=160&q=80"
    },
    {
      id: "u3",
      memberId: "mock_u3",
      name: "Nora",
      role: "路上",
      gender: "female",
      seatStatus: "ghost",
      seatStatusText: "未占位",
      online: false,
      avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=160&q=80"
    },
    {
      id: "u4",
      memberId: "mock_u4",
      name: "Kai",
      role: "已入座",
      gender: "male",
      seatStatus: "seated",
      seatStatusText: "已占位",
      online: true,
      avatar: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=160&q=80"
    }
  ],
  messages: [
    {
      id: "m1",
      type: "text",
      sender: "Mika",
      avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=160&q=80",
      time: "21:18",
      text: "A08 已留位，到了报我名字。",
      likeCount: 2
    },
    {
      id: "m2",
      type: "photo",
      sender: "Leo",
      avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=160&q=80",
      time: "21:24",
      text: "现场灯光还不错",
      image: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=520&q=80",
      likeCount: 7,
      isFlash: false
    },
    {
      id: "m3",
      type: "voice",
      sender: "Nora",
      avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=160&q=80",
      time: "21:27",
      duration: "08''",
      text: "语音消息",
      likeCount: 1
    }
  ]
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildRoom(overrides = {}) {
  const room = clone(mockRoom);
  if (overrides.partyId) {
    room.partyId = overrides.partyId;
  }
  if (overrides.tableId) {
    room.tableId = overrides.tableId;
    room.room.tableName = `${overrides.tableId} 主桌`;
    room.room.entryCode = `${overrides.tableId}-33`;
  }
  if (overrides.scene) {
    room.scene = overrides.scene;
  }
  return room;
}

module.exports = {
  buildRoom
};
