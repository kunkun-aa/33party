const api = require("../../services/api")

const adminProfile = {
  name: '33Party 客服',
  wechatId: 'party33-admin',
  visibleToUsers: true
}

const avatarColors = ['#3b82f6', '#14b8a6', '#f97316', '#8b5cf6', '#ec4899', '#06b6d4', '#22c55e', '#f59e0b']
const ADMIN_REALTIME_DEBOUNCE_MS = 300
const ADMIN_REALTIME_RECONNECT_MS = 3000

function hashText(value = '') {
  return String(value).split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
}

function isAvatarImage(value = '') {
  return /^(https?:|wxfile:|cloud:|\/)/.test(String(value || ''))
}

function decorateMemberAvatar(member = {}) {
  const rawAvatar = member.avatarUrl || member.avatar_url || (isAvatarImage(member.avatar) ? member.avatar : '')
  const fallbackText = !rawAvatar && member.avatar && !isAvatarImage(member.avatar)
    ? member.avatar
    : (member.name || '?').slice(0, 1).toUpperCase()
  const seed = member.memberId || member.id || member.name || rawAvatar || fallbackText
  return {
    ...member,
    avatarUrl: rawAvatar,
    avatarText: member.avatarText || fallbackText,
    avatarColor: avatarColors[hashText(seed) % avatarColors.length]
  }
}

function decorateTableAvatars(table = {}) {
  return {
    ...table,
    members: (table.members || []).map(decorateMemberAvatar)
  }
}

function defaultStartsAt() {
  const date = new Date(Date.now() + 2 * 60 * 60 * 1000)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hour = `${date.getHours()}`.padStart(2, '0')
  const minute = `${date.getMinutes()}`.padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}`
}

const mockTables = [
  {
    id: 'T01',
    tableNo: 'A01',
    title: '周六拼台主局',
    status: 'available',
    statusText: '人数未满',
    headMemberId: 'mock_m1',
    head: '阿哲',
    memberCount: 6,
    capacity: 8,
    messageCount: 27,
    photoCount: 9,
    totalMemberCount: 6,
    ghostCount: 2,
    openSeats: 2,
    lastMessage: '小鹿：我们这桌缺一个会唱粤语的',
    updatedAt: '刚刚',
    joinCode: '33PA-A01',
    joinLink: 'https://33.party/join/33PA-A01',
    note: '节奏热，适合优先补位',
    members: [
      { memberId: 'mock_m1', name: '阿哲', role: '局头', avatar: '哲', online: true, wechatId: 'azhe-bar01', seatStatus: 'seated', seatStatusText: '已占位' },
      { memberId: 'mock_m2', name: '小鹿', role: '成员', avatar: '鹿', online: true, wechatId: 'xiaolu_33', seatStatus: 'ghost', seatStatusText: '未占位' },
      { memberId: 'mock_m3', name: 'Mia', role: '成员', avatar: 'M', online: true, wechatId: 'mia-night', seatStatus: 'ghost', seatStatusText: '未占位' },
      { memberId: 'mock_m4', name: 'Kevin', role: '成员', avatar: 'K', online: false, wechatId: 'kevin_ktv', seatStatus: 'seated', seatStatusText: '已占位' },
      { memberId: 'mock_m5', name: '晴晴', role: '成员', avatar: '晴', online: true, wechatId: 'qingqing-live', seatStatus: 'seated', seatStatusText: '已占位' },
      { memberId: 'mock_m6', name: 'Leo', role: '成员', avatar: 'L', online: true, wechatId: 'leo033party', seatStatus: 'seated', seatStatusText: '已占位' }
    ]
  },
  {
    id: 'T02',
    tableNo: 'A02',
    title: '周六拼台主局',
    status: 'available',
    statusText: '人数未满',
    headMemberId: 'mock_m7',
    head: 'Grace',
    memberCount: 3,
    capacity: 6,
    messageCount: 8,
    photoCount: 2,
    totalMemberCount: 3,
    ghostCount: 1,
    openSeats: 4,
    lastMessage: 'Grace：等两位朋友到就开始',
    updatedAt: '3 分钟前',
    joinCode: '33PA-A02',
    joinLink: 'https://33.party/join/33PA-A02',
    note: '可安排散客加入',
    members: [
      { memberId: 'mock_m7', name: 'Grace', role: '局头', avatar: 'G', online: true, wechatId: 'grace-party', seatStatus: 'seated', seatStatusText: '已占位' },
      { memberId: 'mock_m8', name: '森森', role: '成员', avatar: '森', online: true, wechatId: 'sensen_0303', seatStatus: 'seated', seatStatusText: '已占位' },
      { memberId: 'mock_m9', name: 'Nina', role: '成员', avatar: 'N', online: false, wechatId: 'nina33', seatStatus: 'ghost', seatStatusText: '未占位' }
    ]
  },
  {
    id: 'T03',
    tableNo: 'B05',
    title: '周六拼台主局',
    status: 'full',
    statusText: '人数已满',
    headMemberId: 'mock_m10',
    head: 'Ryan',
    memberCount: 8,
    capacity: 8,
    messageCount: 46,
    photoCount: 18,
    totalMemberCount: 8,
    ghostCount: 0,
    openSeats: 0,
    lastMessage: 'Ryan：照片墙已经更新，大家看一下',
    updatedAt: '1 分钟前',
    joinCode: '33PA-B05',
    joinLink: 'https://33.party/join/33PA-B05',
    note: '满员，客服只需关注秩序',
    members: [
      { memberId: 'mock_m10', name: 'Ryan', role: '局头', avatar: 'R', online: true, wechatId: 'ryan33party', seatStatus: 'seated', seatStatusText: '已占位' },
      { memberId: 'mock_m11', name: '晚晚', role: '成员', avatar: '晚', online: true, wechatId: 'wanwan_club', seatStatus: 'seated', seatStatusText: '已占位' },
      { memberId: 'mock_m12', name: 'Echo', role: '成员', avatar: 'E', online: true, wechatId: 'echoecho33', seatStatus: 'seated', seatStatusText: '已占位' },
      { memberId: 'mock_m13', name: 'Chris', role: '成员', avatar: 'C', online: true, wechatId: 'chris-live', seatStatus: 'seated', seatStatusText: '已占位' },
      { memberId: 'mock_m14', name: '安安', role: '成员', avatar: '安', online: true, wechatId: 'anan_party', seatStatus: 'seated', seatStatusText: '已占位' },
      { memberId: 'mock_m15', name: 'Jo', role: '成员', avatar: 'J', online: true, wechatId: 'jojo033', seatStatus: 'seated', seatStatusText: '已占位' },
      { memberId: 'mock_m16', name: '雪梨', role: '成员', avatar: '雪', online: true, wechatId: 'xueli-night', seatStatus: 'seated', seatStatusText: '已占位' },
      { memberId: 'mock_m17', name: 'Ben', role: '成员', avatar: 'B', online: true, wechatId: 'ben_party33', seatStatus: 'seated', seatStatusText: '已占位' }
    ]
  },
  {
    id: 'T04',
    tableNo: 'C03',
    title: '周六拼台主局',
    status: 'available',
    statusText: '人数未满',
    headMemberId: 'mock_m18',
    head: '林一',
    memberCount: 2,
    capacity: 6,
    messageCount: 3,
    photoCount: 0,
    totalMemberCount: 2,
    ghostCount: 1,
    openSeats: 5,
    lastMessage: '林一：先等等，人到齐再玩',
    updatedAt: '12 分钟前',
    joinCode: '33PA-C03',
    joinLink: 'https://33.party/join/33PA-C03',
    note: '建议客服确认是否需要并桌',
    members: [
      { memberId: 'mock_m18', name: '林一', role: '局头', avatar: '林', online: true, wechatId: 'linyi033', seatStatus: 'seated', seatStatusText: '已占位' },
      { memberId: 'mock_m19', name: '苏苏', role: '成员', avatar: '苏', online: false, wechatId: 'susu-night', seatStatus: 'ghost', seatStatusText: '未占位' }
    ]
  }
]

Page({
  data: {
    adminId: '',
    adminKey: '',
    partyId: '',
    tables: [],
    visibleTables: [],
    stats: {
      onlineMembers: 19,
      photoCount: 29,
      attentionCount: 4
    },
    adminProfile,
    currentParty: null,
    wechatDraft: adminProfile.wechatId,
    wechatSaving: false,
    createForm: {
      title: '周六拼台主局',
      tableNo: 'A01',
      capacity: '8',
      startsAt: defaultStartsAt(),
      barName: '33 Party Lounge',
      barAddress: '深圳市南山区后海中心路 33 Party Lounge',
      latitude: '',
      longitude: ''
    },
    creatingParty: false,
    editForm: {
      title: '',
      tableNo: '',
      capacity: '',
      startsAt: '',
      barName: '',
      barAddress: '',
      latitude: '',
      longitude: ''
    },
    savingParty: false,
    endingParty: false,
    deletingParties: false,
    endedTables: [],
    selectedEndedPartyIds: [],
    reports: [],
    reportFilter: 'pending',
    reportLoading: false,
    reportFilters: [
      { key: 'pending', label: '!' },
      { key: 'resolved', label: '✓' },
      { key: 'rejected', label: '×' }
    ],
    memberActionSheetShow: false,
    memberActionSheetTitle: '',
    memberActionSheetActions: [],
    activeMemberAction: null,
    selectedId: '',
    selectedTable: null,
    filter: 'all',
    copiedText: '',
    refreshing: false,
    theme: getApp().getTheme ? getApp().getTheme() : 'dark',
    invitePanelVisible: false,
    inviteLoading: false,
    inviteInfo: {
      tableNo: '',
      scene: '',
      link: '',
      qrcodePath: '',
      error: ''
    },
    topSafeArea: 0
  },

  onLoad(options = {}) {
    this.pageUnloaded = false
    this.pageHidden = false
    this.dashboardLoading = false
    this.reportsLoading = false
    this.adminRealtimePartyId = ''
    this.actionLocks = {}
    const app = getApp()
    const storedAdminSession = app.globalData.adminSession || wx.getStorageSync('partyAdminSession') || {}
    const nextData = {}
    if (options.partyId) {
      nextData.partyId = options.partyId
    } else if (storedAdminSession.partyId) {
      nextData.partyId = storedAdminSession.partyId
    }
    if (options.adminId) {
      nextData.adminId = options.adminId
    } else if (storedAdminSession.adminId) {
      nextData.adminId = storedAdminSession.adminId
    }
    if (options.adminKey) {
      nextData.adminKey = options.adminKey
    } else if (storedAdminSession.adminKey) {
      nextData.adminKey = storedAdminSession.adminKey
    }
    if (Object.keys(nextData).length) {
      this.setData(nextData)
    }
    this.prepareAdminSession().finally(() => {
      this.loadDashboard({ preserveSelection: true }).finally(() => {
        this.startAdminAutoRefresh()
      })
    })
    this.updateSelected(this.data.selectedId)
    this.updateSafeArea()
  },

  onShow() {
    const app = getApp()
    this.pageHidden = false
    this.setData({ theme: app.getTheme ? app.getTheme() : 'dark' })
    // Verify session freshness before connecting — prevents stale-token errors.
    this.verifyAdminSession().then(() => {
      this.startAdminAutoRefresh()
      if (this.data.adminKey || this.data.adminId) {
        this.loadDashboard({ silent: true, preserveSelection: true })
      }
    })
  },

  onHide() {
    this.pageHidden = true
    this.stopAdminAutoRefresh()
  },

  onUnload() {
    this.pageUnloaded = true
    this.stopAdminAutoRefresh()
    clearTimeout(this.copyTimer)
    clearTimeout(this.refreshResetTimer)
    clearTimeout(this.adminRealtimeTimer)
    clearTimeout(this.adminReconnectTimer)
    this.copyTimer = null
    this.refreshResetTimer = null
    this.adminRealtimeTimer = null
    this.adminReconnectTimer = null
    this.actionLocks = {}
  },

  toggleTheme() {
    const app = getApp()
    const theme = app.toggleTheme ? app.toggleTheme() : 'dark'
    this.lightFeedback()
    this.setData({ theme })
  },

  lightFeedback(type = 'light') {
    if (!wx.vibrateShort) {
      return
    }
    try {
      wx.vibrateShort({ type })
    } catch (error) {
      try {
        wx.vibrateShort()
      } catch (fallbackError) {
        console.warn('轻触反馈不可用', fallbackError)
      }
    }
  },

  setDataIfAlive(data) {
    if (this.pageUnloaded) {
      return false
    }
    this.setData(data)
    return true
  },

  showToastIfAlive(options) {
    if (!this.pageUnloaded) {
      wx.showToast(options)
    }
  },

  runLockedAction(key, action) {
    this.actionLocks = this.actionLocks || {}
    if (this.actionLocks[key]) {
      return Promise.resolve(false)
    }
    this.actionLocks[key] = true
    return Promise.resolve()
      .then(action)
      .finally(() => {
        delete this.actionLocks[key]
      })
  },

  startAdminAutoRefresh() {
    const partyId = this.data.partyId
    if (this.pageUnloaded || this.pageHidden || !partyId || this.adminSocketTask) {
      return
    }
    // Don't connect with an empty or stale admin key.
    if (!this.data.adminKey) {
      return
    }
    this.adminRealtimePartyId = partyId
    this.adminSocketTask = api.connectAdminSocket({
      partyId,
      adminId: this.data.adminId,
      adminKey: this.data.adminKey
    }, {
      onMessage: (payload) => this.handleAdminRealtimeMessage(payload),
      onClose: () => {
        this.adminSocketTask = null
        this.scheduleAdminRealtimeReconnect()
      },
      onError: (error) => {
        console.warn('管理页实时连接异常', error)
      }
    })
  },

  stopAdminAutoRefresh() {
    clearTimeout(this.adminRealtimeTimer)
    clearTimeout(this.adminReconnectTimer)
    this.adminRealtimeTimer = null
    this.adminReconnectTimer = null
    if (this.adminSocketTask && this.adminSocketTask.close) {
      try {
        this.adminSocketTask.close()
      } catch (error) {
        console.warn('管理页实时连接关闭失败', error)
      }
    }
    this.adminSocketTask = null
    this.adminRealtimePartyId = ''
  },

  scheduleAdminRealtimeReconnect() {
    if (this.pageUnloaded || this.pageHidden || this.adminReconnectTimer) {
      return
    }
    this.adminReconnectTimer = setTimeout(() => {
      this.adminReconnectTimer = null
      // Verify session before reconnecting — avoids repeated auth failures.
      this.verifyAdminSession().then(() => {
        this.startAdminAutoRefresh()
      })
    }, ADMIN_REALTIME_RECONNECT_MS)
  },

  handleAdminRealtimeMessage(payload = {}) {
    if (!payload || payload.type === 'connected' || payload.type === 'pong') {
      return
    }
    if (payload.type === 'report.created' || payload.type === 'report.updated') {
      this.scheduleRealtimeRefresh(true)
      return
    }
    if (payload.type === 'dashboard.changed') {
      this.scheduleRealtimeRefresh(false)
    }
  },

  scheduleRealtimeRefresh(includeReports = false) {
    if (this.pageUnloaded || this.pageHidden) {
      return
    }
    this.pendingRealtimeReportRefresh = this.pendingRealtimeReportRefresh || includeReports
    clearTimeout(this.adminRealtimeTimer)
    this.adminRealtimeTimer = setTimeout(() => {
      this.adminRealtimeTimer = null
      const shouldRefreshReports = this.pendingRealtimeReportRefresh
      this.pendingRealtimeReportRefresh = false
      this.loadDashboard({ silent: true, preserveSelection: true })
      if (shouldRefreshReports) {
        this.loadReports(this.data.reportFilter, { silent: true })
      }
    }, ADMIN_REALTIME_DEBOUNCE_MS)
  },

  updateSafeArea() {
    try {
      const menu = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect()
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const top = menu && menu.bottom
        ? Math.max(menu.bottom + 8, (windowInfo.statusBarHeight || 0) + 48)
        : (windowInfo.statusBarHeight || 0) + 48
      this.setData({ topSafeArea: top })
    } catch (error) {
      this.setData({ topSafeArea: 48 })
    }
  },

  prepareAdminSession() {
    return new Promise((resolve) => {
      if (!wx.login) {
        resolve()
        return
      }
      wx.login({
        success: (res) => {
          if (!res.code) {
            resolve()
            return
          }
          const loginRequest = this.data.adminKey && this.data.adminKey.indexOf('token:') !== 0
            ? api.bindAdminOpenid(this.data.adminId, res.code, this.data.adminKey)
            : api.adminLogin(this.data.adminId, res.code)

          loginRequest.then((loginRes) => {
            if (this.pageUnloaded) {
              return
            }
            if (loginRes && loginRes.token) {
              const adminSession = {
                adminId: loginRes.admin.id,
                adminKey: `token:${loginRes.token}`,
                partyId: loginRes.party && loginRes.party.id || this.data.partyId || '',
                expiresAt: loginRes.expiresAt || 0
              }
              const app = getApp()
              app.globalData.adminSession = adminSession
              wx.setStorageSync('partyAdminSession', adminSession)
              this.setDataIfAlive({
                adminId: adminSession.adminId,
                adminKey: adminSession.adminKey,
                partyId: adminSession.partyId,
                adminProfile: {
                  ...this.data.adminProfile,
                  id: loginRes.admin.id,
                  name: loginRes.admin.displayName,
                  wechatId: loginRes.admin.wechatId
                },
                wechatDraft: loginRes.admin.wechatId || this.data.wechatDraft
              })
            }
          }).catch(() => {
            this.showToastIfAlive({ title: '管理员登录失败', icon: 'none' })
          }).finally(resolve)
        },
        fail: resolve
      })
    })
  },

  // Refresh the admin session when auth errors occur (e.g. "管理员密钥无效").
  refreshAdminSession() {
    if (this.pageUnloaded || this._sessionRefreshing) {
      return Promise.resolve(false)
    }
    this._sessionRefreshing = true
    return new Promise((resolve) => {
      if (!wx.login) {
        this._sessionRefreshing = false
        resolve(false)
        return
      }
      wx.login({
        success: (res) => {
          if (!res.code) {
            this._sessionRefreshing = false
            resolve(false)
            return
          }
          api.adminLogin(this.data.adminId || '', res.code).then((loginRes) => {
            if (this.pageUnloaded) {
              return
            }
            if (loginRes && loginRes.token) {
              const adminSession = {
                adminId: loginRes.admin.id,
                adminKey: `token:${loginRes.token}`,
                partyId: loginRes.party && loginRes.party.id || this.data.partyId || '',
                expiresAt: loginRes.expiresAt || 0
              }
              const app = getApp()
              app.globalData.adminSession = adminSession
              wx.setStorageSync('partyAdminSession', adminSession)
              this.setDataIfAlive({
                adminId: adminSession.adminId,
                adminKey: adminSession.adminKey,
                partyId: adminSession.partyId
              })
              // Reconnect WebSocket with the new token.
              this.stopAdminAutoRefresh()
              this.startAdminAutoRefresh()
              resolve(true)
            } else {
              resolve(false)
            }
          }).catch(() => {
            resolve(false)
          }).finally(() => {
            this._sessionRefreshing = false
          })
        },
        fail: () => {
          this._sessionRefreshing = false
          resolve(false)
        }
      })
    })
  },

  // Verify that the stored admin session is still valid.
  // If the session looks expired, proactively refresh it.
  verifyAdminSession() {
    const stored = getApp().globalData.adminSession || wx.getStorageSync('partyAdminSession') || {}
    const expiresAt = stored.expiresAt || 0
    const now = Math.floor(Date.now() / 1000)
    // Refresh if session expires in less than 1 hour.
    if (expiresAt && expiresAt - now < 3600) {
      return this.refreshAdminSession()
    }
    return Promise.resolve(true)
  },

  // Check if an error is an admin auth failure and try to refresh the session.
  isAdminAuthError(error) {
    const message = error && error.message || ''
    return /管理员密钥|管理员登录|密钥无效|token|401|权限/.test(message)
  },

  // Wrap an admin API call with automatic session refresh on auth failure.
  withAdminAuth(action) {
    return Promise.resolve(action()).catch((error) => {
      if (!this.isAdminAuthError(error)) {
        throw error
      }
      console.warn('管理页鉴权失败，尝试刷新登录', error && error.message)
      return this.refreshAdminSession().then((refreshed) => {
        if (!refreshed) {
          throw error
        }
        return action()
      })
    })
  },

  async loadDashboard(options = {}) {
    if (this.pageUnloaded) {
      return
    }
    if (this.dashboardLoading) {
      return
    }
    this.dashboardLoading = true
    try {
      const dashboard = await this.withAdminAuth(() =>
        api.getAdminDashboard(this.data.partyId, this.data.adminId, this.data.adminKey)
      )
      if (this.pageUnloaded) {
        return
      }
      const tables = (dashboard.tables || []).map(decorateTableAvatars)
      const visibleTables = this.filterTables(tables, this.data.filter)
      const selectedId = options.preserveSelection && tables.some((table) => table.id === this.data.selectedId)
        ? this.data.selectedId
        : (visibleTables[0] && visibleTables[0].id || tables[0] && tables[0].id || '')
      const selectedTable = tables.find((table) => table.id === selectedId) || null
      this.setData({
        partyId: dashboard.party && dashboard.party.id || this.data.partyId || '',
        tables,
        adminProfile: dashboard.adminProfile,
        currentParty: dashboard.party || null,
        wechatDraft: dashboard.adminProfile.wechatId,
        selectedId,
        selectedTable,
        editForm: this.buildEditForm(selectedTable, dashboard.party || null)
      })
      this.recalculate(tables)
      if (!this.pageHidden && this.data.partyId && this.adminRealtimePartyId !== this.data.partyId) {
        this.stopAdminAutoRefresh()
        this.startAdminAutoRefresh()
      }
      this.loadReports(this.data.reportFilter, { silent: options.silent })
    } catch (error) {
      if (this.pageUnloaded) {
        return
      }
      if (!options.silent) {
        this.recalculate([])
      }
      const message = error && error.message === '管理员密钥无效'
        ? '管理员未授权，请带 adminKey 进入'
        : '管理页加载失败'
      if (!options.silent) {
        this.showToastIfAlive({ title: message, icon: 'none' })
      } else {
        console.warn(message, error)
      }
    } finally {
      this.dashboardLoading = false
    }
  },

  onWechatDraftInput(event) {
    const value = event.detail && event.detail.value !== undefined ? event.detail.value : event.detail
    this.setData({ wechatDraft: value || '' })
  },

  async saveAdminWechat() {
    const wechatId = this.data.wechatDraft.trim()
    if (!wechatId) {
      this.showToastIfAlive({ title: '微信号不能为空', icon: 'none' })
      return
    }
    if (this.data.wechatSaving) {
      return
    }
    this.setDataIfAlive({ wechatSaving: true })
    try {
      const res = await api.updateAdminProfile({
        adminId: this.data.adminId,
        adminKey: this.data.adminKey,
        displayName: this.data.adminProfile.name,
        wechatId
      })
      if (this.pageUnloaded) {
        return
      }
      this.setDataIfAlive({
        adminProfile: res.adminProfile,
        wechatDraft: res.adminProfile.wechatId
      })
      this.setTransientCopy('admin_wechat_saved')
    } catch (error) {
      this.showToastIfAlive({ title: '保存失败', icon: 'none' })
    } finally {
      this.setDataIfAlive({ wechatSaving: false })
    }
  },

  onCreateFormInput(event) {
    const dataset = event.currentTarget.dataset || event.detail && event.detail.currentTarget && event.detail.currentTarget.dataset || event.detail || {}
    const { field } = dataset
    if (!field) {
      return
    }
    const value = event.detail && event.detail.value !== undefined ? event.detail.value : event.detail
    this.setData({
      [`createForm.${field}`]: value || ''
    })
  },

  chooseBarLocation() {
    if (!wx.chooseLocation) {
      this.showToastIfAlive({ title: '当前环境不支持定位选点', icon: 'none' })
      return
    }
    wx.chooseLocation({
      success: (res) => {
        this.setDataIfAlive({
          'createForm.barName': res.name || this.data.createForm.barName,
          'createForm.barAddress': res.address || res.name || this.data.createForm.barAddress,
          'createForm.latitude': res.latitude || '',
          'createForm.longitude': res.longitude || ''
        })
      },
      fail: (error) => {
        const message = error && error.errMsg || ''
        if (/cancel|auth deny|authorize no response|chooseLocation:fail/i.test(message)) {
          return
        }
        this.showToastIfAlive({ title: '无法选点', icon: 'none' })
      }
    })
  },

  buildEditForm(table = null, party = this.data.currentParty) {
    const bar = party && party.bar || {}
    return {
      title: table && table.title || party && party.title || '',
      tableNo: table && table.tableNo || '',
      capacity: table && table.capacity ? String(table.capacity) : '',
      startsAt: table && table.startsAtText || table && table.startsAt || party && party.startsAt || '',
      barName: table && table.barName || bar.name || this.data.createForm.barName || '',
      barAddress: table && table.barAddress || bar.address || this.data.createForm.barAddress || '',
      latitude: table && table.latitude || bar.latitude || '',
      longitude: table && table.longitude || bar.longitude || ''
    }
  },

  onEditFormInput(event) {
    const dataset = event.currentTarget.dataset || event.detail && event.detail.currentTarget && event.detail.currentTarget.dataset || event.detail || {}
    const { field } = dataset
    if (!field) {
      return
    }
    const value = event.detail && event.detail.value !== undefined ? event.detail.value : event.detail
    this.setData({
      [`editForm.${field}`]: value || ''
    })
  },

  chooseEditBarLocation() {
    if (!wx.chooseLocation) {
      this.showToastIfAlive({ title: '当前环境不支持定位选点', icon: 'none' })
      return
    }
    wx.chooseLocation({
      success: (res) => {
        this.setDataIfAlive({
          'editForm.barName': res.name || this.data.editForm.barName,
          'editForm.barAddress': res.address || res.name || this.data.editForm.barAddress,
          'editForm.latitude': res.latitude || '',
          'editForm.longitude': res.longitude || ''
        })
      },
      fail: (error) => {
        const message = error && error.errMsg || ''
        if (/cancel|auth deny|authorize no response|chooseLocation:fail/i.test(message)) {
          return
        }
        this.showToastIfAlive({ title: '无法选点', icon: 'none' })
      }
    })
  },

  async saveSelectedParty() {
    const table = this.data.selectedTable
    const partyId = table && table.partyId || this.data.currentParty && this.data.currentParty.id || this.data.partyId
    if (!table || !partyId) {
      this.showToastIfAlive({ title: '请选择要修改的局', icon: 'none' })
      return
    }
    const form = {
      ...this.data.editForm,
      title: this.data.editForm.title.trim(),
      tableNo: this.data.editForm.tableNo.trim(),
      startsAt: this.data.editForm.startsAt.trim(),
      barName: this.data.editForm.barName.trim(),
      barAddress: this.data.editForm.barAddress.trim(),
      capacity: Number(this.data.editForm.capacity || 0)
    }
    if (!form.title || !form.tableNo || !form.startsAt || !form.barAddress) {
      this.showToastIfAlive({ title: '请补全局名、桌号、时间和地址', icon: 'none' })
      return
    }
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(form.startsAt)) {
      this.showToastIfAlive({ title: '时间格式如 2026-06-02 21:00', icon: 'none' })
      return
    }
    if (!form.latitude || !form.longitude) {
      this.showToastIfAlive({ title: '请点“地图选点”确认位置', icon: 'none' })
      return
    }
    if (!form.capacity || form.capacity < 1 || form.capacity > 99) {
      this.showToastIfAlive({ title: '人数需在 1-99 之间', icon: 'none' })
      return
    }
    if (this.data.savingParty) {
      return
    }
    this.setDataIfAlive({ savingParty: true })
    try {
      const res = await api.updateAdminParty({
        ...form,
        partyId,
        tableId: table.id,
        adminId: this.data.adminId,
        adminKey: this.data.adminKey
      })
      if (this.pageUnloaded) {
        return
      }
      if (res.table) {
        this.replaceTable(res.table)
      }
      this.setDataIfAlive({
        currentParty: res.party || this.data.currentParty,
        editForm: this.buildEditForm(res.table || table, res.party || this.data.currentParty)
      })
      this.showToastIfAlive({ title: '局信息已保存', icon: 'success' })
    } catch (error) {
      this.showToastIfAlive({ title: error.message || '保存失败', icon: 'none' })
    } finally {
      this.setDataIfAlive({ savingParty: false })
    }
  },

  async createParty() {
    const form = {
      ...this.data.createForm,
      title: this.data.createForm.title.trim(),
      tableNo: this.data.createForm.tableNo.trim(),
      startsAt: this.data.createForm.startsAt.trim(),
      barName: this.data.createForm.barName.trim(),
      barAddress: this.data.createForm.barAddress.trim(),
      latitude: this.data.createForm.latitude,
      longitude: this.data.createForm.longitude,
      capacity: Number(this.data.createForm.capacity || 0)
    }
    if (!form.title || !form.tableNo || !form.startsAt || !form.barAddress) {
      this.showToastIfAlive({ title: '请补全局名、桌号、时间和地址', icon: 'none' })
      return
    }
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(form.startsAt)) {
      this.showToastIfAlive({ title: '时间格式如 2026-06-02 21:00', icon: 'none' })
      return
    }
    if (!form.latitude || !form.longitude) {
      this.showToastIfAlive({ title: '请点“地图选点”确认位置', icon: 'none' })
      return
    }
    if (!form.capacity || form.capacity < 1 || form.capacity > 99) {
      this.showToastIfAlive({ title: '人数需在 1-99 之间', icon: 'none' })
      return
    }
    if (this.data.creatingParty) {
      return
    }
    this.setDataIfAlive({ creatingParty: true })
    try {
      const res = await api.createAdminParty({
        ...form,
        adminId: this.data.adminId,
        adminKey: this.data.adminKey
      })
      if (this.pageUnloaded) {
        return
      }
      const tables = (res.tables || []).map(decorateTableAvatars)
      this.setDataIfAlive({
        partyId: res.party ? res.party.id : this.data.partyId,
        currentParty: res.party || null,
        tables,
        filter: 'all',
        selectedId: tables[0] ? tables[0].id : '',
        selectedTable: tables[0] || null,
        editForm: this.buildEditForm(tables[0] || null, res.party || null),
        selectedEndedPartyIds: []
      })
      this.recalculate(tables)
      this.setTransientCopy('party_created')
      this.loadDashboard()
    } catch (error) {
      this.showToastIfAlive({ title: '创建失败', icon: 'none' })
    } finally {
      this.setDataIfAlive({ creatingParty: false })
    }
  },

  endCurrentParty() {
    const partyId = this.data.currentParty && this.data.currentParty.id || this.data.partyId
    if (!partyId || this.data.endingParty) {
      return
    }
    wx.showModal({
      title: '解散当前局',
      content: '解散后用户不能再入局或继续聊天，该局会进入已结束列表，可再批量删除。',
      confirmText: '解散',
      confirmColor: '#d93025',
      success: async (res) => {
        if (!res.confirm) {
          return
        }
        this.setDataIfAlive({ endingParty: true })
        try {
          const result = await api.endAdminParty(partyId, this.data.adminId, this.data.adminKey)
          if (this.pageUnloaded) {
            return
          }
          const tables = result.tables && result.tables.length ? result.tables : this.data.tables.map((table) => ({
            ...table,
            status: 'ended',
            statusText: '已结束'
          }))
          this.setDataIfAlive({
            tables,
            currentParty: result.party || {
              ...this.data.currentParty,
              id: partyId,
              status: 'ended'
            }
          })
          this.updateSelected(this.data.selectedId)
          this.recalculate(tables)
          this.showToastIfAlive({ title: '已解散', icon: 'success' })
        } catch (error) {
          this.showToastIfAlive({ title: error.message || '解散失败', icon: 'none' })
        } finally {
          this.setDataIfAlive({ endingParty: false })
        }
      }
    })
  },

  toggleEndedParty(event) {
    const partyId = event.currentTarget.dataset.partyId
    if (!partyId) {
      return
    }
    const selected = new Set(this.data.selectedEndedPartyIds)
    if (selected.has(partyId)) {
      selected.delete(partyId)
    } else {
      selected.add(partyId)
    }
    this.setData({ selectedEndedPartyIds: Array.from(selected) })
    this.recalculate(this.data.tables)
  },

  deleteSelectedEndedParties() {
    const partyIds = this.data.selectedEndedPartyIds
    if (!partyIds.length || this.data.deletingParties) {
      this.showToastIfAlive({ title: '请选择已结束的局', icon: 'none' })
      return
    }
    wx.showModal({
      title: `删除 ${partyIds.length} 个已结束局`,
      content: '删除后会清理对应成员、消息、举报和桌台记录，无法恢复。',
      confirmText: '删除',
      confirmColor: '#d93025',
      success: async (res) => {
        if (!res.confirm) {
          return
        }
        this.setDataIfAlive({ deletingParties: true })
        try {
          await api.deleteEndedParties(partyIds, this.data.adminId, this.data.adminKey)
          if (this.pageUnloaded) {
            return
          }
          const deleted = new Set(partyIds)
          const tables = this.data.tables.filter((table) => !deleted.has(table.partyId || this.data.partyId))
          this.setDataIfAlive({
            tables,
            selectedEndedPartyIds: [],
            selectedId: tables[0] ? tables[0].id : '',
            selectedTable: tables[0] || null,
            editForm: this.buildEditForm(tables[0] || null)
          })
          this.recalculate(tables)
          this.showToastIfAlive({ title: '已删除', icon: 'success' })
        } catch (error) {
          this.showToastIfAlive({ title: error.message || '删除失败', icon: 'none' })
        } finally {
          this.setDataIfAlive({ deletingParties: false })
        }
      }
    })
  },

  selectTable(event) {
    const dataset = event.currentTarget.dataset || event.detail && event.detail.currentTarget && event.detail.currentTarget.dataset || event.detail || {}
    const { id } = dataset
    if (!id) {
      return
    }
    if (id && id !== this.data.selectedId) {
      this.lightFeedback()
    }
    this.updateSelected(id)
  },

  enterSelectedRoomAsAdmin(event = {}) {
    const dataset = event.currentTarget && event.currentTarget.dataset || {}
    const tableId = dataset.id || this.data.selectedId
    const table = this.data.tables.find((item) => item.id === tableId) || this.data.selectedTable
    if (!table) {
      this.showToastIfAlive({ title: '请选择要进入的局', icon: 'none' })
      return
    }
    const partyId = table.partyId || this.data.currentParty && this.data.currentParty.id || this.data.partyId
    const params = [
      `partyId=${encodeURIComponent(partyId)}`,
      `tableId=${encodeURIComponent(table.id)}`,
      `admin=1`,
      `adminId=${encodeURIComponent(this.data.adminId)}`
    ]
    if (this.data.adminKey) {
      params.push(`adminKey=${encodeURIComponent(this.data.adminKey)}`)
    }
    wx.navigateTo({
      url: `/frontend/pages/room/index?${params.join('&')}`
    })
  },

  setFilter(event) {
    const dataset = event.currentTarget.dataset || event.detail && event.detail.currentTarget && event.detail.currentTarget.dataset || event.detail || {}
    const filter = dataset.filter || dataset.detail || (typeof event.detail === 'string' ? event.detail : '')
    if (!filter) {
      return
    }
    if (filter && filter !== this.data.filter) {
      this.lightFeedback()
    }
    const visibleTables = this.getVisibleTables(filter)
    this.setData({
      filter,
      visibleTables,
      selectedId: visibleTables[0] ? visibleTables[0].id : '',
      selectedTable: visibleTables[0] || null,
      editForm: this.buildEditForm(visibleTables[0] || null)
    })
  },

  copyJoinLink() {
    const table = this.data.selectedTable
    if (!table) {
      return
    }
    return this.runLockedAction(`copy_join_${table.id}`, () => api.getTableInvite(table.id, this.data.adminId, this.data.adminKey).then((invite) => {
      if (this.pageUnloaded) {
        return
      }
      const link = invite.urlLink || table.joinLink || ''
      if (!link) {
        this.showToastIfAlive({ title: '入局链接暂未生成', icon: 'none' })
        return
      }
      this.copyText(link, '入局链接已复制', 'join_link')
    }).catch((error) => {
      const message = error && error.message === '管理员密钥无效'
        ? '管理员未授权，请带 adminKey 进入'
        : '入局链接生成失败'
      this.showToastIfAlive({ title: message, icon: 'none' })
    }))
  },

  copyAdminWechat() {
    this.copyText(this.data.adminProfile.wechatId, '管理员微信已复制')
  },

  copyMemberWechat(event) {
    const dataset = event.currentTarget.dataset || event.detail && event.detail.currentTarget && event.detail.currentTarget.dataset || event.detail || {}
    const { wechat, name } = dataset
    this.copyText(wechat, `${name} 的微信已复制`)
  },

  contactMember(event) {
    const dataset = event.currentTarget.dataset || event.detail && event.detail.currentTarget && event.detail.currentTarget.dataset || event.detail || {}
    const { wechat, name } = dataset
    this.copyText(wechat, `${name} 的微信已复制`)
  },

  openMemberActions(event) {
    const dataset = event.currentTarget.dataset || event.detail && event.detail.currentTarget && event.detail.currentTarget.dataset || event.detail || {}
    const { memberId, userId, name, seatStatus, isHead, banned } = dataset
    const isCurrentHead = isHead === true || isHead === 'true'
    const isBanned = banned === true || banned === 'true'
    const itemList = []
    if (seatStatus !== 'seated') {
      itemList.push('设为占位')
    }
    itemList.push(isCurrentHead ? '取消局头' : '设为局头')
    itemList.push(isBanned ? '解除封禁' : '封禁用户')
    itemList.push('移除成员')
    wx.showActionSheet({
      itemList,
      success: (res) => {
        const actionName = itemList[res.tapIndex]
        if (actionName === '设为占位') {
          this.markSeat({ currentTarget: { dataset: { memberId } } })
          return
        }
        if (actionName === '设为局头') {
          this.setTableHead(memberId)
          return
        }
        if (actionName === '取消局头') {
          this.clearTableHead()
          return
        }
        if (actionName === '封禁用户') {
          this.banMember(userId, name)
          return
        }
        if (actionName === '解除封禁') {
          this.unbanMember(userId, name)
          return
        }
        if (actionName === '移除成员') {
          this.kickMember({ currentTarget: { dataset: { memberId, name } } })
        }
      }
    })
  },

  onMemberActionClose() {
    this.setData({
      memberActionSheetShow: false,
      activeMemberAction: null
    })
  },

  onMemberActionSelect(event) {
    const action = event.detail
    const active = this.data.activeMemberAction
    if (!action || !active) {
      this.onMemberActionClose()
      return
    }
    this.onMemberActionClose()
    if (action.key === 'seat') {
      this.markSeat({ currentTarget: { dataset: { memberId: active.memberId } } })
      return
    }
    if (action.key === 'kick') {
      this.kickMember({ currentTarget: { dataset: { memberId: active.memberId, name: active.name } } })
    }
  },

  async markSeat(event) {
    const { memberId } = event.currentTarget.dataset
    if (!memberId) {
      return
    }
    return this.runLockedAction(`seat_${memberId}`, async () => {
      try {
        const result = await api.setMemberSeat(memberId, 'seated', this.data.adminKey)
        if (this.pageUnloaded) {
          return
        }
        if (result.table) {
          this.replaceTable(result.table)
        } else {
          this.updateMemberStatus(memberId, 'seated')
        }
        this.setTransientCopy(`seat_${memberId}`)
      } catch (error) {
        this.showToastIfAlive({ title: '设置失败', icon: 'none' })
      }
    })
  },

  async setTableHead(memberId) {
    const table = this.data.selectedTable
    if (!table || !memberId) {
      return
    }
    return this.runLockedAction(`head_${table.id}_${memberId}`, async () => {
      try {
        await api.setTableHead(table.id, memberId, this.data.adminKey)
        if (this.pageUnloaded) {
          return
        }
        this.updateTableHead(table.id, memberId)
        this.showToastIfAlive({ title: '已设为局头', icon: 'success' })
      } catch (error) {
        this.showToastIfAlive({ title: '设置局头失败', icon: 'none' })
      }
    })
  },

  async clearTableHead() {
    const table = this.data.selectedTable
    if (!table) {
      return
    }
    return this.runLockedAction(`head_clear_${table.id}`, async () => {
      try {
        await api.setTableHead(table.id, '', this.data.adminKey)
        if (this.pageUnloaded) {
          return
        }
        this.updateTableHead(table.id, '')
        this.showToastIfAlive({ title: '已取消局头', icon: 'success' })
      } catch (error) {
        this.showToastIfAlive({ title: '取消失败', icon: 'none' })
      }
    })
  },

  async kickMember(event) {
    const { memberId, name } = event.currentTarget.dataset
    if (!memberId) {
      return
    }
    wx.showModal({
      title: `踢走 ${name}`,
      content: '适用于入局但不来的用户，移除后会释放占位和列表空间。',
      confirmText: '踢走',
      confirmColor: '#d93025',
      success: async (res) => {
        if (!res.confirm) {
          return
        }
        this.runLockedAction(`kick_${memberId}`, async () => {
          try {
            await api.kickMember(memberId, this.data.adminKey)
            if (this.pageUnloaded) {
              return
            }
            this.removeMember(memberId)
            this.showToastIfAlive({ title: '已移除', icon: 'success' })
          } catch (error) {
            this.showToastIfAlive({ title: '移除失败', icon: 'none' })
          }
        })
      }
    })
  },

  setReportFilter(event) {
    const dataset = event.currentTarget.dataset || {}
    const filter = dataset.filter || 'pending'
    this.setData({ reportFilter: filter })
    this.loadReports(filter)
  },

  async loadReports(status = this.data.reportFilter, options = {}) {
    if (!this.data.partyId || this.pageUnloaded) {
      return
    }
    if (this.reportsLoading) {
      return
    }
    this.reportsLoading = true
    if (!options.silent) {
      this.setData({ reportLoading: true })
    }
    try {
      const reports = await api.getAdminReports(this.data.partyId, status, this.data.adminId, this.data.adminKey)
      if (this.pageUnloaded) {
        return
      }
      this.setData({ reports })
    } catch (error) {
      if (!this.pageUnloaded) {
        console.warn('举报列表加载失败', error)
      }
    } finally {
      this.reportsLoading = false
      if (!this.pageUnloaded) {
        this.setData({ reportLoading: false })
      }
    }
  },

  async deleteReportMessage(event) {
    const { messageId } = event.currentTarget.dataset
    if (!messageId) {
      return
    }
    return this.runLockedAction(`delete_message_${messageId}`, async () => {
      try {
        await api.deleteMessage(messageId, '违规内容', this.data.adminId, this.data.adminKey)
        if (this.pageUnloaded) {
          return
        }
        this.showToastIfAlive({ title: '消息已删除', icon: 'success' })
        this.loadDashboard()
      } catch (error) {
        this.showToastIfAlive({ title: error.message || '删除失败', icon: 'none' })
      }
    })
  },

  async resolveReport(event) {
    const { reportId, status } = event.currentTarget.dataset
    if (!reportId || !status) {
      return
    }
    return this.runLockedAction(`report_${reportId}_${status}`, async () => {
      try {
        await api.resolveReport(reportId, status, this.data.adminId, this.data.adminKey)
        if (this.pageUnloaded) {
          return
        }
        this.showToastIfAlive({ title: status === 'resolved' ? '已处理' : '已驳回', icon: 'success' })
        this.loadReports()
      } catch (error) {
        this.showToastIfAlive({ title: error.message || '处理失败', icon: 'none' })
      }
    })
  },

  async banReportUser(event) {
    const { userId, name } = event.currentTarget.dataset
    this.banMember(userId, name)
  },

  async unbanReportUser(event) {
    const { userId, name } = event.currentTarget.dataset
    this.unbanMember(userId, name)
  },

  kickReportMember(event) {
    const { memberId, name } = event.currentTarget.dataset
    this.kickMember({ currentTarget: { dataset: { memberId, name } } })
  },

  banMember(userId, name = '') {
    if (!userId) {
      return
    }
    wx.showModal({
      title: `封禁 ${name || '用户'}`,
      content: '封禁后该账号不能重新入局或继续发消息。',
      confirmText: '封禁',
      confirmColor: '#d93025',
      success: async (res) => {
        if (!res.confirm) {
          return
        }
        this.runLockedAction(`ban_${userId}`, async () => {
          try {
            await api.banUser(userId, '违规使用', this.data.partyId, this.data.adminId, this.data.adminKey)
            if (this.pageUnloaded) {
              return
            }
            this.updateMemberBanState(userId, true, '违规使用')
            this.showToastIfAlive({ title: '已封禁', icon: 'success' })
            this.loadReports()
          } catch (error) {
            this.showToastIfAlive({ title: error.message || '封禁失败', icon: 'none' })
          }
        })
      }
    })
  },

  async unbanMember(userId, name = '') {
    if (!userId) {
      return
    }
    return this.runLockedAction(`unban_${userId}`, async () => {
      try {
        await api.unbanUser(userId, this.data.partyId, this.data.adminId, this.data.adminKey)
        if (this.pageUnloaded) {
          return
        }
        this.updateMemberBanState(userId, false, '')
        this.showToastIfAlive({ title: name ? `已解除 ${name}` : '已解除封禁', icon: 'success' })
        this.loadReports()
      } catch (error) {
        this.showToastIfAlive({ title: error.message || '解除失败', icon: 'none' })
      }
    })
  },

  showJoinInfo() {
    const table = this.data.selectedTable
    if (!table) {
      return
    }
    return this.runLockedAction(`invite_${table.id}`, () => {
      this.setData({
        invitePanelVisible: true,
        inviteLoading: true,
        inviteInfo: {
          tableNo: table.tableNo,
          scene: table.joinCode,
          link: '',
          qrcodePath: '',
          error: ''
        }
      })
      // Fetch invite info and QR code in parallel to avoid sequential delays.
      return Promise.all([
        api.getTableInvite(table.id, this.data.adminId, this.data.adminKey),
        api.downloadTableQrcode(table.id, this.data.adminId, this.data.adminKey).catch((error) => {
          console.warn('小程序码下载失败', error)
          return ''
        })
      ]).then(([invite, qrcodePath]) => {
        const link = invite.urlLink || ''
        if (this.pageUnloaded) {
          return
        }
        this.setData({
          inviteInfo: {
            tableNo: table.tableNo,
            scene: invite.scene,
            link,
            qrcodePath,
            error: qrcodePath || link ? '' : '小程序码和链接暂未生成，请检查微信密钥和发布状态'
          }
        })
      }).catch((error) => {
        if (this.pageUnloaded) {
          return
        }
        this.setData({
          inviteInfo: {
            tableNo: table.tableNo,
            scene: table.joinCode,
            link: '',
            qrcodePath: '',
            error: error && error.message === '管理员密钥无效'
              ? '管理员未授权，请带 adminKey 进入后再分享'
              : '入局信息加载失败，请稍后重试'
          }
        })
      }).finally(() => {
        if (!this.pageUnloaded) {
          this.setData({ inviteLoading: false })
        }
      })
    })
  },

  closeInvitePanel() {
    this.lightFeedback()
    this.setData({ invitePanelVisible: false })
  },

  copyInviteLink() {
    const info = this.data.inviteInfo || {}
    if (!info.link) {
      this.showToastIfAlive({ title: '暂无可复制链接', icon: 'none' })
      return
    }
    this.copyText(info.link, '入局链接已复制')
  },

  saveInviteQrcode() {
    const info = this.data.inviteInfo || {}
    if (!info.qrcodePath) {
      this.showToastIfAlive({ title: '暂无小程序码', icon: 'none' })
      return
    }
    if (!wx.saveImageToPhotosAlbum) {
      this.showToastIfAlive({ title: '当前环境不支持保存', icon: 'none' })
      return
    }
    wx.saveImageToPhotosAlbum({
      filePath: info.qrcodePath,
      success: () => {
        this.lightFeedback()
        this.showToastIfAlive({ title: '小程序码已保存', icon: 'success' })
      },
      fail: () => this.showToastIfAlive({ title: '保存失败，请检查相册权限', icon: 'none' })
    })
  },

  previewInviteQrcode() {
    const info = this.data.inviteInfo || {}
    if (!info.qrcodePath || !wx.previewImage) {
      return
    }
    this.lightFeedback()
    wx.previewImage({
      urls: [info.qrcodePath],
      current: info.qrcodePath
    })
  },

  noop() {
  },

  refreshData() {
    if (this.data.refreshing) {
      return
    }
    this.lightFeedback()
    this.setData({ refreshing: true })
    Promise.resolve(this.loadDashboard()).finally(() => {
      if (this.pageUnloaded) {
        return
      }
      clearTimeout(this.refreshResetTimer)
      this.refreshResetTimer = setTimeout(() => {
        if (this.pageUnloaded) {
          return
        }
        this.setData({ refreshing: false })
        this.refreshResetTimer = null
      }, 420)
    })
  },

  updateSelected(id) {
    const selectedTable = this.data.tables.find((table) => table.id === id)
    const decorated = selectedTable ? decorateTableAvatars(selectedTable) : null
    this.setData({
      selectedId: id,
      selectedTable: decorated,
      editForm: this.buildEditForm(decorated)
    })
    // Pre-fetch the QR code in the background so showJoinInfo is instant.
    if (decorated && decorated.status !== 'ended') {
      api.downloadTableQrcode(decorated.id, this.data.adminId, this.data.adminKey).catch(() => {})
    }
  },

  recalculate(tables) {
    const sourceTables = (tables || this.data.tables).map(decorateTableAvatars)
    const visibleTables = this.filterTables(sourceTables, this.data.filter)
    const endedTableMap = new Map()
    sourceTables.forEach((table) => {
      if (table.status !== 'ended') {
        return
      }
      const partyId = table.partyId || this.data.partyId
      if (!endedTableMap.has(partyId)) {
        endedTableMap.set(partyId, {
          ...table,
          partyId
        })
      }
    })
    const endedTables = Array.from(endedTableMap.values())
    const endedPartyIds = new Set(endedTables.map((table) => table.partyId))
    const selectedEndedPartyIds = this.data.selectedEndedPartyIds.filter((partyId) => endedPartyIds.has(partyId))
    const selectedSet = new Set(selectedEndedPartyIds)
    const decoratedEndedTables = endedTables.map((table) => ({
      ...table,
      deleteSelected: selectedSet.has(table.partyId)
    }))
    const stats = sourceTables.reduce((memo, table) => {
      if (table.status === 'ended') {
        return memo
      }
      memo.onlineMembers += table.members.filter((member) => member.online).length
      memo.photoCount += table.photoCount
      if ((table.ghostCount || 0) > 0) {
        memo.attentionCount += 1
      }
      return memo
    }, { onlineMembers: 0, photoCount: 0, attentionCount: 0 })

    this.setData({
      visibleTables,
      endedTables: decoratedEndedTables,
      selectedEndedPartyIds,
      stats
    })
  },

  updateMemberStatus(memberId, seatStatus) {
    const seatStatusText = seatStatus === 'seated' ? '已占位' : '未占位'
    const tables = this.data.tables.map((table) => {
      if (table.status === 'ended') {
        return table
      }
      const members = table.members.map((member) => {
        if (member.memberId === memberId) {
          return { ...member, seatStatus, seatStatusText }
        }
        return member
      })
      const memberCount = members.filter((member) => member.seatStatus === 'seated').length
      const ghostCount = members.length - memberCount
      return {
        ...table,
        members,
        memberCount,
        ghostCount,
        openSeats: Math.max(table.capacity - memberCount, 0),
        status: memberCount >= table.capacity ? 'full' : 'available',
        statusText: memberCount >= table.capacity ? '人数已满' : '人数未满'
      }
    })
    this.setData({ tables })
    this.updateSelected(this.data.selectedId)
    this.recalculate(tables)
  },

  replaceTable(nextTable) {
    const tables = this.data.tables.map((table) => table.id === nextTable.id ? nextTable : table)
    this.setData({ tables })
    this.updateSelected(this.data.selectedId)
    this.recalculate(tables)
  },

  updateTableHead(tableId, memberId) {
    const tables = this.data.tables.map((table) => {
      if (table.id !== tableId) {
        return table
      }
      const headMember = table.members.find((member) => member.memberId === memberId)
      const members = table.members.map((member) => ({
        ...member,
        role: member.memberId === memberId ? '局头' : '成员'
      }))
      return {
        ...table,
        headMemberId: memberId || '',
        head: headMember ? headMember.name : '未指定',
        members
      }
    })
    this.setData({ tables })
    this.updateSelected(this.data.selectedId)
    this.recalculate(tables)
  },

  removeMember(memberId) {
    const tables = this.data.tables.map((table) => {
      if (table.status === 'ended') {
        return table
      }
      const members = table.members.filter((member) => member.memberId !== memberId)
      const removingHead = table.headMemberId === memberId
      const memberCount = members.filter((member) => member.seatStatus === 'seated').length
      const ghostCount = members.length - memberCount
      return {
        ...table,
        members,
        headMemberId: removingHead ? '' : table.headMemberId,
        head: removingHead ? '未指定' : table.head,
        memberCount,
        totalMemberCount: members.length,
        ghostCount,
        openSeats: Math.max(table.capacity - memberCount, 0),
        status: memberCount >= table.capacity ? 'full' : 'available',
        statusText: memberCount >= table.capacity ? '人数已满' : '人数未满'
      }
    })
    this.setData({ tables })
    this.updateSelected(this.data.selectedId)
    this.recalculate(tables)
  },

  updateMemberBanState(userId, banned, reason = '') {
    const tables = this.data.tables.map((table) => ({
      ...table,
      members: table.members.map((member) => {
        if (member.id !== userId) {
          return member
        }
        return {
          ...member,
          banned,
          bannedAt: banned ? (member.bannedAt || new Date().toISOString()) : '',
          banReason: banned ? reason : ''
        }
      })
    }))
    this.setData({ tables })
    this.updateSelected(this.data.selectedId)
    this.recalculate(tables)
  },

  getVisibleTables(filter) {
    return this.filterTables(this.data.tables, filter)
  },

  filterTables(tables, filter) {
    if (filter === 'all') {
      return tables.filter((table) => table.status !== 'ended')
    }
    if (filter === 'attention') {
      return tables.filter((table) => (table.ghostCount || 0) > 0)
    }
    if (filter === 'ended') {
      return tables.filter((table) => table.status === 'ended')
    }
    return tables.filter((table) => table.status === filter)
  },

  copyText(text, title, transientValue = text) {
    if (!text) {
      this.showToastIfAlive({ title: '暂无可复制内容', icon: 'none' })
      return Promise.resolve(false)
    }
    return this.runLockedAction(`copy_${transientValue || title}`, () => new Promise((resolve) => {
      wx.setClipboardData({
        data: text,
        success: () => {
          if (this.pageUnloaded) {
            return
          }
          this.lightFeedback()
          this.setTransientCopy(transientValue)
          console.info(title)
        },
        fail: () => {
          this.showToastIfAlive({ title: '复制失败', icon: 'none' })
        },
        complete: resolve
      })
    }))
  },

  setTransientCopy(value) {
    if (this.pageUnloaded) {
      return
    }
    this.setData({ copiedText: value })
    clearTimeout(this.copyTimer)
    this.copyTimer = setTimeout(() => {
      if (this.pageUnloaded) {
        return
      }
      this.setData({ copiedText: '' })
      this.copyTimer = null
    }, 1600)
  }
})
