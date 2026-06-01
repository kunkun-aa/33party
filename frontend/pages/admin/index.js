const api = require("../../services/api")

const adminProfile = {
  name: '33Party 客服',
  wechatId: 'party33-admin',
  visibleToUsers: true
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
    adminId: 'admin_mimei',
    adminKey: '',
    partyId: 'party_demo',
    tables: mockTables,
    visibleTables: mockTables,
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
      barName: '33 Party Lounge',
      barAddress: '深圳市南山区后海中心路 33 Party Lounge'
    },
    creatingParty: false,
    reports: [],
    reportFilter: 'pending',
    reportLoading: false,
    reportFilters: [
      { key: 'pending', label: '待处理' },
      { key: 'resolved', label: '已处理' },
      { key: 'rejected', label: '已驳回' }
    ],
    memberActionSheetShow: false,
    memberActionSheetTitle: '',
    memberActionSheetActions: [],
    activeMemberAction: null,
    selectedId: mockTables[0].id,
    selectedTable: mockTables[0],
    filter: 'all',
    copiedText: '',
    refreshing: false,
    topSafeArea: 0
  },

  onLoad(options = {}) {
    const nextData = {}
    if (options.partyId) {
      nextData.partyId = options.partyId
    }
    if (options.adminId) {
      nextData.adminId = options.adminId
    }
    if (options.adminKey) {
      nextData.adminKey = options.adminKey
    }
    if (Object.keys(nextData).length) {
      this.setData(nextData)
    }
    this.prepareAdminSession().finally(() => {
      this.loadDashboard()
    })
    this.updateSelected(this.data.selectedId)
    this.updateSafeArea()
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
            if (loginRes && loginRes.token) {
              this.setData({
                adminKey: `token:${loginRes.token}`,
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
            wx.showToast({ title: '管理员登录失败', icon: 'none' })
          }).finally(resolve)
        },
        fail: resolve
      })
    })
  },

  async loadDashboard() {
    try {
      const dashboard = await api.getAdminDashboard(this.data.partyId, this.data.adminId, this.data.adminKey)
      if (!dashboard) {
        this.recalculate(mockTables)
        return
      }

      this.setData({
        tables: dashboard.tables,
        adminProfile: dashboard.adminProfile,
        currentParty: dashboard.party || null,
        wechatDraft: dashboard.adminProfile.wechatId,
        selectedId: dashboard.tables[0] ? dashboard.tables[0].id : '',
        selectedTable: dashboard.tables[0] || null
      })
      this.recalculate(dashboard.tables)
      this.loadReports()
    } catch (error) {
      this.recalculate(this.data.tables)
      const message = error && error.message === '管理员密钥无效'
        ? '管理员未授权，请带 adminKey 进入'
        : '后端暂不可用，显示本地数据'
      wx.showToast({ title: message, icon: 'none' })
    }
  },

  onWechatDraftInput(event) {
    const value = event.detail && event.detail.value !== undefined ? event.detail.value : event.detail
    this.setData({ wechatDraft: value || '' })
  },

  async saveAdminWechat() {
    const wechatId = this.data.wechatDraft.trim()
    if (!wechatId) {
      wx.showToast({ title: '微信号不能为空', icon: 'none' })
      return
    }
    if (this.data.wechatSaving) {
      return
    }
    this.setData({ wechatSaving: true })
    try {
      const res = await api.updateAdminProfile({
        adminId: this.data.adminId,
        adminKey: this.data.adminKey,
        displayName: this.data.adminProfile.name,
        wechatId
      })
      this.setData({
        adminProfile: res.adminProfile,
        wechatDraft: res.adminProfile.wechatId
      })
      this.setTransientCopy('admin_wechat_saved')
    } catch (error) {
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      this.setData({ wechatSaving: false })
    }
  },

  onCreateFormInput(event) {
    const { field } = event.currentTarget.dataset
    const value = event.detail && event.detail.value !== undefined ? event.detail.value : event.detail
    this.setData({
      [`createForm.${field}`]: value || ''
    })
  },

  async createParty() {
    const form = {
      ...this.data.createForm,
      title: this.data.createForm.title.trim(),
      tableNo: this.data.createForm.tableNo.trim(),
      barName: this.data.createForm.barName.trim(),
      barAddress: this.data.createForm.barAddress.trim(),
      capacity: Number(this.data.createForm.capacity || 0)
    }
    if (!form.title || !form.tableNo || !form.barAddress) {
      wx.showToast({ title: '请补全局名、桌号和地址', icon: 'none' })
      return
    }
    if (!form.capacity || form.capacity < 1 || form.capacity > 99) {
      wx.showToast({ title: '人数需在 1-99 之间', icon: 'none' })
      return
    }
    if (this.data.creatingParty) {
      return
    }
    this.setData({ creatingParty: true })
    try {
      const res = await api.createAdminParty({
        ...form,
        adminId: this.data.adminId,
        adminKey: this.data.adminKey
      })
      const tables = res.tables || []
      this.setData({
        partyId: res.party ? res.party.id : this.data.partyId,
        currentParty: res.party || null,
        tables,
        filter: 'all',
        selectedId: tables[0] ? tables[0].id : '',
        selectedTable: tables[0] || null
      })
      this.recalculate(tables)
      this.setTransientCopy('party_created')
    } catch (error) {
      wx.showToast({ title: '创建失败', icon: 'none' })
    } finally {
      this.setData({ creatingParty: false })
    }
  },

  selectTable(event) {
    const dataset = event.currentTarget.dataset || event.detail && event.detail.currentTarget && event.detail.currentTarget.dataset || event.detail || {}
    const { id } = dataset
    this.updateSelected(id)
  },

  setFilter(event) {
    const dataset = event.currentTarget.dataset || event.detail && event.detail.currentTarget && event.detail.currentTarget.dataset || event.detail || {}
    const filter = dataset.filter || dataset.detail || (typeof event.detail === 'string' ? event.detail : '')
    const visibleTables = this.getVisibleTables(filter)
    this.setData({
      filter,
      visibleTables,
      selectedId: visibleTables[0] ? visibleTables[0].id : '',
      selectedTable: visibleTables[0] || null
    })
  },

  copyJoinCode() {
    this.copyText(this.data.selectedTable.joinCode, '入局码已复制')
  },

  copyJoinLink() {
    const table = this.data.selectedTable
    if (!table) {
      return
    }
    api.getTableInvite(table.id, this.data.adminId, this.data.adminKey).then((invite) => {
      const text = invite.urlLink || `${invite.path}?${invite.query}`
      this.copyText(text, '入局链接已复制')
    }).catch(() => {
      this.copyText(table.joinLink, '入局链接已复制')
    })
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
    try {
      await api.setMemberSeat(memberId, 'seated', this.data.adminKey)
      this.updateMemberStatus(memberId, 'seated')
      this.setTransientCopy(`seat_${memberId}`)
    } catch (error) {
      wx.showToast({ title: '设置失败', icon: 'none' })
    }
  },

  async setTableHead(memberId) {
    const table = this.data.selectedTable
    if (!table || !memberId) {
      return
    }
    try {
      await api.setTableHead(table.id, memberId, this.data.adminKey)
      this.updateTableHead(table.id, memberId)
      wx.showToast({ title: '已设为局头', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: '设置局头失败', icon: 'none' })
    }
  },

  async clearTableHead() {
    const table = this.data.selectedTable
    if (!table) {
      return
    }
    try {
      await api.setTableHead(table.id, '', this.data.adminKey)
      this.updateTableHead(table.id, '')
      wx.showToast({ title: '已取消局头', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: '取消失败', icon: 'none' })
    }
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
        try {
          await api.kickMember(memberId, this.data.adminKey)
          this.removeMember(memberId)
          wx.showToast({ title: '已移除', icon: 'success' })
        } catch (error) {
          wx.showToast({ title: '移除失败', icon: 'none' })
        }
      }
    })
  },

  setReportFilter(event) {
    const dataset = event.currentTarget.dataset || {}
    const filter = dataset.filter || 'pending'
    this.setData({ reportFilter: filter })
    this.loadReports(filter)
  },

  async loadReports(status = this.data.reportFilter) {
    if (!this.data.partyId) {
      return
    }
    this.setData({ reportLoading: true })
    try {
      const reports = await api.getAdminReports(this.data.partyId, status, this.data.adminId, this.data.adminKey)
      this.setData({ reports })
    } catch (error) {
      console.warn('举报列表加载失败', error)
    } finally {
      this.setData({ reportLoading: false })
    }
  },

  async deleteReportMessage(event) {
    const { messageId } = event.currentTarget.dataset
    if (!messageId) {
      return
    }
    try {
      await api.deleteMessage(messageId, '违规内容', this.data.adminId, this.data.adminKey)
      wx.showToast({ title: '消息已删除', icon: 'success' })
      this.loadDashboard()
    } catch (error) {
      wx.showToast({ title: error.message || '删除失败', icon: 'none' })
    }
  },

  async resolveReport(event) {
    const { reportId, status } = event.currentTarget.dataset
    try {
      await api.resolveReport(reportId, status, this.data.adminId, this.data.adminKey)
      wx.showToast({ title: status === 'resolved' ? '已处理' : '已驳回', icon: 'success' })
      this.loadReports()
    } catch (error) {
      wx.showToast({ title: error.message || '处理失败', icon: 'none' })
    }
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
        try {
          await api.banUser(userId, '违规使用', this.data.partyId, this.data.adminId, this.data.adminKey)
          this.updateMemberBanState(userId, true, '违规使用')
          wx.showToast({ title: '已封禁', icon: 'success' })
          this.loadReports()
        } catch (error) {
          wx.showToast({ title: error.message || '封禁失败', icon: 'none' })
        }
      }
    })
  },

  async unbanMember(userId, name = '') {
    if (!userId) {
      return
    }
    try {
      await api.unbanUser(userId, this.data.partyId, this.data.adminId, this.data.adminKey)
      this.updateMemberBanState(userId, false, '')
      wx.showToast({ title: name ? `已解除 ${name}` : '已解除封禁', icon: 'success' })
      this.loadReports()
    } catch (error) {
      wx.showToast({ title: error.message || '解除失败', icon: 'none' })
    }
  },

  showJoinInfo() {
    const table = this.data.selectedTable
    api.getTableInvite(table.id, this.data.adminId, this.data.adminKey).then((invite) => {
      const link = invite.urlLink || `${invite.path}?${invite.query}`
      wx.showModal({
        title: `${table.tableNo} 入局信息`,
        content: `入局码：${invite.scene}\n链接：${link}\n小程序码：${invite.qrcodeUrl || '请配置微信密钥后生成'}`,
        confirmText: '复制链接',
        cancelText: '知道了',
        success: (res) => {
          if (res.confirm) {
            this.copyText(link, '入局链接已复制')
          }
        }
      })
    }).catch(() => {
      wx.showModal({
        title: `${table.tableNo} 入局信息`,
        content: `入局码：${table.joinCode}\n链接：${table.joinLink}`,
        confirmText: '复制链接',
        cancelText: '知道了',
        success: (res) => {
          if (res.confirm) {
            this.copyJoinLink()
          }
        }
      })
    })
  },

  refreshData() {
    if (this.data.refreshing) {
      return
    }
    this.setData({ refreshing: true })
    Promise.resolve(this.loadDashboard()).finally(() => {
      setTimeout(() => {
        this.setData({ refreshing: false })
      }, 420)
    })
  },

  updateSelected(id) {
    const selectedTable = this.data.tables.find((table) => table.id === id)
    this.setData({
      selectedId: id,
      selectedTable: selectedTable || null
    })
  },

  recalculate(tables) {
    const sourceTables = tables || this.data.tables
    const visibleTables = this.filterTables(sourceTables, this.data.filter)
    const stats = sourceTables.reduce((memo, table) => {
      memo.onlineMembers += table.members.filter((member) => member.online).length
      memo.photoCount += table.photoCount
      if ((table.ghostCount || 0) > 0) {
        memo.attentionCount += 1
      }
      return memo
    }, { onlineMembers: 0, photoCount: 0, attentionCount: 0 })

    this.setData({
      visibleTables,
      stats
    })
  },

  updateMemberStatus(memberId, seatStatus) {
    const seatStatusText = seatStatus === 'seated' ? '已占位' : '未占位'
    const tables = this.data.tables.map((table) => {
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
      return tables
    }
    if (filter === 'attention') {
      return tables.filter((table) => (table.ghostCount || 0) > 0)
    }
    return tables.filter((table) => table.status === filter)
  },

  copyText(text, title) {
    wx.setClipboardData({
      data: text,
      success: () => {
        this.setTransientCopy(text)
        console.info(title)
      }
    })
  },

  setTransientCopy(value) {
    this.setData({ copiedText: value })
    clearTimeout(this.copyTimer)
    this.copyTimer = setTimeout(() => {
      this.setData({ copiedText: '' })
    }, 1600)
  }
})
