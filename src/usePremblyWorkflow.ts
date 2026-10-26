import { useCallback, useEffect, useRef } from 'react'
import { startWorkflow, WorkflowHandle, WorkflowOptions } from './workflow'

/**
 * Returns a function that starts the workflow. The latest options are used each time it is called,
 * and a workflow still open when the component goes away is closed.
 */
const usePremblyWorkflow = (options: WorkflowOptions) => {
  const latest = useRef(options)
  latest.current = options
  const handle = useRef<WorkflowHandle | null>(null)

  useEffect(
    () => () => {
      if (handle.current) handle.current.close()
    },
    []
  )

  return useCallback(async () => {
    handle.current = await startWorkflow(latest.current)
    return handle.current
  }, [])
}

export default usePremblyWorkflow
