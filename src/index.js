"use client";
import {
  identityScriptLoader,
  isIdentityWidgetReady,
  loadIdentityScript
} from './components/loadScript'
import PropTypes from 'prop-types'

const useIdentityPayKYC = (props) => {
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

  const reportLoadError = (error) => {
    const response = {
      code: 'E00',
      message:
        (error && error.message) || 'Could not load identitypass KYC script',
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
      window.IdentityKYC.verify(options)
      return
    }

    throw new Error('Could not load identitypass KYC script')
  }

  const verifyWithIdentity = () => {
    loadIdentityScript().then(startVerification).catch(reportLoadError)
  }

  return verifyWithIdentity
}

useIdentityPayKYC.propTypes = {
  first_name: PropTypes.string,
  last_name: PropTypes.string,
  email: PropTypes.string.isRequired,
  phone: PropTypes.string,
  widget_key: PropTypes.string,
  widget_id: PropTypes.string,
  metadata: PropTypes.object,
  merchant_key: PropTypes.string,
  user_ref: PropTypes.string,
  config_id: PropTypes.string,
  is_test: PropTypes.oneOfType([PropTypes.string, PropTypes.bool]),
  callback: PropTypes.func.isRequired
}

export default useIdentityPayKYC
