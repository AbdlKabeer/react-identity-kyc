import React from 'react'

import useIdentityPayKYC from 'react-identity-kyc'

const App = () => {
  const config = {
    first_name: 'John',
    last_name: 'Doe',
    email: 'john@example.com',
    phone: '+2348012345678',
    widget_key: 'your_widget_key_here',
    widget_id: 'your_widget_id_here',
    metadata: {
      transaction_id: 'txn_123'
    },
    callback: (response) => console.log(response)
  }
  const verifyWithIdentity = useIdentityPayKYC(config)

  return <button onClick={verifyWithIdentity}>Click to Test</button>
}
export default App
