import { useEffect, useRef } from 'react'
import { startWorkflow, WorkflowHandle, WorkflowOptions } from './workflow'

export interface PremblyWorkflowProps extends WorkflowOptions {
  /** Opens the workflow when it becomes true, and closes it when it becomes false. */
  isVisible: boolean
}

/**
 * The workflow as a component, the same shape as the React Native SDK's `<PremblyWorkflow>`. It
 * renders nothing itself: the flow is shown in a full-screen layer. Set `isVisible` back to false in
 * `callback`.
 *
 * Setting `isVisible` to false (or unmounting) closes the flow without calling `callback`, as hiding
 * the React Native modal does. That also keeps React's StrictMode, which mounts twice in
 * development, from reporting a `cancelled` for the flow it throws away.
 */
export const PremblyWorkflow = (props: PremblyWorkflowProps) => {
  const { isVisible } = props
  // The latest props are read when the flow starts and in the callbacks, without restarting it.
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    if (!isVisible) return undefined
    let handle: WorkflowHandle | null = null
    let stopped = false
    const current = latest.current
    startWorkflow({
      ...current,
      onEvent: (event) => {
        if (!stopped && latest.current.onEvent) latest.current.onEvent(event)
      },
      callback: (result) => {
        if (!stopped) latest.current.callback(result)
      }
    }).then((opened) => {
      handle = opened
      if (stopped) opened.close()
    })
    return () => {
      stopped = true
      if (handle) handle.close()
    }
  }, [isVisible])

  return null
}

export default PremblyWorkflow
