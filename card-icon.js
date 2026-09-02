const normalizeHttpUrl = (raw) => {
  const value = String(raw || '').trim()
  if (!value) return ''
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

export const getCardInitial = (title) => {
  const value = String(title || '').trim()
  if (!value) return '?'
  const [firstCharacter] = Array.from(value)
  return /^[a-z]$/i.test(firstCharacter) ? firstCharacter.toUpperCase() : firstCharacter
}

const createChromeFaviconUrl = (pageUrl, runtimeGetURL) => {
  if (typeof runtimeGetURL !== 'function') return ''
  try {
    const url = new URL(runtimeGetURL('/_favicon/'))
    url.searchParams.set('pageUrl', pageUrl)
    url.searchParams.set('size', '128')
    return url.toString()
  } catch {
    return ''
  }
}

/**
 * 图标按可靠性顺序尝试。Google S2 会为不存在的图标返回默认地球图，
 * 无法触发错误降级，因此不再作为候选。
 */
export const createCardIconCandidates = ({ pageUrl, customIcon, runtimeGetURL }) => {
  const normalizedPageUrl = normalizeHttpUrl(pageUrl)
  const normalizedCustomIcon = normalizeHttpUrl(customIcon)
  if (!normalizedPageUrl) return normalizedCustomIcon ? [normalizedCustomIcon] : []

  const url = new URL(normalizedPageUrl)
  const candidates = [
    normalizedCustomIcon,
    `${url.origin}/apple-touch-icon.png`,
    `https://favicon.im/${encodeURIComponent(url.hostname)}?larger=true`,
    createChromeFaviconUrl(normalizedPageUrl, runtimeGetURL),
    `${url.origin}/favicon.ico`
  ]
  return [...new Set(candidates.filter(Boolean))]
}

/**
 * 逐个加载候选图标。全部失败时不设置完成态，让底层首字母自然显示。
 */
export const loadCardIcon = (image, urls, { timeoutMs = 5000, minimumSize = 16, onLoaded, onFallback } = {}) => {
  const candidates = (urls || []).filter(Boolean)
  let index = 0
  let finished = false
  let timer = null

  const cleanupAttempt = () => {
    if (timer) clearTimeout(timer)
    timer = null
    image.onload = null
    image.onerror = null
  }

  const finishWithFallback = () => {
    if (finished) return
    finished = true
    cleanupAttempt()
    image.removeAttribute?.('src')
    onFallback?.()
  }

  const tryNext = () => {
    if (finished) return
    cleanupAttempt()
    if (index >= candidates.length) {
      finishWithFallback()
      return
    }

    const source = candidates[index++]
    image.onload = () => {
      if (image.naturalWidth < minimumSize || image.naturalHeight < minimumSize) {
        tryNext()
        return
      }
      finished = true
      cleanupAttempt()
      onLoaded?.(source, {
        width: image.naturalWidth,
        height: image.naturalHeight
      })
    }
    image.onerror = tryNext
    timer = setTimeout(tryNext, timeoutMs)
    image.src = source
  }

  tryNext()
  return () => {
    finished = true
    cleanupAttempt()
  }
}
