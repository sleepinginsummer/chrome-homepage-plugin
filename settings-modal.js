/**
 * @fileoverview
 * 设置面板：外观 / 同步 / 语言 / 关于四个分页的交互与同步表单。
 *
 * 设计目标：
 * - 面板只做表单与状态提示，配置读写、卡片与搜索的重渲染都由页面注入。
 * - 主题面板自身仍由 theme-controller 负责，这里只转发打开/拉取后的刷新。
 *
 * 注意：
 * - 面板里正在编辑的表单值不写进配置，只有点击保存/推送/拉取才落盘（与迁移前一致）。
 * - 拉取成功后会整体替换配置，因此需要页面回调把卡片、搜索、语言、主题一起刷新。
 */

import { DEFAULT_SYNC_PATH, normalizeSyncDraft, tryParseGitRemote } from './remote-sync.js'
import { getDict } from './i18n.js'

const TAB_TITLE_KEY = {
  appearance: 'settings_appearance',
  sync: 'settings_sync',
  language: 'settings_language',
  about: 'settings_about'
}

const SYNC_ACTION_IDS = ['syncSaveBtn', 'syncPushBtn', 'syncPullBtn', 'syncTestBtn']

const getDocument = () => (typeof document === 'undefined' ? null : document)

/**
 * 创建设置面板控制器。
 *
 * @param {object} options
 * @param {function(): object} options.getConfig 读取当前配置。
 * @param {function(object): void} options.applyConfig 写入配置（本地状态）。
 * @param {function(object): Promise<void>} options.saveConfig 持久化配置补丁。
 * @param {function(object): Promise<object>} options.send 扩展内部消息发送。
 * @param {function(string, string=): void} [options.setStatus] 面板状态提示（复用页面的 #syncStatus）。
 * @param {function(string=): Promise<void>} [options.renderLastSyncAt] 刷新「最近同步时间」。
 * @param {function(): void} [options.applyLanguage] 语言切换后重新渲染页面文案。
 * @param {object} options.theme 主题控制器转发：syncRadios/setStatus/applyCurrent。
 * @param {function(object): void} [options.onRemoteConfigApplied] 远端配置落地后的页面级刷新。
 * @param {function(): void} [options.onSyncFormChanged] 同步表单变更后的收尾（自动推送调度）。
 * @param {function(): string} options.getLang 当前语言。
 * @param {object} [options.root=document] DOM 根节点。
 * @returns {{ init: function(): void }}
 */
export const createSettingsModal = ({
  getConfig,
  applyConfig,
  saveConfig,
  send,
  setStatus,
  renderLastSyncAt,
  applyLanguage,
  theme,
  onRemoteConfigApplied,
  onSyncFormChanged,
  getLang,
  root = getDocument()
}) => {
  const $ = (selector) => root?.querySelector?.(selector) || null

  const getFormSync = () => ({
    ...(() => {
      const gitUrl = $('#syncGitUrl')?.value.trim() || ''
      const parsed = tryParseGitRemote(gitUrl)
      return {
        gitUrl,
        ...(parsed?.provider === 'gitee_gist' ? { provider: parsed.provider, gistId: parsed.gistId } : {})
      }
    })(),
    token: $('#syncToken')?.value.trim() || '',
    autoPush: Boolean($('#syncAutoPush')?.checked),
    path: DEFAULT_SYNC_PATH
  })

  const setFormSync = (sync) => {
    const normalized = normalizeSyncDraft(sync)
    const gitUrlInput = $('#syncGitUrl')
    const tokenInput = $('#syncToken')
    if (gitUrlInput) gitUrlInput.value = normalized.gitUrl || ''
    if (tokenInput) tokenInput.value = normalized.token || ''

    const autoPush = $('#syncAutoPush')
    if (autoPush) autoPush.checked = Boolean(normalized.autoPush)
    const autoPushLabel = autoPush?.closest('.engine-checkbox')
    if (autoPushLabel) autoPushLabel.classList.toggle('active', Boolean(autoPush?.checked))
  }

  const disableSyncActions = (disabled) => {
    for (const id of SYNC_ACTION_IDS) {
      const btn = $(`#${id}`)
      if (btn) btn.disabled = disabled
    }
  }

  const selectTab = (tab) => {
    for (const btn of root?.querySelectorAll?.('.settings-item') || []) {
      const active = btn.dataset.tab === tab
      btn.classList.toggle('active', active)
      btn.setAttribute('aria-selected', String(active))
      btn.tabIndex = active ? 0 : -1
    }
    const panels = {
      appearance: $('#settingsPanelAppearance'),
      sync: $('#settingsPanelSync'),
      language: $('#settingsPanelLanguage'),
      about: $('#settingsPanelAbout')
    }
    for (const [key, panel] of Object.entries(panels)) {
      if (panel) panel.hidden = key !== tab
    }
    const dict = getDict(getLang())
    const title = $('#settingsTitle')
    if (title) title.textContent = dict[TAB_TITLE_KEY[tab]] || dict.settings_appearance
  }

  const open = () => {
    const overlay = $('#settingsOverlay')
    if (overlay) overlay.hidden = false
    setStatus?.('')
    setFormSync(getConfig()?.sync || {})
    renderLastSyncAt?.()
    const lang = $('#languageSelect')
    if (lang) lang.value = getLang()
    theme?.syncRadios?.()
    theme?.setStatus?.('')
    selectTab('appearance')
    requestAnimationFrame(() => $('#settingsTabAppearance')?.focus())
  }

  const close = () => {
    const overlay = $('#settingsOverlay')
    const wasOpen = overlay ? !overlay.hidden : false
    if (overlay) overlay.hidden = true
    setStatus?.('')
    if (wasOpen) requestAnimationFrame(() => $('#openSettingsBtn')?.focus())
  }

  /**
   * 同步表单动作的统一壳：禁用按钮 → 提示 → 执行 → 恢复按钮。
   */
  const runSyncAction = async ({ pendingText, run, failureText, onSuccess }) => {
    disableSyncActions(true)
    setStatus?.(pendingText)
    try {
      const result = await run()
      if (!result?.ok) {
        setStatus?.(result?.error || failureText, 'error')
        return
      }
      await onSuccess?.(result)
    } finally {
      disableSyncActions(false)
    }
  }

  const init = () => {
    const overlay = $('#settingsOverlay')
    const openBtn = $('#openSettingsBtn')
    const closeBtn = $('#settingsCloseBtn')

    openBtn?.addEventListener('click', open)
    closeBtn?.addEventListener('click', close)
    overlay?.addEventListener('click', (evt) => {
      if (evt.target === overlay) close()
    })
    root?.addEventListener?.('keydown', (evt) => {
      if (evt.key === 'Escape' && overlay && !overlay.hidden) close()
    })

    const tabs = [...(root?.querySelectorAll?.('.settings-item') || [])]
    for (const btn of tabs) {
      btn.addEventListener('click', () => selectTab(btn.dataset.tab))
      btn.addEventListener('keydown', (evt) => {
        if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(evt.key)) return
        const currentIndex = tabs.indexOf(btn)
        const direction = ['ArrowDown', 'ArrowRight'].includes(evt.key) ? 1 : -1
        const nextIndex = evt.key === 'Home'
          ? 0
          : evt.key === 'End'
            ? tabs.length - 1
            : (currentIndex + direction + tabs.length) % tabs.length
        evt.preventDefault()
        selectTab(tabs[nextIndex].dataset.tab)
        tabs[nextIndex].focus()
      })
    }

    const languageSelect = $('#languageSelect')
    languageSelect?.addEventListener('change', async () => {
      const next = languageSelect.value === 'en' ? 'en' : 'zh'
      const config = getConfig() || {}
      config.ui = { ...(config.ui || {}), language: next }
      applyConfig?.(config)
      await saveConfig({ ui: config.ui })
      applyLanguage?.()
      selectTab('language')
    })

    $('#syncSaveBtn')?.addEventListener('click', () =>
      runSyncAction({
        pendingText: '保存中...',
        failureText: '保存失败',
        run: () => send({ type: 'setConfig', data: { sync: getFormSync() } }),
        onSuccess: async (saved) => {
          applyConfig?.(saved.data)
          setStatus?.('已保存', 'ok')
        }
      })
    )

    $('#syncPushBtn')?.addEventListener('click', () =>
      runSyncAction({
        pendingText: '推送中...',
        failureText: '推送失败',
        run: async () => {
          await send({ type: 'setConfig', data: { sync: getFormSync() } })
          return send({ type: 'pushRemote' })
        },
        onSuccess: async (pushed) => {
          setStatus?.('推送成功', 'ok')
          await renderLastSyncAt?.(pushed?.lastSyncAt)
        }
      })
    )

    $('#syncPullBtn')?.addEventListener('click', () =>
      runSyncAction({
        pendingText: '拉取中...',
        failureText: '拉取失败',
        run: async () => {
          await send({ type: 'setConfig', data: { sync: getFormSync() } })
          return send({ type: 'pullRemote' })
        },
        onSuccess: async (pulled) => {
          applyConfig?.(pulled.data)
          onRemoteConfigApplied?.(pulled.data)
          setFormSync(pulled.data?.sync || {})
          setStatus?.('拉取成功，已写入本地配置', 'ok')
          await renderLastSyncAt?.(pulled?.lastSyncAt)
        }
      })
    )

    $('#syncTestBtn')?.addEventListener('click', () =>
      runSyncAction({
        pendingText: '测试中...',
        failureText: '测试失败',
        run: async () => {
          await send({ type: 'setConfig', data: { sync: getFormSync() } })
          return send({ type: 'testRemote' })
        },
        onSuccess: async () => {
          setStatus?.('连接正常', 'ok')
        }
      })
    )

    const syncAutoPushLabel = $('#syncAutoPush')?.closest('.engine-checkbox')
    const syncAutoPushActive = () => {
      if (!syncAutoPushLabel) return
      syncAutoPushLabel.classList.toggle('active', Boolean($('#syncAutoPush')?.checked))
    }
    syncAutoPushActive()
    $('#syncAutoPush')?.addEventListener('change', async () => {
      syncAutoPushActive()
      const saved = await send({ type: 'setConfig', data: { sync: getFormSync() } })
      if (saved?.ok) applyConfig?.(saved.data)
      onSyncFormChanged?.()
    })
  }

  return { init, open, close, selectTab, getFormSync, setFormSync }
}
