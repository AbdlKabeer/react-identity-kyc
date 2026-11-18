import React from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot, Root } from 'react-dom/client'
import { PremblyWorkflow } from './PremblyWorkflow'
import usePremblyWorkflow from './usePremblyWorkflow'
import { WorkflowOptions, WorkflowResult } from './workflow'

const LINK = 'https://sdk-live.prembly.com/?session=s1'

;(global as any).IS_REACT_ACT_ENVIRONMENT = true

const options = (results: WorkflowResult[]): WorkflowOptions => ({
  publishableKey: 'test_pk_abc',
  workflowId: 'wf_1',
  customer: { firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com' },
  callback: (r) => results.push(r)
})

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  document.body.innerHTML = ''
  ;(global as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { session_id: 's1', link: LINK } })
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
})

const strict = (child: React.ReactElement) =>
  React.createElement(React.StrictMode, null, child)

describe('usePremblyWorkflow under StrictMode', () => {
  it('keeps the flow open after the development double mount', async () => {
    const results: WorkflowResult[] = []
    let start: () => Promise<unknown> = async () => undefined
    const Probe = () => {
      start = usePremblyWorkflow(options(results))
      return null
    }
    act(() => root.render(strict(React.createElement(Probe))))
    await act(async () => {
      await start()
    })
    expect(results).toEqual([])
    expect(document.querySelector('iframe')).not.toBeNull()
  })

  it('closes an open flow when the component unmounts', async () => {
    const results: WorkflowResult[] = []
    let start: () => Promise<unknown> = async () => undefined
    const Probe = () => {
      start = usePremblyWorkflow(options(results))
      return null
    }
    act(() => root.render(strict(React.createElement(Probe))))
    await act(async () => {
      await start()
    })
    act(() => root.render(strict(React.createElement('span'))))
    expect(results).toEqual([{ status: 'cancelled', sessionId: 's1' }])
    expect(document.querySelector('iframe')).toBeNull()
  })
})

describe('<PremblyWorkflow> under StrictMode', () => {
  it('opens one flow and reports nothing when visible from the first render', async () => {
    const results: WorkflowResult[] = []
    act(() =>
      root.render(
        strict(
          React.createElement(PremblyWorkflow, {
            ...options(results),
            isVisible: true
          })
        )
      )
    )
    await flush()
    expect(results).toEqual([])
    expect(document.querySelectorAll('iframe').length).toBe(1)
  })

  it('closes the flow without a callback when isVisible turns false', async () => {
    const results: WorkflowResult[] = []
    const render = (isVisible: boolean) =>
      act(() =>
        root.render(
          strict(
            React.createElement(PremblyWorkflow, {
              ...options(results),
              isVisible
            })
          )
        )
      )
    render(false)
    render(true)
    await flush()
    expect(document.querySelector('iframe')).not.toBeNull()
    render(false)
    expect(document.querySelector('iframe')).toBeNull()
    expect(results).toEqual([])
  })

  it('passes the result to callback when the flow ends', async () => {
    const results: WorkflowResult[] = []
    act(() =>
      root.render(
        strict(
          React.createElement(PremblyWorkflow, {
            ...options(results),
            isVisible: true
          })
        )
      )
    )
    await flush()
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            source: 'prembly-sdk',
            product: 'workflow',
            type: 'completed',
            session_id: 's1'
          },
          origin: 'https://sdk-live.prembly.com',
          source: frame.contentWindow
        })
      )
    })
    expect(results).toEqual([{ status: 'completed', sessionId: 's1' }])
  })
})
