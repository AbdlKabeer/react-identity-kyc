export const SDK_VERSION = '1.2.0'

const DEVICE_ID_KEY = 'prembly_web_device_id'

// Used when storage is blocked (private mode, strict settings): the ID then lasts as long as the
// page. A made-up ID that changes every visit would be worse than none, so the page's own is kept.
let memoryId = ''

// Older DOM typings do not know `randomUUID`; browsers that have it are used.
type WebCrypto = Crypto & { randomUUID?: () => string }

const randomId = (): string => {
  const c: WebCrypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  // No crypto (an old browser): the ID only has to be unlikely to repeat, not secret.
  let out = ''
  for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16)
  return out
}

/**
 * The device ID this library keeps on the merchant's own site. It is random, created on first use
 * and stored in the browser. It is handed only to the Prembly widget this library opens. Returns ''
 * when nothing can be created, and the widget then uses its own.
 */
export const getWebDeviceId = (): string => {
  if (typeof window === 'undefined') return ''
  try {
    const stored = window.localStorage.getItem(DEVICE_ID_KEY)
    if (stored) return stored
    const created = memoryId || randomId()
    if (!created) return ''
    window.localStorage.setItem(DEVICE_ID_KEY, created)
    return created
  } catch {
    if (!memoryId) memoryId = randomId()
    return memoryId
  }
}
