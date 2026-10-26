# react-identity-kyc

>IdentityPass ReactJS Verification library

>INTRODUCING PREMBLY 2.0

[![NPM](https://img.shields.io/npm/v/react-identity-kyc.svg)](https://www.npmjs.com/package/react-identity-kyc) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

## Install

```bash
npm install --save react-identity-kyc
```

## Usage

```jsx
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
```

Legacy `merchant_key`, `config_id`, `user_ref`, and `is_test` values are still forwarded for older widgets. New integrations should use `widget_key` and `widget_id` from the Prembly dashboard.


```jsx
RESPONSES

1. Failed response:
         {
          code: "E01",
          message: "Message goes here",
          status: "failed"
      }
      
 2. Cancelled
      {
          code: "E02",
          message: "Verification Canceled",
          status: "failed"
      } 
 3. Success
        {
          code: "00",
          status: "success",
          message: "Verification Successful",
          data:{
              //Verification data goes here
              // kindly check official documentation for data structure for each channel
              //https://developer.myidentitypass.com
              },
          channel:"Channel goes here", e.g BVN,NIN and many more

      }
 ```      

## Workflows

Start one of your compliance workflows from your page. The library creates the session with your **public** key and shows the workflow in a full-screen layer.

```jsx
import { usePremblyWorkflow } from 'react-identity-kyc'

const App = () => {
  const startWorkflow = usePremblyWorkflow({
    publishableKey: 'test_pk_...', // never a secret key
    workflowId: 'wf_123',
    customer: { firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
    onEvent: (event) => console.log(event.type),
    callback: (result) => {
      // completed | failed | manual_review | expired | processing | cancelled
      // or failed with result.errorCode if it could not start
      console.log(result.status)
    }
  })

  return <button onClick={startWorkflow}>Verify</button>
}
```

Outside React, call `startWorkflow(options)` (also exported) and keep the returned `{ close }`.

| Option | Required | Description |
|---|---|---|
| `publishableKey` | Yes | `live_pk_...` or `test_pk_...`. A secret key is refused |
| `workflowId` | Yes | The workflow to run |
| `customer` | Yes | `{ firstName, lastName, email, phone?, reference? }` |
| `callback` | Yes | Called once when the flow ends. `processing` means the checks carry on in the background |
| `metadata`, `redirectUrl`, `baseUrl` | No | Extra session data, a redirect, a server override |
| `onEvent` | No | `{ type, sessionId, nodeId? }` for every event. No personal data |
| `collectDeviceData` | No | Give the widget this site's device ID. **On by default** |

### What the device option does

The library keeps a random device ID in the browser's storage on **your** site, created the first time it is needed. When the workflow widget asks for it, the library answers with that ID and the library version, and nothing else. It is sent only to the widget's own page (a message to its exact origin), only when the widget asks, and never in a URL.

Inside an embedded widget the browser keeps the widget's storage apart per site, so the widget's own ID cannot follow a customer from one visit or page to the next as reliably as an ID on your site can. The widget reports the ID as `web_first_party`: the web page can say anything, so Prembly treats it as asserted, not verified. Set `collectDeviceData: false` to leave it out; the widget then uses its own.

## License

MIT © [kayode001(Kayode Olayiwola)](https://github.com/kayode001)
"# react-identity-kyc"
