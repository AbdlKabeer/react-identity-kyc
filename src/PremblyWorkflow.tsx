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
        if (latest.current.onEvent) latest.current.onEvent(event)
      },
      callback: (result) => latest.current.callback(result)
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
