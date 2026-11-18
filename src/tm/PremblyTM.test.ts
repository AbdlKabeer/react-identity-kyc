import {
  collectWebSignals,
  deviceType,
  parseBrowser,
  parseOs
} from './collector'
import { PremblyTMClient, TMPlatform } from './PremblyTM'

const SIGNALS = {
  device: { type: 'desktop', os_name: 'macos' },
  integrity: { is_automated: false }
}

const platform = (over: Partial<TMPlatform> = {}): TMPlatform => ({
  getDeviceId: async () => 'dev-1',
  collectSignals: jest.fn(async () => SIGNALS),
  getAppId: () => 'https://shop.example',
  ...over
})

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString()

const mockSession = (data: Record<string, unknown> = {}) => {
  ;(global as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({
      data: {
        device_session_id: 'ds_1',
        device_id: 'dev-1',
        is_known_device: true,
        expires_at: inAnHour(),
        ...data
      }
    })
  })
}

const fetchMock = () => (global as any).fetch as jest.Mock
const sentBody = (call = 0) => JSON.parse(fetchMock().mock.calls[call][1].body)

describe('PremblyTM.init', () => {
  it('refuses a secret key', () => {
    const tm = new PremblyTMClient(platform())
    expect(() => tm.init({ publishableKey: 'live_sk_x' })).toThrow(/public key/)
  })
})

describe('PremblyTM.getDeviceSession', () => {
  it('fails open with not_initialised before init', async () => {
    const tm = new PremblyTMClient(platform())
    expect(await tm.getDeviceSession()).toEqual({
      deviceSessionId: null,
      deviceId: null,
      error: 'not_initialised'
    })
  })

  it('sends the signals, device, customer and consent with the web headers', async () => {
    mockSession()
    const tm = new PremblyTMClient(platform())
    tm.init({ publishableKey: 'test_pk_abc' })
    tm.identify(' cust_9 ')
    const session = await tm.getDeviceSession()

    expect(session).toEqual({
      deviceSessionId: 'ds_1',
      deviceId: 'dev-1',
      isKnownDevice: true,
      expiresAt: expect.any(String)
    })
    const [url, init] = fetchMock().mock.calls[0]
    expect(url).toBe(
      'https://backend.prembly.com/api/v1/fraud/transaction-monitoring/sdk/v1/sessions'
    )
    expect(init.headers).toMatchObject({
      'X-Publishable-Key': 'test_pk_abc',
      'X-App-Id': 'https://shop.example',
      'X-SDK-Platform': 'web'
    })
    expect(sentBody()).toMatchObject({
      ...SIGNALS,
      device_id: 'dev-1',
      customer_id: 'cust_9',
      consent: { location: false },
      collected_at: expect.any(String)
    })
  })

  it('reuses a valid session, and makes a new one for another customer or on forceRefresh', async () => {
    mockSession()
    const tm = new PremblyTMClient(platform())
    tm.init({ publishableKey: 'test_pk_abc' })
    await tm.getDeviceSession()
    await tm.getDeviceSession()
    expect(fetchMock()).toHaveBeenCalledTimes(1)
    tm.identify('someone_else')
    await tm.getDeviceSession()
    expect(fetchMock()).toHaveBeenCalledTimes(2)
    await tm.getDeviceSession({ forceRefresh: true })
    expect(fetchMock()).toHaveBeenCalledTimes(3)
  })

  it('does not reuse a session that is about to expire', async () => {
    mockSession({ expires_at: new Date(Date.now() + 10 * 1000).toISOString() })
    const tm = new PremblyTMClient(platform())
    tm.init({ publishableKey: 'test_pk_abc' })
    await tm.getDeviceSession()
    await tm.getDeviceSession()
    expect(fetchMock()).toHaveBeenCalledTimes(2)
  })

  it('shares one request between callers asking at the same time', async () => {
    mockSession()
    const tm = new PremblyTMClient(platform())
    tm.init({ publishableKey: 'test_pk_abc' })
    const [a, b] = await Promise.all([
      tm.getDeviceSession(),
      tm.getDeviceSession()
    ])
    expect(a).toBe(b)
    expect(fetchMock()).toHaveBeenCalledTimes(1)
  })

  it('asks for location only once it is turned on', async () => {
    mockSession()
    const p = platform()
    const tm = new PremblyTMClient(p)
    tm.init({ publishableKey: 'test_pk_abc' })
    await tm.getDeviceSession()
    tm.setLocationEnabled(true)
    await tm.getDeviceSession()
    expect((p.collectSignals as jest.Mock).mock.calls).toEqual([
      [false],
      [true]
    ])
    expect(sentBody(1).consent).toEqual({ location: true })
  })

  it.each([
    [401, 'unauthorised'],
    [403, 'unauthorised'],
    [429, 'rate_limited'],
    [400, 'rejected'],
    [500, 'server_error']
  ])('maps HTTP %i to %s and never throws', async (status, error) => {
    ;(global as any).fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status, json: async () => ({}) })
    const tm = new PremblyTMClient(platform())
    tm.init({ publishableKey: 'test_pk_abc' })
    expect(await tm.getDeviceSession()).toEqual({
      deviceSessionId: null,
      deviceId: 'dev-1',
      error
    })
  })

  it('reports a timeout and a network error apart', async () => {
    const tm = new PremblyTMClient(platform())
    tm.init({ publishableKey: 'test_pk_abc' })
    ;(global as any).fetch = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }))
    expect((await tm.getDeviceSession()).error).toBe('timeout')
    ;(global as any).fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'))
    expect((await tm.getDeviceSession()).error).toBe('network_error')
  })

  it('fails open with native_error when the signals cannot be read', async () => {
    ;(global as any).fetch = jest.fn()
    const tm = new PremblyTMClient(
      platform({
        collectSignals: async () => {
          throw new Error('no browser')
        }
      })
    )
    tm.init({ publishableKey: 'test_pk_abc' })
    expect(await tm.getDeviceSession()).toEqual({
      deviceSessionId: null,
      deviceId: 'dev-1',
      error: 'native_error'
    })
    expect(fetchMock()).not.toHaveBeenCalled()
  })
})

describe('web signal collector', () => {
  it('collects device and integrity signals in a browser, and no location unless asked', async () => {
    const bundle = await collectWebSignals(false)
    expect(bundle.device).toMatchObject({ type: expect.any(String) })
    expect(bundle.integrity).toEqual({ is_automated: expect.any(Boolean) })
    expect(bundle.location).toBeUndefined()
  })

  it('reads the OS, browser and device type from the user agent', () => {
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
    expect(parseOs(iphone)).toEqual({ name: 'ios', version: '17.4' })
    expect(parseBrowser(iphone)).toEqual({ name: 'safari', version: '17.4' })
    expect(deviceType(iphone, 'ios', 5)).toBe('phone')

    const edge =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91'
    expect(parseOs(edge)).toEqual({ name: 'windows', version: '10.0' })
    expect(parseBrowser(edge)).toEqual({
      name: 'edge',
      version: '120.0.2210.91'
    })
    expect(deviceType(edge, 'windows', 0)).toBe('desktop')
  })
})
