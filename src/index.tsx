/* eslint-disable prettier/prettier */
"use client";

import {
  identityScriptLoader,
  isIdentityWidgetReady,
  loadIdentityScript
} from './components/loadScript'

interface Props {
  first_name?: string,
  last_name?: string,
  email: string,
  phone?: string,
  widget_key?: string,
  widget_id?: string,
  metadata?: Record<string, unknown>,
  merchant_key?: string,
  user_ref?: string,
  config_id?: string,
  is_test?: boolean | string,
  callback: (response?: unknown, data?: unknown) => void
}

const useIdentityPayKYC = (props: Props) => {
  identityScriptLoader()

  const options = {
    first_name: props.first_name,
    last_name: props.last_name,
    email: props.email,
    phone: props.phone,
    widget_key: props.widget_key || props.merchant_key,
    widget_id: props.widget_id || props.config_id,
    metadata: props.metadata,
    user_ref: props.user_ref,
    merchant_key: props.merchant_key || props.widget_key,
    config_id: props.config_id || props.widget_id,
    is_test: props.is_test,
    callback: props.callback
  }

  const reportLoadError = (error: Error) => {
    const response = {
      code: 'E00',
      message: (error && error.message) || 'Could not load identitypass KYC script',
      status: 'failed'
    }

    if (typeof props.callback === 'function') {
      props.callback(response, null)
      return
    }

    console.error(response.message)
  }

  const startVerification = () => {
    if (isIdentityWidgetReady()) {
      window.IdentityKYC?.verify(options)
      return
    }

    throw new Error('Could not load identitypass KYC script')
  }

  const verifyWithIdentity = () => {
    loadIdentityScript().then(startVerification).catch(reportLoadError)
  }

  return verifyWithIdentity
}

export default useIdentityPayKYC
