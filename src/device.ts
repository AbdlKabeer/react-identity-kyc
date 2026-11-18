export const SDK_VERSION = '1.2.0'

// The same key the Prembly web SDK uses, so a site that has both sees one device.
export const DEVICE_ID_KEY = 'prembly_tm_device_id'
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365 * 2

// Used when storage and cookies are both blocked (private mode, strict settings): the ID then lasts
// as long as the page. A made-up ID that changes every visit would be worse than none.
let memoryId = ''

// Older DOM typings do not know `randomUUID`; browsers that have it are used.
type WebCrypto = Crypto & { randomUUID?: () => string }

const randomId = (): string => {
  const c: WebCrypto | undefined =
    typeof crypto !== 'undefined' ? crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  // No crypto (an old browser): the ID only has to be unlikely to repeat, not secret.
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10).join('')
  ].join('-')
}

const readStorage = (): string | null => {
  try {
    return window.localStorage.getItem(DEVICE_ID_KEY)
  } catch {
    return null
  }
}

const writeStorage = (id: string): boolean => {
  try {
    window.localStorage.setItem(DEVICE_ID_KEY, id)
    return true
  } catch {
    return false
  }
}

const readCookie = (): string | null => {
  try {
    const prefix = `${DEVICE_ID_KEY}=`
    const match = document.cookie
      .split('; ')
      .find((part) => part.indexOf(prefix) === 0)
    return match ? decodeURIComponent(match.slice(prefix.length)) : null
  } catch {
    return null
  }
}

const writeCookie = (id: string): void => {
  try {
    document.cookie = `${DEVICE_ID_KEY}=${encodeURIComponent(
      id
    )}; max-age=${COOKIE_MAX_AGE_S}; path=/; SameSite=Lax`
  } catch {
    // cookies unavailable: the ID lives in memory
  }
}

/**
 * The device ID this library keeps on the merchant's own site: a random UUID, created on first use
 * and kept in localStorage, else a cookie, else memory. Transaction Monitoring sends it, and the
 * workflow widget is given it when it asks, so both see one device. Returns '' outside a browser.
 */
export const getWebDeviceId = (): string => {
  if (typeof window === 'undefined') return ''
  const existing = readStorage() || readCookie() || memoryId
  if (existing) {
    memoryId = existing
    return existing
  }
  const created = randomId()
  memoryId = created
  if (!writeStorage(created)) writeCookie(created)
  return created
}

/** Test hook: forget the in-memory copy. */
export const _resetDeviceIdMemory = (): void => {
  memoryId = ''
}
