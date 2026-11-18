const LOCATION_TIMEOUT_MS = 3000

type Dict = Record<string, unknown>

/** The signals grouped the way the API expects. Signals a browser cannot provide are left out. */
export interface SignalBundle {
  device?: Dict
  integrity?: Dict
  network?: Dict
  location?: Dict
  scam_signals?: Dict
}

interface UaData {
  platform?: string
  mobile?: boolean
  brands?: { brand: string; version: string }[]
  getHighEntropyValues?(hints: string[]): Promise<Dict>
}

/** Drops undefined, null and empty values so a signal the browser does not give is really left out. */
const compact = (input: Dict): Dict | undefined => {
  const out: Dict = {}
  Object.keys(input).forEach((k) => {
    const v = input[k]
    if (v === undefined || v === null || v === '') return
    if (typeof v === 'number' && !isFinite(v)) return
    out[k] = v
  })
  return Object.keys(out).length ? out : undefined
}

const safe = <T>(fn: () => T): T | undefined => {
  try {
    return fn()
  } catch {
    return undefined
  }
}

const normalisePlatform = (value: string): string => {
  const v = value.toLowerCase()
  if (v === 'macos' || v === 'mac os x') return 'macos'
  if (v === 'chrome os' || v === 'chromeos') return 'chromeos'
  if (v === 'google chrome') return 'chrome'
  return v
}

export const parseOs = (
  ua: string,
  uaPlatform?: string
): { name?: string; version?: string } => {
  let m: RegExpMatchArray | null
  if ((m = ua.match(/Windows NT (\d+[._]?\d*)/)))
    return { name: 'windows', version: m[1] }
  if (
    (m = ua.match(/(?:iPhone|CPU) OS (\d+[._]\d+(?:[._]\d+)?)/)) ||
    /iPhone|iPad|iPod/.test(ua)
  ) {
    return {
      name: 'ios',
      version: m && m[1] ? m[1].replace(/_/g, '.') : undefined
    }
  }
  if ((m = ua.match(/Android (\d+(?:\.\d+)*)/)))
    return { name: 'android', version: m[1] }
  if (/Android/.test(ua)) return { name: 'android' }
  if ((m = ua.match(/Mac OS X (\d+[._]\d+(?:[._]\d+)?)/))) {
    return { name: 'macos', version: m[1].replace(/_/g, '.') }
  }
  if (/CrOS/.test(ua)) return { name: 'chromeos' }
  if (/Linux/.test(ua)) return { name: 'linux' }
  if (uaPlatform) return { name: uaPlatform.toLowerCase() }
  return {}
}

export const parseBrowser = (
  ua: string
): { name?: string; version?: string } => {
  const checks: Array<[string, RegExp]> = [
    ['edge', /Edg(?:e|A|iOS)?\/(\d+(?:\.\d+)*)/],
    ['opera', /(?:OPR|Opera)\/(\d+(?:\.\d+)*)/],
    ['firefox', /(?:Firefox|FxiOS)\/(\d+(?:\.\d+)*)/],
    ['chrome', /(?:Chrome|CriOS)\/(\d+(?:\.\d+)*)/],
    ['safari', /Version\/(\d+(?:\.\d+)*).*Safari/]
  ]
  for (const [name, re] of checks) {
    const m = ua.match(re)
    if (m) return { name, version: m[1] }
  }
  return {}
}

export const deviceType = (
  ua: string,
  os: string | undefined,
  touch: number
): 'phone' | 'tablet' | 'desktop' => {
  const iPadOs = os === 'macos' && touch > 1 // iPadOS says it is a Mac
  if (/iPhone|iPod|Android.*Mobile|Mobile.*Firefox|Windows Phone/.test(ua))
    return 'phone'
  if (/iPad|Tablet|Android/.test(ua) || iPadOs) return 'tablet'
  if (os === 'android' || os === 'ios') {
    return Math.min(screen.width, screen.height) < 600 ? 'phone' : 'tablet'
  }
  return 'desktop'
}

const collectDevice = async (): Promise<Dict | undefined> => {
  const nav = navigator as Navigator & {
    userAgentData?: UaData
    deviceMemory?: number
  }
  const ua = nav.userAgent || ''
  const uaData = nav.userAgentData

  let high: Dict = {}
  if (uaData && uaData.getHighEntropyValues) {
    try {
      high = await uaData.getHighEntropyValues([
        'model',
        'platformVersion',
        'fullVersionList'
      ])
    } catch {
      // best effort
    }
  }

  const parsedOs = parseOs(ua, uaData && uaData.platform)
  const osName =
    uaData && uaData.platform
      ? normalisePlatform(uaData.platform)
      : parsedOs.name
  const osVersion =
    typeof high.platformVersion === 'string' && high.platformVersion
      ? high.platformVersion
      : parsedOs.version

  const parsedBrowser = parseBrowser(ua)
  const brands =
    (high.fullVersionList as
      | { brand: string; version: string }[]
      | undefined) || []
  const brand = brands.filter(
    (b) => !/not.?a.?brand|chromium/i.test(b.brand)
  )[0]
  const browserName = brand
    ? normalisePlatform(brand.brand.replace(/^Microsoft /, ''))
    : parsedBrowser.name
  const browserVersion = brand ? brand.version : parsedBrowser.version

  return compact({
    type: deviceType(ua, osName, nav.maxTouchPoints || 0),
    os_name: osName,
    os_version: osVersion,
    browser_name: browserName,
    browser_version: browserVersion,
    model: typeof high.model === 'string' ? high.model : undefined,
    // manufacturer: browsers do not tell it, so it is left out.
    locale: (nav.languages && nav.languages[0]) || nav.language,
    timezone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    screen: compact({
      width: screen.width,
      height: screen.height,
      pixel_ratio: window.devicePixelRatio,
      color_depth: screen.colorDepth
    }),
    hardware_concurrency: nav.hardwareConcurrency,
    device_memory: nav.deviceMemory
  })
}

const collectIntegrity = (): Dict => {
  const nav = navigator as Navigator & { webdriver?: boolean }
  const headless = /HeadlessChrome|PhantomJS/i.test(nav.userAgent || '')
  return { is_automated: nav.webdriver === true || headless }
}

const collectNetwork = (): Dict | undefined => {
  const conn = (
    navigator as Navigator & {
      connection?: { type?: string; effectiveType?: string }
    }
  ).connection
  if (!conn) return undefined
  return compact({ type: conn.type || conn.effectiveType })
}

/** Only when the location permission is already granted. Never asks the person. */
const collectLocation = async (): Promise<Dict | undefined> => {
  try {
    if (
      !navigator.permissions ||
      !navigator.permissions.query ||
      !navigator.geolocation
    ) {
      return undefined
    }
    const status = await navigator.permissions.query({
      name: 'geolocation' as PermissionName
    })
    if (status.state !== 'granted') return undefined
    return await new Promise<Dict | undefined>((resolve) => {
      const timer = setTimeout(() => resolve(undefined), LOCATION_TIMEOUT_MS)
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer)
          resolve(
            compact({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy_m: pos.coords.accuracy
            })
          )
        },
        () => {
          clearTimeout(timer)
          resolve(undefined)
        },
        {
          timeout: LOCATION_TIMEOUT_MS,
          maximumAge: 60000,
          enableHighAccuracy: false
        }
      )
    })
  } catch {
    return undefined
  }
}

/**
 * Collect the web signals. Anything a browser cannot tell is left out, never guessed. Throws when
 * there is no browser (server rendering); the TM client turns that into `native_error`.
 */
export const collectWebSignals = async (
  includeLocation: boolean
): Promise<SignalBundle> => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    throw new Error('Web signals are only available in a browser.')
  }
  const bundle: SignalBundle = {}
  const device = await collectDevice()
  if (device) bundle.device = device
  bundle.integrity = collectIntegrity()
  const network = collectNetwork()
  if (network) bundle.network = network
  if (includeLocation) {
    const location = await collectLocation()
    if (location) bundle.location = location
  }
  return bundle
}
