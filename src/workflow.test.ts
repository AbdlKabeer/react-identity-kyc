import { getWebDeviceId } from './device'
import { startWorkflow, WorkflowOptions, WorkflowResult } from './workflow'

const LINK = 'https://sdk-live.prembly.com/?session=s1'

const options = (over: Partial<WorkflowOptions> = {}): WorkflowOptions => ({
  publishableKey: 'test_pk_abc',
  workflowId: 'wf_1',
  customer: { firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com' },
  callback: () => undefined,
  ...over
})

const mockSession = () => {
  ;(global as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { session_id: 's1', link: LINK } })
  })
}

// jsdom gives the frame a window; messages are delivered with the frame as the source.
let lastFrameWindow: Window | null = null
const fromFrame = (data: unknown, origin = 'https://sdk-live.prembly.com') => {
  const frame = document.querySelector('iframe') as HTMLIFrameElement | null
  if (frame) lastFrameWindow = frame.contentWindow
  window.dispatchEvent(new MessageEvent('message', { data, origin, source: lastFrameWindow }))
}

beforeEach(() => {
  document.body.innerHTML = ''
  window.localStorage.clear()
})

describe('getWebDeviceId', () => {
  it('creates an id once and keeps it', () => {
    const first = getWebDeviceId()
    expect(first).not.toBe('')
    expect(getWebDeviceId()).toBe(first)
  })
})

describe('startWorkflow', () => {
  it('refuses a secret key without calling the network', async () => {
    const results: WorkflowResult[] = []
    ;(global as any).fetch = jest.fn()
    await startWorkflow(options({ publishableKey: 'live_sk_x', callback: (r) => results.push(r) }))
    expect(results[0]).toMatchObject({ status: 'failed', errorCode: 'invalid_key' })
    expect((global as any).fetch).not.toHaveBeenCalled()
  })

  it('sends the key and platform headers when creating the session', async () => {
    mockSession()
    const handle = await startWorkflow(options())
    const [, init] = (global as any).fetch.mock.calls[0]
    expect(init.headers['X-Publishable-Key']).toBe('test_pk_abc')
    expect(init.headers['X-SDK-Platform']).toBe('web')
    handle.close()
  })

  it('answers the widget\'s device request with the first-party id, only to its origin', async () => {
    mockSession()
    await startWorkflow(options())
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    const post = jest.spyOn(frame.contentWindow as Window, 'postMessage')
    fromFrame({ source: 'prembly-workflow-sdk', type: 'device_request' })
    expect(post).toHaveBeenCalledTimes(1)
    const [message, target] = post.mock.calls[0] as [any, string]
    expect(target).toBe('https://sdk-live.prembly.com')
    expect(message).toMatchObject({ source: 'prembly-web-sdk', type: 'device', version: 1 })
    expect(message.deviceId).toBe(getWebDeviceId())
  })

  it('ignores a device request from another origin', async () => {
    mockSession()
    await startWorkflow(options())
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    const post = jest.spyOn(frame.contentWindow as Window, 'postMessage')
    fromFrame({ source: 'prembly-workflow-sdk', type: 'device_request' }, 'https://evil.example')
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
      options({ onEvent: (e) => events.push(e.type), callback: (r) => results.push(r) })
    )
    fromFrame({ source: 'prembly-workflow-sdk', type: 'step_started', session_id: 's1', node_id: 'n1' })
    fromFrame({ source: 'prembly-workflow-sdk', type: 'completed', session_id: 's1' })
    fromFrame({ source: 'prembly-workflow-sdk', type: 'failed', session_id: 's1' })
    expect(events).toEqual(['step_started', 'completed'])
    expect(results).toEqual([{ status: 'completed', sessionId: 's1' }])
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('reports cancelled with the last event when closed', async () => {
    mockSession()
    const results: WorkflowResult[] = []
    const handle = await startWorkflow(options({ callback: (r) => results.push(r) }))
    fromFrame({ source: 'prembly-workflow-sdk', type: 'step_started', session_id: 's1', node_id: 'n1' })
    handle.close()
    expect(results[0]).toMatchObject({ status: 'cancelled', lastEvent: { type: 'step_started', nodeId: 'n1' } })
  })
})
