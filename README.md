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

Start one of your compliance workflows from your page. The library creates the session with your **public** key and shows the workflow in a full-screen layer, with a loading message while the session is created. It is the same session and the same results as the React Native SDK's `PremblyWorkflow`.

As a component (the same shape as React Native):

```jsx
import { PremblyWorkflow } from 'react-identity-kyc'

const App = () => {
  const [isVisible, setIsVisible] = useState(false)
  return (
    <>
      <button onClick={() => setIsVisible(true)}>Verify</button>
      <PremblyWorkflow
        isVisible={isVisible}
        publishableKey='test_pk_...' // never a secret key
        workflowId='wf_123'
        customer={{ firstName: 'John', lastName: 'Doe', email: 'john@example.com' }}
        // Optional: an ID you already have, so they skip the ID screen
        prefill={{ bvn: '22212345678' }}
        onEvent={(event) => console.log(event.type)}
        callback={(result) => {
          // completed | failed | manual_review | expired | cancelled,
          // or failed with result.error = { code, message } if it could not start
          setIsVisible(false)
        }}
      />
    </>
  )
}
```

Or as a hook, which returns a function that starts it:

```jsx
import { usePremblyWorkflow } from 'react-identity-kyc'

const start = usePremblyWorkflow({ publishableKey: 'test_pk_...', workflowId: 'wf_123', customer, callback })
return <button onClick={start}>Verify</button>
```

Outside React, call `startWorkflow(options)` (also exported) and keep the returned `{ close }`.

| Option | Required | Description |
|---|---|---|
| `isVisible` | Component only | Opens the workflow when true, closes it when false |
| `publishableKey` | Yes | `live_pk_...` or `test_pk_...`. A secret key is refused |
| `workflowId` | Yes | The workflow to run |
| `customer` | Yes | `{ firstName, lastName, email, phone?, reference? }` |
| `callback` | Yes | Called once when the flow ends. See below |
| `prefill` | No | `{ nin?, bvn?, passport?, driversLicense?, votersCard? }`: an ID you already have, **exactly one**. The person skips the ID screen |
| `metadata`, `redirectUrl`, `baseUrl` | No | Extra session data, a redirect, a server override |
| `hostedUrl` | No | Open this hosted app as `<hostedUrl>?session=<id>` instead of the returned link. For testing a local or staging build |
| `onEvent` | No | `{ type, sessionId, nodeId? }` for every event. No personal data |
| `collectDeviceData` | No | Give the widget this site's device ID. **On by default** |

### The result

| `result.status` | Meaning |
|---|---|
| `completed`, `failed`, `manual_review`, `expired` | The workflow reached an end state. `result.sessionId` is set |
| `cancelled` | Closed before an end state: the close button, the widget's own Cancel, or `close()`. `result.lastEvent` is the last event seen; `processing` means the person finished and the checks carry on in the background |
| `failed` with `result.error` | It could not start. `error.code` is one of `invalid_key`, `invalid_request`, `unauthorised`, `not_found`, `rate_limited`, `server_error`, `network_error`, `timeout`, `not_available` |

### Prefill an ID

If you already know the person's ID, pass it and they skip the ID screen and go straight to their next step (for example the selfie). It is sent in the session's `metadata`, so whoever can read what the page sends could change it. When the ID must not be changeable, create the session from your server with a secret key instead.

### What the device option does

The library keeps a random device ID in the browser's storage on **your** site (or a cookie when storage is blocked), created the first time it is needed. Transaction Monitoring below uses the same ID. When the workflow widget asks for it, the library answers with that ID and the library version, and nothing else. It is sent only to the widget's own page (a message to its exact origin), only when the widget asks, and never in a URL.

Inside an embedded widget the browser keeps the widget's storage apart per site, so the widget's own ID cannot follow a customer from one visit or page to the next as reliably as an ID on your site can. The widget reports the ID as `web_first_party`: the web page can say anything, so Prembly treats it as asserted, not verified. Set `collectDeviceData: false` to leave it out; the widget then uses its own.

## Transaction Monitoring

`PremblyTM` collects the browser's device signals and creates a device session. It is the same API as the React Native SDK's `PremblyTM`. Send `deviceSessionId` to your backend with the transaction and pass it as `device_session_id` when you screen with your secret key.

```js
import { PremblyTM } from 'react-identity-kyc'

// Once, when the app loads. A bad key throws here; nothing after this does.
PremblyTM.init({ publishableKey: 'test_pk_...' })

// When the customer signs in (null when they sign out)
PremblyTM.identify('customer_123')

// Before a sensitive action: sign-in, payment, adding a beneficiary
const { deviceSessionId, error } = await PremblyTM.getDeviceSession()
// deviceSessionId is null when no session could be created: screen without it, never block the payment
```

| Method | Description |
|---|---|
| `init({ publishableKey, baseUrl?, location?, timeoutMs?, debug? })` | Set up once. `location` is off by default (see below). `timeoutMs` defaults to 5000 |
| `identify(customerId \| null)` | The customer using the site |
| `getDeviceSession({ forceRefresh? })` | `{ deviceSessionId, deviceId, isKnownDevice?, expiresAt?, error? }`. Reused until shortly before it expires. Never throws |
| `setLocationEnabled(enabled)` | Turn location on or off when the person changes their consent |
| `getDeviceId()` | This site's device ID |
| `getSignalsPreview()` | The signals that would be sent, without sending anything |
| `reset()` | Forget the customer and the cached session (sign-out) |

`error` is one of `not_initialised`, `timeout`, `network_error`, `unauthorised`, `rate_limited`, `rejected`, `server_error`, `native_error` (the signals could not be read, for example during server rendering).

**What is collected:** the device type, OS and browser with their versions, model (where the browser tells it), locale, time zone, screen size, CPU cores and memory; whether the browser is automated; the connection type. Anything the browser does not give is left out, never guessed. **Location** is sent only when you turn it on and the site already has the browser's location permission; the SDK never asks the person for it.

**Allow-list:** the request carries your site's origin as `X-App-Id`. If your organisation lists apps for Transaction Monitoring, add your site's origin with the platform `web`.

## License

MIT © [kayode001(Kayode Olayiwola)](https://github.com/kayode001)
"# react-identity-kyc"
