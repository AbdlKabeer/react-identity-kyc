import { getWebDeviceId, SDK_VERSION } from './device'

export const DEFAULT_BASE_URL = 'https://backend.prembly.com'
const SESSIONS_PATH = '/api/v1/compliance-workflow/sdk/v1/sessions/'
const SESSION_TIMEOUT_MS = 15000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface WorkflowCustomer {
  firstName: string
  lastName: string
  email: string
  phone?: string
  reference?: string
}

export type WorkflowStatus =
  | 'completed'
  | 'failed'
  | 'manual_review'
  | 'expired'
  | 'processing'
  | 'cancelled'

export interface WorkflowEvent {
  type: string
  sessionId: string
  nodeId?: string
}

export interface WorkflowResult {
  status: WorkflowStatus
  sessionId?: string
  /** Set with status `failed` when the workflow could not start. */
  errorCode?: 'invalid_key' | 'invalid_request' | 'unauthorised' | 'not_found' |
    'rate_limited' | 'server_error' | 'network_error' | 'not_available'
  message?: string
  /** The last event seen, set with `cancelled`. */
  lastEvent?: WorkflowEvent
}

export interface WorkflowOptions {
  /** `live_pk_...` or `test_pk_...`. A secret key is refused. */
  publishableKey: string
  workflowId: string
  customer: WorkflowCustomer
  metadata?: Record<string, unknown>
  redirectUrl?: string
  baseUrl?: string
  /**
   * Give the widget the device ID this library keeps on your site, so the checks see one stable
   * device across visits. On by default. Nothing is sent unless the widget asks for it.
   */
  collectDeviceData?: boolean
  /** Every event the workflow reports. Carries no personal data. */
  onEvent?: (event: WorkflowEvent) => void
  /** Called once when the flow ends. */
  callback: (result: WorkflowResult) => void
}

export interface WorkflowHandle {
  close: () => void
}

class StartError extends Error {
  code: NonNullable<WorkflowResult['errorCode']>
  constructor(code: NonNullable<WorkflowResult['errorCode']>, message: string) {
    super(message)
    this.code = code
  }
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

const validate = (o: WorkflowOptions) => {
  const key = (o.publishableKey || '').trim()
  if (!key.startsWith('live_pk_') && !key.startsWith('test_pk_')) {
    throw new StartError(
      'invalid_key',
      'publishableKey must be your public key (live_pk_... or test_pk_...). Never put a secret key in a web page.'
    )
  }
  if (!nonEmpty(o.workflowId)) throw new StartError('invalid_request', 'workflowId is required.')
  const c = o.customer
  if (!c || !nonEmpty(c.firstName) || !nonEmpty(c.lastName)) {
    throw new StartError('invalid_request', 'customer.firstName and customer.lastName are required.')
  }
  if (!nonEmpty(c.email) || !EMAIL_RE.test(c.email)) {
    throw new StartError('invalid_request', 'customer.email must be a valid email.')
  }
}

const codeForStatus = (status: number): NonNullable<WorkflowResult['errorCode']> => {
  if (status === 401 || status === 403) return 'unauthorised'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  if (status >= 400 && status < 500) return 'invalid_request'
  return 'server_error'
}

export const createWorkflowSession = async (
  o: WorkflowOptions
): Promise<{ sessionId: string; link: string }> => {
  validate(o)
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
    metadata: o.metadata || {},
    ...(o.redirectUrl !== undefined ? { redirect_url: o.redirectUrl } : {})
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS)
  try {
    const response = await fetch(baseUrl + SESSIONS_PATH, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Publishable-Key': o.publishableKey.trim(),
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
      throw new StartError(codeForStatus(response.status), message)
    }
    const data = ((await response.json()) || {}).data
    if (!data || !nonEmpty(data.session_id) || !nonEmpty(data.link)) {
      throw new StartError('server_error', 'The workflow session response was incomplete.')
    }
    return { sessionId: data.session_id, link: data.link }
  } catch (error) {
    if (error instanceof StartError) throw error
    throw new StartError('network_error', 'Could not reach Prembly. Check the connection and try again.')
  } finally {
    clearTimeout(timer)
  }
}

const END_STATES = ['completed', 'failed', 'manual_review', 'expired']

/** The link must be an https page (http only for localhost, for testing). */
const originOf = (link: string): string | null => {
  try {
    const url = new URL(link)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol === 'https:' || (local && url.protocol === 'http:')) return url.origin
    return null
  } catch {
    return null
  }
}

const OVERLAY_STYLE =
  'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;' +
  'align-items:center;justify-content:center;'
const FRAME_STYLE =
  'width:min(480px,100%);height:min(760px,100%);border:0;border-radius:12px;background:#fff;'

/**
 * Start one of your workflows with your public key and show it in a full-screen layer. The result
 * comes through `callback`, once.
 */
export const startWorkflow = async (options: WorkflowOptions): Promise<WorkflowHandle> => {
  let finished = false
  let overlay: HTMLElement | null = null
  let cleanup: () => void = () => undefined
  let lastEvent: WorkflowEvent | undefined

  const end = (result: WorkflowResult) => {
    if (finished) return
    finished = true
    cleanup()
    options.callback(result)
  }
  const nothing: WorkflowHandle = { close: () => undefined }

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    end({ status: 'failed', errorCode: 'not_available', message: 'Workflows need a browser.' })
    return nothing
  }

  let session: { sessionId: string; link: string }
  try {
    session = await createWorkflowSession(options)
  } catch (error) {
    const e = error as StartError
    end({ status: 'failed', errorCode: e.code || 'network_error', message: e.message })
    return nothing
  }

  const origin = originOf(session.link)
  if (!origin) {
    end({ status: 'failed', errorCode: 'server_error', message: 'The workflow link was not a secure address.' })
    return nothing
  }

  const frame = document.createElement('iframe')
  frame.src = session.link
  frame.title = 'Prembly verification'
  frame.setAttribute('allow', 'camera; microphone; geolocation; clipboard-write')
  frame.setAttribute('style', FRAME_STYLE)
  overlay = document.createElement('div')
  overlay.setAttribute('style', OVERLAY_STYLE)
  overlay.appendChild(frame)
  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.setAttribute('aria-label', 'Close')
  closeButton.textContent = '\u00d7'
  closeButton.setAttribute(
    'style',
    'position:absolute;top:12px;right:16px;border:0;background:none;color:#fff;font-size:28px;cursor:pointer;'
  )
  closeButton.addEventListener('click', () =>
    end({ status: 'cancelled', sessionId: session.sessionId, lastEvent })
  )
  overlay.appendChild(closeButton)

  const onMessage = (event: MessageEvent) => {
    // Only the frame this library opened, from the page it opened.
    if (event.source !== frame.contentWindow || event.origin !== origin) return
    const data = event.data as Record<string, unknown> | null
    if (!data || typeof data !== 'object') return

    if (data.source === 'prembly-workflow-sdk' && data.type === 'device_request') {
      const deviceId = options.collectDeviceData === false ? '' : getWebDeviceId()
      if (deviceId && frame.contentWindow) {
        frame.contentWindow.postMessage(
          { source: 'prembly-web-sdk', type: 'device', version: 1, deviceId, sdkVersion: SDK_VERSION },
          origin
        )
      }
      return
    }

    if (data.source !== 'prembly-workflow-sdk' || typeof data.type !== 'string') return
    const seen: WorkflowEvent = {
      type: data.type,
      sessionId: String(data.session_id || session.sessionId),
      ...(typeof data.node_id === 'string' ? { nodeId: data.node_id } : {})
    }
    lastEvent = seen
    if (options.onEvent) {
      try {
        options.onEvent(seen)
      } catch {
        // a throwing listener must not break the flow
      }
    }
    if (END_STATES.indexOf(data.type) >= 0 || data.type === 'processing') {
      end({ status: data.type as WorkflowStatus, sessionId: session.sessionId })
    }
  }

  window.addEventListener('message', onMessage)
  cleanup = () => {
    window.removeEventListener('message', onMessage)
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay)
    overlay = null
  }
  document.body.appendChild(overlay)

  return {
    close: () => end({ status: 'cancelled', sessionId: session.sessionId, lastEvent })
  }
}
