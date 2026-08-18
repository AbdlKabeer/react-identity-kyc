"use client";
import { useState, useEffect } from 'react'

declare global {
  interface Window {
    IdentityKYC?: {
      verify: (options: unknown) => void
    }
  }
}

export const PREMBLY_WIDGET_SCRIPT_URL =
  'https://js.prembly.com/v1/inline/widget-v3.js'
const SCRIPT_ID = 'prembly-identity-kyc-script'
const SCRIPT_LOAD_TIMEOUT_MS = 12000

let loadPromise: Promise<void> | null = null

const isBrowser = () =>
  typeof window !== 'undefined' && typeof document !== 'undefined'

export const isIdentityWidgetReady = () =>
  isBrowser() &&
  window.IdentityKYC &&
  typeof window.IdentityKYC.verify === 'function'

const getCspNonce = () => {
  const current = document.querySelector('script[nonce]') as HTMLScriptElement | null
  return current && (current.nonce || current.getAttribute('nonce'))
}

const findExistingScript = () =>
  document.getElementById(SCRIPT_ID) ||
  document.querySelector(`script[src="${PREMBLY_WIDGET_SCRIPT_URL}"]`)

const failLoad = (
  script: HTMLScriptElement,
  reject: (error: Error) => void
) => {
  if (script.parentNode) {
    script.parentNode.removeChild(script)
  }
  loadPromise = null
  reject(new Error('Could not load identitypass KYC script'))
}

const attachLoadHandlers = (
  script: HTMLScriptElement,
  resolve: () => void,
  reject: (error: Error) => void
) => {
  const cleanup = () => {
    clearTimeout(timer)
    script.removeEventListener('load', onLoad)
    script.removeEventListener('error', onError)
  }

  const onLoad = () => {
    cleanup()
    if (isIdentityWidgetReady()) {
      resolve()
      return
    }
    failLoad(script, reject)
  }

  const onError = () => {
    cleanup()
    failLoad(script, reject)
  }

  const timer = setTimeout(() => {
    cleanup()
    if (isIdentityWidgetReady()) {
      resolve()
      return
    }
    failLoad(script, reject)
  }, SCRIPT_LOAD_TIMEOUT_MS)

  script.addEventListener('load', onLoad)
  script.addEventListener('error', onError)
}

export const loadIdentityScript = () => {
  if (!isBrowser()) {
    return Promise.reject(
      new Error('Prembly KYC can only be loaded in the browser')
    )
  }

  if (isIdentityWidgetReady()) {
    return Promise.resolve()
  }

  if (loadPromise) {
    return loadPromise
  }

  loadPromise = new Promise((resolve, reject) => {
    const existing = findExistingScript() as HTMLScriptElement | null
    if (existing) {
      if (isIdentityWidgetReady()) {
        resolve()
        return
      }
      attachLoadHandlers(existing, resolve, reject)
      return
    }

    const target = document.head || document.body
    if (!target) {
      loadPromise = null
      reject(new Error('Could not load identitypass KYC script'))
      return
    }

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = PREMBLY_WIDGET_SCRIPT_URL
    script.async = true

    const nonce = getCspNonce()
    if (nonce) {
      script.setAttribute('nonce', nonce)
    }

    attachLoadHandlers(script, resolve, reject)
    target.appendChild(script)
  })

  return loadPromise
}

export const identityScriptLoader = (): [boolean, Error | null] => {
  const [scriptLoaded, setScriptLoaded] = useState(() => isIdentityWidgetReady())
  const [scriptError, setScriptError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false

    loadIdentityScript()
      .then(() => {
        if (!cancelled) {
          setScriptLoaded(true)
          setScriptError(null)
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setScriptLoaded(false)
          setScriptError(error)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return [scriptLoaded, scriptError]
}
