import { _resetDeviceIdMemory, DEVICE_ID_KEY, getWebDeviceId } from './device'
import {
  parseWorkflowMessage,
  startWorkflow,
  withSession,
  workflowMetadata,
  WorkflowOptions,
  WorkflowResult
} from './workflow'

const LINK = 'https://sdk-live.prembly.com/?session=s1'
const ORIGIN = 'https://sdk-live.prembly.com'

const options = (over: Partial<WorkflowOptions> = {}): WorkflowOptions => ({
  publishableKey: 'test_pk_abc',
  workflowId: 'wf_1',
  customer: { firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com' },
  callback: () => undefined,
  ...over
})

const mockSession = (
  data: Record<string, unknown> = { session_id: 's1', link: LINK }
) => {
  ;(global as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data })
  })
}

const sentBody = () => JSON.parse((global as any).fetch.mock.calls[0][1].body)

// jsdom gives the frame a window; messages are delivered with the frame as the source.
const fromFrame = (data: unknown, origin = ORIGIN) => {
  const frame = document.querySelector('iframe') as HTMLIFrameElement | null
  const source = frame ? frame.contentWindow : null
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }))
}
const legacy = (type: string, extra: Record<string, unknown> = {}) => ({
  source: 'prembly-workflow-sdk',
  type,
  session_id: 's1',
  ...extra
})
const envelope = (type: string, extra: Record<string, unknown> = {}) => ({
  source: 'prembly-sdk',
  product: 'workflow',
  type,
  session_id: 's1',
  ...extra
})

beforeEach(() => {
  document.body.innerHTML = ''
  document.body.style.overflow = ''
  window.localStorage.clear()
  _resetDeviceIdMemory()
})

describe('getWebDeviceId', () => {
  it('creates a UUID once and keeps it under the shared key', () => {
    const first = getWebDeviceId()
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(getWebDeviceId()).toBe(first)
    expect(window.localStorage.getItem(DEVICE_ID_KEY)).toBe(first)
  })

  it('falls back to a cookie when storage is blocked', () => {
    const setItem = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked')
      })
    const id = getWebDeviceId()
    expect(document.cookie).toContain(`${DEVICE_ID_KEY}=${id}`)
    setItem.mockRestore()
    _resetDeviceIdMemory()
    expect(getWebDeviceId()).toBe(id)
    document.cookie = `${DEVICE_ID_KEY}=; max-age=0; path=/`
  })
})

describe('workflowMetadata (prefill)', () => {
  it('adds the one ID in the form the backend picks up, keeping your metadata', () => {
    const mine = { plan: 'gold', bvn: 'old' }
    expect(
      workflowMetadata({
        metadata: mine,
        prefill: { driversLicense: ' ABC123 ' }
      })
    ).toEqual({
      plan: 'gold',
      bvn: 'old',
      prefill: true,
      channel_code: 'drivers_license',
      drivers_license: 'ABC123'
    })
    expect(mine).toEqual({ plan: 'gold', bvn: 'old' })
  })

  it('leaves the metadata alone without a prefill', () => {
    expect(workflowMetadata({ metadata: { a: 1 } })).toEqual({ a: 1 })
    expect(workflowMetadata({})).toEqual({})
  })
})

describe('parseWorkflowMessage', () => {
  it('reads the current envelope and the legacy shape', () => {
    expect(
      parseWorkflowMessage(envelope('step_started', { node_id: 'n1' }))
    ).toEqual({
      type: 'step_started',
      sessionId: 's1',
      nodeId: 'n1'
    })
    expect(parseWorkflowMessage(legacy('completed'))).toEqual({
      type: 'completed',
      sessionId: 's1'
    })
  })

  it('ignores another product, another source, or a message without a session', () => {
    expect(
      parseWorkflowMessage({ ...envelope('completed'), product: 'kyc' })
    ).toBeNull()
    expect(
      parseWorkflowMessage({ ...envelope('completed'), source: 'other' })
    ).toBeNull()
    expect(
      parseWorkflowMessage({
        source: 'prembly-sdk',
        product: 'workflow',
        type: 'x'
      })
    ).toBeNull()
    expect(parseWorkflowMessage('completed')).toBeNull()
  })
})

describe('withSession', () => {
  it('sets the session and keeps the rest of the URL', () => {
    expect(
      withSession('http://localhost:3010/app?theme=dark&session=old#top', 's9')
    ).toBe('http://localhost:3010/app?theme=dark&session=s9#top')
  })
})

describe('startWorkflow', () => {
  it('refuses a secret key without calling the network or showing anything', async () => {
    const results: WorkflowResult[] = []
    ;(global as any).fetch = jest.fn()
    await startWorkflow(
      options({ publishableKey: 'live_sk_x', callback: (r) => results.push(r) })
    )
    expect(results).toEqual([
      {
        status: 'failed',
        error: { code: 'invalid_key', message: expect.any(String) }
      }
    ])
    expect((global as any).fetch).not.toHaveBeenCalled()
    expect(document.body.children.length).toBe(0)
  })

  it('refuses a prefill with more than one ID', async () => {
    const results: WorkflowResult[] = []
    ;(global as any).fetch = jest.fn()
    await startWorkflow(
      options({
        prefill: { bvn: '1', nin: '2' },
        callback: (r) => results.push(r)
      })
    )
    expect(results[0]).toMatchObject({
      status: 'failed',
      error: { code: 'invalid_request' }
    })
    expect((global as any).fetch).not.toHaveBeenCalled()
  })

  it('sends the key, platform, app and prefill when creating the session', async () => {
    mockSession()
    const handle = await startWorkflow(
      options({ prefill: { bvn: '22212345678' } })
    )
    const [url, init] = (global as any).fetch.mock.calls[0]
    expect(url).toBe(
      'https://backend.prembly.com/api/v1/compliance-workflow/sdk/v1/sessions/'
    )
    expect(init.headers['X-Publishable-Key']).toBe('test_pk_abc')
    expect(init.headers['X-SDK-Platform']).toBe('web')
    expect(init.headers['X-App-Id']).toBe(window.location.origin)
    expect(sentBody().metadata).toEqual({
      prefill: true,
      channel_code: 'bvn',
      bvn: '22212345678'
    })
    handle.close()
  })

  it('shows a loading layer while the session is created', async () => {
    let resolve: (value: unknown) => void = () => undefined
    ;(global as any).fetch = jest.fn(() => new Promise((r) => (resolve = r)))
    const started = startWorkflow(options())
    await Promise.resolve()
    expect(document.querySelector('[role="status"]')).not.toBeNull()
    expect(document.querySelector('iframe')).toBeNull()
    expect(document.body.style.overflow).toBe('hidden')
    resolve({
      ok: true,
      status: 200,
      json: async () => ({ data: { session_id: 's1', link: LINK } })
    })
    const handle = await started
    expect(document.querySelector('[role="status"]')).toBeNull()
    expect(document.querySelector('iframe')).not.toBeNull()
    handle.close()
    expect(document.body.style.overflow).toBe('')
  })

  it('reports a failed start with the error and removes the layer', async () => {
    ;(global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Invalid public key.' })
    })
    const results: WorkflowResult[] = []
    await startWorkflow(options({ callback: (r) => results.push(r) }))
    expect(results).toEqual([
      {
        status: 'failed',
        error: { code: 'unauthorised', message: 'Invalid public key.' }
      }
    ])
    expect(document.body.children.length).toBe(0)
  })

  it('reports a timeout as timeout, not a network error', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    ;(global as any).fetch = jest.fn().mockRejectedValue(abort)
    const results: WorkflowResult[] = []
    await startWorkflow(options({ callback: (r) => results.push(r) }))
    expect(results[0]).toMatchObject({
      status: 'failed',
      error: { code: 'timeout' }
    })
  })

  it('opens the hostedUrl with the session instead of the returned link', async () => {
    mockSession()
    const handle = await startWorkflow(
      options({ hostedUrl: 'http://localhost:3010/' })
    )
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    expect(frame.src).toBe('http://localhost:3010/?session=s1')
    handle.close()
  })

  it("answers the widget's device request with the first-party id, only to its origin", async () => {
    mockSession()
    await startWorkflow(options())
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    const post = jest.spyOn(frame.contentWindow as Window, 'postMessage')
    fromFrame({ source: 'prembly-workflow-sdk', type: 'device_request' })
    expect(post).toHaveBeenCalledTimes(1)
    const [message, target] = post.mock.calls[0] as [any, string]
    expect(target).toBe(ORIGIN)
    expect(message).toMatchObject({
      source: 'prembly-web-sdk',
      type: 'device',
      version: 1
    })
    expect(message.deviceId).toBe(getWebDeviceId())
  })

  it('answers a device request in the current envelope too', async () => {
    mockSession()
    await startWorkflow(options())
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    const post = jest.spyOn(frame.contentWindow as Window, 'postMessage')
    fromFrame({
      source: 'prembly-sdk',
      product: 'workflow',
      type: 'device_request'
    })
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('ignores a device request from another origin', async () => {
    mockSession()
    await startWorkflow(options())
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    const post = jest.spyOn(frame.contentWindow as Window, 'postMessage')
    fromFrame(
      { source: 'prembly-workflow-sdk', type: 'device_request' },
      'https://evil.example'
    )
    expect(post).not.toHaveBeenCalled()
  })

  it('sends nothing when collectDeviceData is off', async () => {
    mockSession()
    await startWorkflow(options({ collectDeviceData: false }))
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    const post = jest.spyOn(frame.contentWindow as Window, 'postMessage')
    fromFrame({ source: 'prembly-workflow-sdk', type: 'device_request' })
    expect(post).not.toHaveBeenCalled()
  })

  it('reports events, ends once on completion and removes the layer', async () => {
    mockSession()
    const events: string[] = []
    const results: WorkflowResult[] = []
    await startWorkflow(
      options({
        onEvent: (e) => events.push(e.type),
        callback: (r) => results.push(r)
      })
    )
    fromFrame(envelope('step_started', { node_id: 'n1' }))
    fromFrame(legacy('completed'))
    fromFrame(legacy('failed'))
    expect(events).toEqual(['step_started', 'completed'])
    expect(results).toEqual([{ status: 'completed', sessionId: 's1' }])
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('ignores events about another session', async () => {
    mockSession()
    const results: WorkflowResult[] = []
    const handle = await startWorkflow(
      options({ callback: (r) => results.push(r) })
    )
    fromFrame(envelope('completed', { session_id: 'other' }))
    expect(results).toEqual([])
    handle.close()
  })

  it('keeps the flow open on processing, and a close then says the checks were running', async () => {
    mockSession()
    const results: WorkflowResult[] = []
    const handle = await startWorkflow(
      options({ callback: (r) => results.push(r) })
    )
    fromFrame(envelope('processing'))
    expect(results).toEqual([])
    expect(document.querySelector('iframe')).not.toBeNull()
    handle.close()
    expect(results).toEqual([
      { status: 'cancelled', sessionId: 's1', lastEvent: 'processing' }
    ])
  })

  it("closes as cancelled when the widget's own Cancel is used", async () => {
    mockSession()
    const events: string[] = []
    const results: WorkflowResult[] = []
    await startWorkflow(
      options({
        onEvent: (e) => events.push(e.type),
        callback: (r) => results.push(r)
      })
    )
    fromFrame(envelope('step_started', { node_id: 'n1' }))
    fromFrame(envelope('cancelled'))
    expect(events).toEqual(['step_started', 'cancelled'])
    expect(results).toEqual([
      { status: 'cancelled', sessionId: 's1', lastEvent: 'step_started' }
    ])
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('reports cancelled with the last event when the close button is pressed', async () => {
    mockSession()
    const results: WorkflowResult[] = []
    await startWorkflow(options({ callback: (r) => results.push(r) }))
    fromFrame(legacy('step_started', { node_id: 'n1' }))
    ;(
      document.querySelector('button[aria-label="Close"]') as HTMLButtonElement
    ).click()
    expect(results).toEqual([
      { status: 'cancelled', sessionId: 's1', lastEvent: 'step_started' }
    ])
  })
})
