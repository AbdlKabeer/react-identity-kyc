import { useCallback, useEffect, useRef } from 'react'
import { startWorkflow, WorkflowHandle, WorkflowOptions } from './workflow'

/**
 * Returns a function that starts the workflow. The latest options are used each time it is called,
 * and a workflow still open (or still loading) when the component goes away is closed.
 */
const usePremblyWorkflow = (options: WorkflowOptions) => {
  const latest = useRef(options)
  latest.current = options
  const handle = useRef<WorkflowHandle | null>(null)
  const unmounted = useRef(false)

  useEffect(() => {
    // Set on every mount: React's StrictMode unmounts and mounts again in development, and a flag
    // left over from that first unmount would close every flow this hook starts.
    unmounted.current = false
    return () => {
      unmounted.current = true
      if (handle.current) handle.current.close()
    }
  }, [])

  return useCallback(async () => {
    const opened = await startWorkflow(latest.current)
    handle.current = opened
    // The component went away while the session was being created.
    if (unmounted.current) opened.close()
    return opened
  }, [])
}

export default usePremblyWorkflow
