import { getWebDeviceId, SDK_VERSION } from './device'

export const DEFAULT_BASE_URL = 'https://backend.prembly.com'
export const WORKFLOW_SESSIONS_PATH =
  '/api/v1/compliance-workflow/sdk/v1/sessions/'
// Creating a workflow session can take a while on a cold start.
export const WORKFLOW_TIMEOUT_MS = 15000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Event envelope sources: the current one, and the one older widgets still send.
const EVENT_SOURCE = 'prembly-sdk'
const LEGACY_EVENT_SOURCE = 'prembly-workflow-sdk'

export interface WorkflowCustomer {
  firstName: string
  lastName: string
  email: string
  phone?: string
  reference?: string
}

/**
 * An ID you already have for the person, so they do not have to enter it. Give exactly one.
 *
 * The person skips the ID screen and goes straight to their next step. The ID is sent in the
 * session's `metadata`, so whoever can read what the page sends could change it. When the ID must
 * not be changeable, start the session from your server with a secret key instead.
 */
export interface WorkflowPrefill {
  nin?: string
  bvn?: string
  passport?: string
  driversLicense?: string
  votersCard?: string
}

export type WorkflowErrorCode =
  | 'invalid_key'
  | 'invalid_request'
  | 'unauthorised'
  | 'not_found'
  | 'rate_limited'
  | 'server_error'
  | 'network_error'
  | 'timeout'
  | 'not_available'

export interface WorkflowSessionInfo {
  sessionId: string
  /** The hosted app's link, `<hosted>/?session=<id>`. */
  link: string
  expiresAt?: string
  isSandbox?: boolean
}

/** An event the hosted workflow reports. No personal data. */
export interface WorkflowEvent {
  type: string
  sessionId: string
  nodeId?: string
}

export type WorkflowEnd = 'completed' | 'failed' | 'manual_review' | 'expired'

export type WorkflowResult =
  | { status: WorkflowEnd; sessionId: string }
  /** Closed before an end state. `lastEvent` of `processing` means checks continue in the background. */
  | { status: 'cancelled'; sessionId: string; lastEvent?: string }
  /** The workflow could not start. */
  | {
      status: 'failed'
      sessionId?: undefined
      error: { code: WorkflowErrorCode; message: string }
    }

export interface WorkflowOptions {
  /** `live_pk_...` or `test_pk_...`. A secret key is refused. */
  publishableKey: string
  workflowId: string
  customer: WorkflowCustomer
  metadata?: Record<string, unknown>
  /** An ID you already have for the person (exactly one); they skip the ID screen. */
  prefill?: WorkflowPrefill
  redirectUrl?: string
  /** Override the API base URL (for example for a staging server). */
  baseUrl?: string
  /**
   * Open the workflow at this hosted app instead of the link the backend returns, as
   * `<hostedUrl>?session=<id>`. For testing a local or staging build of the hosted app.
   */
  hostedUrl?: string
  /**
   * Give the widget the device ID this library keeps on your site, so the checks see one stable
   * device across visits. On by default. Nothing is sent unless the widget asks for it.
   */
  collectDeviceData?: boolean
  /** Every event the workflow reports. Carries no personal data. */
  onEvent?: (event: WorkflowEvent) => void
  /** Called once when the flow ends: an end state, `cancelled`, or `failed` if it could not start. */
  callback: (result: WorkflowResult) => void
}

export interface WorkflowHandle {
  close: () => void
}

export class PremblyWorkflowError extends Error {
  code: WorkflowErrorCode
  constructor(code: WorkflowErrorCode, message: string) {
    super(message)
    this.name = 'PremblyWorkflowError'
    this.code = code
    // Keep `instanceof` working when compiled to ES5.
    Object.setPrototypeOf(this, PremblyWorkflowError.prototype)
  }
}

const nonEmpty = (v: unknown): v is string =>
  typeof v === 'string' && v.trim() !== ''

// The field the page uses, and the name the backend knows the ID by.
const PREFILL_FIELDS: ReadonlyArray<readonly [keyof WorkflowPrefill, string]> =
  [
    ['nin', 'nin'],
    ['bvn', 'bvn'],
    ['passport', 'passport'],
    ['driversLicense', 'drivers_license'],
    ['votersCard', 'voters_card']
  ]

/** The IDs given, as [name the backend knows it by, number]. Blank counts as not given. */
export const prefillGiven = (
  prefill: WorkflowPrefill
): Array<[string, string]> => {
  const given: Array<[string, string]> = []
  PREFILL_FIELDS.forEach(([field, name]) => {
    const value = prefill[field]
    if (nonEmpty(value)) given.push([name, value.trim()])
  })
  return given
}

/**
 * The metadata sent with the session: yours, plus the prefill in the form the backend picks up
 * (`{ prefill: true, channel_code: 'bvn', bvn: '<number>' }`). The prefill wins over any of those
 * keys already in your metadata; everything else of yours is kept, and your object is not changed.
 */
export const workflowMetadata = (
  options: Pick<WorkflowOptions, 'metadata' | 'prefill'>
): Record<string, unknown> => {
  const metadata: Record<string, unknown> = { ...(options.metadata || {}) }
  const given = options.prefill ? prefillGiven(options.prefill)[0] : undefined
  if (given) {
    const [name, number] = given
    metadata.prefill = true
    metadata.channel_code = name
    metadata[name] = number
  }
  return metadata
}

export const validateWorkflowOptions = (o: WorkflowOptions): void => {
  const key = (o.publishableKey || '').trim()
  if (!key.startsWith('live_pk_') && !key.startsWith('test_pk_')) {
    throw new PremblyWorkflowError(
      'invalid_key',
      'publishableKey must be your public key (live_pk_... or test_pk_...). Never put a secret key in a web page.'
    )
  }
  const invalid = (message: string) =>
    new PremblyWorkflowError('invalid_request', message)
  if (!nonEmpty(o.workflowId)) throw invalid('workflowId is required.')
  const c = o.customer
  if (!c || !nonEmpty(c.firstName) || !nonEmpty(c.lastName)) {
    throw invalid('customer.firstName and customer.lastName are required.')
  }
  if (!nonEmpty(c.email) || !EMAIL_RE.test(c.email)) {
    throw invalid('customer.email must be a valid email.')
  }
  if (o.prefill && prefillGiven(o.prefill).length !== 1) {
    throw invalid(
      'prefill needs exactly one ID: nin, bvn, passport, driversLicense or votersCard.'
    )
  }
}

const codeForStatus = (status: number): WorkflowErrorCode => {
  if (status === 401 || status === 403) return 'unauthorised'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  if (status >= 400 && status < 500) return 'invalid_request'
  return 'server_error'
}

const appId = (): string =>
  typeof window !== 'undefined' && window.location
    ? window.location.origin
    : 'unknown'

/**
 * Create a workflow session with the publishable key, the same call the mobile SDKs make. Throws a
 * PremblyWorkflowError.
 */
export const createWorkflowSession = async (
  o: WorkflowOptions
): Promise<WorkflowSessionInfo> => {
  validateWorkflowOptions(o)
  const baseUrl = (o.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const c = o.customer
  const body = {
    workflow_id: o.workflowId,
    customer: {
      first_name: c.firstName,
      last_name: c.lastName,
      email: c.email,
      ...(c.phone !== undefined ? { phone: c.phone } : {}),
      ...(c.reference !== undefined ? { reference: c.reference } : {})
    },
    metadata: workflowMetadata(o),
    ...(o.redirectUrl !== undefined ? { redirect_url: o.redirectUrl } : {})
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WORKFLOW_TIMEOUT_MS)
  try {
    const response = await fetch(baseUrl + WORKFLOW_SESSIONS_PATH, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Publishable-Key': o.publishableKey.trim(),
        'X-App-Id': appId(),
        'X-SDK-Platform': 'web',
        'X-SDK-Version': SDK_VERSION
      },
      body: JSON.stringify(body)
    })
    if (!response.ok) {
      let message = `The workflow session could not be created (HTTP ${response.status}).`
      try {
        const payload = await response.json()
        if (nonEmpty(payload && payload.message)) message = payload.message
      } catch {
        // keep the generic message
      }
      throw new PremblyWorkflowError(codeForStatus(response.status), message)
    }
    const data = ((await response.json()) || {}).data
    if (!data || !nonEmpty(data.session_id) || !nonEmpty(data.link)) {
      throw new PremblyWorkflowError(
        'server_error',
        'The workflow session response was incomplete.'
      )
    }
    return {
      sessionId: data.session_id,
      link: data.link,
      ...(data.expires_at !== undefined ? { expiresAt: data.expires_at } : {}),
      ...(data.is_sandbox !== undefined ? { isSandbox: data.is_sandbox } : {})
    }
  } catch (error) {
    if (error instanceof PremblyWorkflowError) throw error
    const aborted =
      !!error && (error as { name?: string }).name === 'AbortError'
    throw new PremblyWorkflowError(
      aborted ? 'timeout' : 'network_error',
      aborted
        ? 'The workflow session request timed out.'
        : 'Could not reach Prembly. Check the connection and try again.'
    )
  } finally {
    clearTimeout(timer)
  }
}

const END_STATES: readonly string[] = [
  'completed',
  'failed',
  'manual_review',
  'expired'
]

export const isEndState = (type: string): type is WorkflowEnd =>
  END_STATES.indexOf(type) >= 0

const isOurSource = (data: Record<string, unknown>): boolean =>
  (data.source === EVENT_SOURCE && data.product === 'workflow') ||
  data.source === LEGACY_EVENT_SOURCE

/**
 * A message from the hosted workflow: the current envelope
 * (`{ source: 'prembly-sdk', product: 'workflow', type, session_id, node_id? }`) or the legacy
 * `prembly-workflow-sdk` shape. Anything else (another product, another source) is null.
 */
export const parseWorkflowMessage = (raw: unknown): WorkflowEvent | null => {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  if (!isOurSource(data)) return null
  if (typeof data.type !== 'string' || typeof data.session_id !== 'string')
    return null
  return {
    type: data.type,
    sessionId: data.session_id,
    ...(typeof data.node_id === 'string' ? { nodeId: data.node_id } : {})
  }
}

/** `<hostedUrl>?session=<id>`, keeping any other query and hash. */
export const withSession = (hostedUrl: string, sessionId: string): string => {
  const url = new URL(hostedUrl)
  url.searchParams.set('session', sessionId)
  return url.href
}

/** The link must be an https page (http only for localhost, for testing). */
const originOf = (link: string): string | null => {
  try {
    const url = new URL(link)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol === 'https:' || (local && url.protocol === 'http:'))
      return url.origin
    return null
  } catch {
    return null
  }
}

const OVERLAY_STYLE =
  'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483000;background:rgba(0,0,0,.55);' +
  'display:flex;align-items:center;justify-content:center;'
const FRAME_STYLE =
  'width:min(480px,100%);height:min(760px,100%);border:0;border-radius:12px;background:#fff;'
const LOADING_STYLE =
  'color:#fff;font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
const CLOSE_STYLE =
  'position:absolute;top:12px;right:16px;border:0;background:none;color:#fff;font-size:28px;' +
  'cursor:pointer;'

const toFailure = (error: unknown): WorkflowResult => {
  const e =
    error instanceof PremblyWorkflowError
      ? error
      : new PremblyWorkflowError(
          'network_error',
          String((error as Error)?.message || error)
        )
  return { status: 'failed', error: { code: e.code, message: e.message } }
}

/**
 * Start one of your workflows with your public key and show it in a full-screen layer. The layer
 * shows a loading message while the session is created. The result comes through `callback`, once.
 */
export const startWorkflow = async (
  options: WorkflowOptions
): Promise<WorkflowHandle> => {
  let finished = false
  let overlay: HTMLElement | null = null
  let previousOverflow = ''
  let session: WorkflowSessionInfo | null = null
  let lastEvent: string | undefined
  let onMessage: ((event: MessageEvent) => void) | null = null

  const cleanup = () => {
    if (onMessage) window.removeEventListener('message', onMessage)
    onMessage = null
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay)
      document.body.style.overflow = previousOverflow
    }
    overlay = null
  }

  const end = (result: WorkflowResult) => {
    if (finished) return
    finished = true
    cleanup()
    try {
      options.callback(result)
    } catch (error) {
      console.error('[Prembly] callback threw', error)
    }
  }

  // The person (or the page) closes the flow. Before an end state that is a cancel, and `lastEvent`
  // says whether the checks were still running (`processing`).
  const close = () => {
    if (session) {
      end({
        status: 'cancelled',
        sessionId: session.sessionId,
        ...(lastEvent ? { lastEvent } : {})
      })
    } else {
      end({
        status: 'failed',
        error: {
          code: 'network_error',
          message: 'Closed before the workflow started.'
        }
      })
    }
  }
  const handle: WorkflowHandle = { close }

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    end({
      status: 'failed',
      error: { code: 'not_available', message: 'Workflows need a browser.' }
    })
    return handle
  }

  // A mistake in the options fails at once, without showing anything.
  try {
    validateWorkflowOptions(options)
  } catch (error) {
    end(toFailure(error))
    return handle
  }

  overlay = document.createElement('div')
  overlay.setAttribute('style', OVERLAY_STYLE)
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  const loading = document.createElement('div')
  loading.setAttribute('style', LOADING_STYLE)
  loading.setAttribute('role', 'status')
  loading.textContent = 'Initializing secure session...'
  overlay.appendChild(loading)
  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.setAttribute('aria-label', 'Close')
  closeButton.setAttribute('style', CLOSE_STYLE)
  closeButton.textContent = '×'
  closeButton.addEventListener('click', close)
  overlay.appendChild(closeButton)
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.body.appendChild(overlay)

  let created: WorkflowSessionInfo
  try {
    created = await createWorkflowSession(options)
  } catch (error) {
    end(toFailure(error))
    return handle
  }
  // Closed while the session was being created.
  if (finished || !overlay) return handle

  let link = created.link
  if (options.hostedUrl) {
    try {
      link = withSession(options.hostedUrl, created.sessionId)
    } catch {
      end({
        status: 'failed',
        error: {
          code: 'invalid_request',
          message: 'hostedUrl is not a valid URL.'
        }
      })
      return handle
    }
  }
  const origin = originOf(link)
  if (!origin) {
    end({
      status: 'failed',
      error: {
        code: 'server_error',
        message: 'The workflow link was not a secure address.'
      }
    })
    return handle
  }
  session = { ...created, link }
  const current = session

  const frame = document.createElement('iframe')
  frame.src = link
  frame.title = 'Prembly verification'
  frame.setAttribute(
    'allow',
    'camera; microphone; geolocation; clipboard-write'
  )
  frame.setAttribute('style', FRAME_STYLE)

  onMessage = (event: MessageEvent) => {
    // Only the frame this library opened, from the page it opened.
    if (event.source !== frame.contentWindow || event.origin !== origin) return
    const data = event.data as Record<string, unknown> | null
    if (!data || typeof data !== 'object' || !isOurSource(data)) return

    if (data.type === 'device_request') {
      const deviceId =
        options.collectDeviceData === false ? '' : getWebDeviceId()
      if (deviceId && frame.contentWindow) {
        frame.contentWindow.postMessage(
          {
            source: 'prembly-web-sdk',
            type: 'device',
            version: 1,
            deviceId,
            sdkVersion: SDK_VERSION
          },
          origin
        )
      }
      return
    }

    const parsed = parseWorkflowMessage(data)
    // Only this session's events count; a message about another session is ignored.
    if (!parsed || parsed.sessionId !== current.sessionId) return
    const report = () => {
      if (!options.onEvent) return
      try {
        options.onEvent(parsed)
      } catch {
        // a throwing listener must not break the flow
      }
    }
    // The person cancelled from the widget's own Cancel button: close the flow the way the close
    // button does. Checked first so `lastEvent` is still what came before it.
    if (parsed.type === 'cancelled') {
      report()
      close()
      return
    }
    lastEvent = parsed.type
    report()
    if (isEndState(parsed.type))
      end({ status: parsed.type, sessionId: current.sessionId })
  }
  window.addEventListener('message', onMessage)
  overlay.replaceChild(frame, loading)

  return handle
}
