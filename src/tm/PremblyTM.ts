import { getWebDeviceId, SDK_VERSION } from '../device'
import { collectWebSignals, SignalBundle } from './collector'

export type { SignalBundle }

const DEFAULT_BASE_URL = 'https://backend.prembly.com'
export const TM_SESSIONS_PATH =
  '/api/v1/fraud/transaction-monitoring/sdk/v1/sessions'
const DEFAULT_TIMEOUT_MS = 5000
// Treat a session as expired a little early, so it is still valid when the backend screens.
const REFRESH_MARGIN_MS = 30000

export interface InitOptions {
  /** The organisation's public key: `live_pk_...` for production or `test_pk_...` for sandbox. */
  publishableKey: string
  /** Override the API base URL (for example for a staging server). */
  baseUrl?: string
  /**
   * Include the device location. Off by default: turn it on only after the person has consented.
   * It is read only when the site already has the browser's location permission; the SDK never
   * asks for it.
   */
  location?: boolean
  /** How long to wait for the session request before failing open. Defaults to 5000. */
  timeoutMs?: number
  /** Log what the SDK does to the console. */
  debug?: boolean
}

export interface DeviceSession {
  /**
   * Send this to your backend with the transaction, and pass it as `device_session_id` when you
   * screen. `null` when a session could not be created (the SDK fails open: screen without it).
   */
  deviceSessionId: string | null
  /** The device ID this site keeps, when it could be read. */
  deviceId: string | null
  /** Whether Prembly had seen this device before. Only set when a session was created. */
  isKnownDevice?: boolean
  /** When the session stops being usable, as an ISO date. Only set when a session was created. */
  expiresAt?: string
  /** Why there is no session, when `deviceSessionId` is `null`. */
  error?: SessionError
}

export type SessionError =
  | 'not_initialised'
  | 'timeout'
  | 'network_error'
  | 'unauthorised'
  | 'rate_limited'
  | 'rejected'
  | 'server_error'
  | 'native_error'

export interface GetDeviceSessionOptions {
  /** Ignore a session still being valid and create a new one. */
  forceRefresh?: boolean
}

interface Config {
  publishableKey: string
  baseUrl: string
  location: boolean
  timeoutMs: number
  debug: boolean
}

interface CachedSession {
  customerId: string | null
  includeLocation: boolean
  session: DeviceSession
  expiresAtMs: number
}

/** What the client needs from the browser. Swapped out in tests. */
export interface TMPlatform {
  getDeviceId(): Promise<string | null>
  collectSignals(includeLocation: boolean): Promise<SignalBundle>
  getAppId(): string
}

const browserPlatform: TMPlatform = {
  getDeviceId: async () => getWebDeviceId() || null,
  collectSignals: collectWebSignals,
  // The site's origin: what an organisation lists in its TM app allow-list for the web.
  getAppId: () =>
    typeof window !== 'undefined' && window.location
      ? window.location.origin
      : 'unknown'
}

/**
 * Transaction Monitoring for the web: the same API as the React Native SDK's `PremblyTM`. Call
 * `init` once, then `getDeviceSession()` before a sensitive action and send `deviceSessionId` to
 * your backend.
 */
export class PremblyTMClient {
  private config: Config | null = null
  private customerId: string | null = null
  private cached: CachedSession | null = null
  private inFlight: Promise<DeviceSession> | null = null
  private readonly platform: TMPlatform

  constructor(platform: TMPlatform = browserPlatform) {
    this.platform = platform
  }

  /**
   * Set up the SDK once, early (for example when the app loads). A bad key throws, because that is
   * a mistake to fix while developing. Nothing after this throws: a session that cannot be created
   * comes back as `deviceSessionId: null`, so a payment is never blocked by the SDK.
   */
  init = (options: InitOptions): void => {
    const key = ((options && options.publishableKey) || '').trim()
    if (!key.startsWith('live_pk_') && !key.startsWith('test_pk_')) {
      throw new Error(
        'PremblyTM.init: publishableKey must be your public key (live_pk_... or test_pk_...). ' +
          'Never put a secret key (live_sk_ / test_sk_) in a web page.'
      )
    }
    this.config = {
      publishableKey: key,
      baseUrl: (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ''),
      location: options.location || false,
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      debug: options.debug || false
    }
    this.cached = null
    this.inFlight = null
  }

  /** Tell the SDK which customer is using the site, or `null` when they sign out. */
  identify = (customerId: string | null): void => {
    const next = customerId && customerId.trim() ? customerId.trim() : null
    if (next !== this.customerId) {
      this.customerId = next
      this.cached = null
    }
  }

  /** Turn location collection on or off, for example when the person changes their consent. */
  setLocationEnabled = (enabled: boolean): void => {
    if (this.config && this.config.location !== enabled) {
      this.config.location = enabled
      this.cached = null
    }
  }

  /** Forget the customer and any cached session (for example on sign-out). */
  reset = (): void => {
    this.customerId = null
    this.cached = null
    this.inFlight = null
  }

  /** The device ID this site keeps, or `null` if it could not be read. */
  getDeviceId = async (): Promise<string | null> => {
    try {
      return await this.platform.getDeviceId()
    } catch (error) {
      this.log('getDeviceId failed', error)
      return null
    }
  }

  /**
   * The signals the SDK would send, without sending anything. For testing and for showing people
   * what is collected. Honours the location setting from `init` / `setLocationEnabled`.
   */
  getSignalsPreview = async (): Promise<SignalBundle | null> => {
    try {
      return await this.platform.collectSignals(
        this.config ? this.config.location : false
      )
    } catch (error) {
      this.log('getSignalsPreview failed', error)
      return null
    }
  }

  /**
   * Collect the device signals and create a session. Call it before a sensitive action (sign-in,
   * payment, adding a beneficiary) and send `deviceSessionId` to your backend. A session is reused
   * until shortly before it expires, so calling this often is cheap. Never throws.
   */
  getDeviceSession = async (
    options: GetDeviceSessionOptions = {}
  ): Promise<DeviceSession> => {
    const config = this.config
    if (!config) return this.failed('not_initialised', null)

    if (!options.forceRefresh && this.cached && this.isCacheValid(config)) {
      return this.cached.session
    }
    // Share one request between callers that ask at the same moment.
    if (this.inFlight) return this.inFlight

    const request = this.createSession(config)
    this.inFlight = request
    const clear = () => {
      if (this.inFlight === request) this.inFlight = null
    }
    request.then(clear, clear)
    return request
  }

  private isCacheValid(config: Config): boolean {
    const cached = this.cached
    return (
      cached !== null &&
      cached.customerId === this.customerId &&
      cached.includeLocation === config.location &&
      cached.expiresAtMs - REFRESH_MARGIN_MS > Date.now()
    )
  }

  private async createSession(config: Config): Promise<DeviceSession> {
    let deviceId: string | null = null
    let body: Record<string, unknown>
    let appId: string
    try {
      deviceId = await this.platform.getDeviceId()
      const signals = await this.platform.collectSignals(config.location)
      appId = this.platform.getAppId()
      body = {
        ...signals,
        device_id: deviceId,
        ...(this.customerId ? { customer_id: this.customerId } : {}),
        consent: { location: config.location },
        collected_at: new Date().toISOString()
      }
    } catch (error) {
      this.log('collecting signals failed', error)
      return this.failed('native_error', deviceId)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      const response = await fetch(`${config.baseUrl}${TM_SESSIONS_PATH}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Publishable-Key': config.publishableKey,
          'X-App-Id': appId,
          'X-SDK-Platform': 'web',
          'X-SDK-Version': SDK_VERSION
        },
        body: JSON.stringify(body)
      })

      if (!response.ok)
        return this.failed(this.errorForStatus(response.status), deviceId)
      const payload = await response.json()
      const data = payload && payload.data
      if (!data || !data.device_session_id)
        return this.failed('server_error', deviceId)

      const session: DeviceSession = {
        deviceSessionId: data.device_session_id,
        deviceId: data.device_id || deviceId,
        isKnownDevice: Boolean(data.is_known_device),
        expiresAt: data.expires_at
      }
      const expiresAtMs = Date.parse(data.expires_at)
      if (!isNaN(expiresAtMs)) {
        this.cached = {
          customerId: this.customerId,
          includeLocation: config.location,
          session,
          expiresAtMs
        }
      }
      return session
    } catch (error) {
      this.log('session request failed', error)
      const aborted =
        !!error && (error as { name?: string }).name === 'AbortError'
      return this.failed(aborted ? 'timeout' : 'network_error', deviceId)
    } finally {
      clearTimeout(timer)
    }
  }

  private errorForStatus(status: number): SessionError {
    if (status === 401 || status === 403) return 'unauthorised'
    if (status === 429) return 'rate_limited'
    if (status >= 400 && status < 500) return 'rejected'
    return 'server_error'
  }

  private failed(error: SessionError, deviceId: string | null): DeviceSession {
    this.log(`no device session: ${error}`)
    return { deviceSessionId: null, deviceId, error }
  }

  private log(message: string, detail?: unknown): void {
    if (this.config && this.config.debug)
      console.log(`[PremblyTM] ${message}`, detail || '')
  }
}

export const PremblyTM = new PremblyTMClient()
