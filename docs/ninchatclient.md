

<!-- Start docs/ninchatclient.js -->

Ninchat API connection library.

See: https://ninchat.com/api/v2

## NinchatClient.defaultXUserAgent

The default X-User-Agent string.

## NinchatClient.newCaller()

Create a [Caller](#caller) object.

### Return:

* **Caller** 

## NinchatClient.call(params, [onLog], [address])

Call the sessionless API.  The returned [Promise](#promise) will be
resolved with an event header array as a parameter to the callback
function, or rejected on connection error.  Note that `error` events are
delivered via the promise's resolve callback, not via the reject
callback like when using a Session.  The notify callback is not used.

See: https://ninchat.com/api/v2#sessionless-http-calling

### Params:

* **Object** *params* Action parameters to send.
* **Function** *[onLog]* Message logger.
* **String** *[address]* Alternative API endpoint.

### Return:

* **Promise** 

## NinchatClient.newSession()

Create an uninitialized [Session](#session) object.

### Return:

* **Session** 

## NinchatClient.stringifyFrame(data)

Convert an event's payload part to a string.

### Params:

* **Object** *data* 

### Return:

* **String** 

## Caller

Caller holds optional configuration for sessionless API calls.

Caller objects may be instantiated only via the newCaller function.

## Caller.onLog(callback)

Set an optional message logger.  It will be called with a single string
argument.

### Params:

* **Function** *callback* 

## Caller.setHeader(key, value)

Set an HTTP header.  The key must be in canonical (Title-Case) format.

See: https://golang.org/pkg/net/http/#CanonicalHeaderKey

### Params:

* **String** *key* 
* **String** *value* 

## Caller.setAddress(address)

Use an alternative API endpoint.

### Params:

* **String** *address* 

## Caller.call(params)

Call the sessionless API.  The returned [Promise](#promise) will be
resolved with an event header array as a parameter to the callback
function, or rejected on connection error.  Note that `error` events are
delivered via the promise's resolve callback, not via the reject
callback like when using a Session.  The notify callback is not used.

See: https://ninchat.com/api/v2#sessionless-http-calling

### Params:

* **Object** *params* Action parameters to send.

### Return:

* **Promise** 

## Session

Session hides the details of API connection management.  It needs to be
initialized by calling at least the onSessionEvent, onEvent and
setParams methods.  After that the open method is used to make a
connection to the server.  Finally, the close method disconnects from
the server.

Session objects may be instantiated only via the newSession function.

## Session.onSessionEvent(callback)

Set the session creation handler.  It will be invoked with a
`session_created` or an `error` event header as a parameter.

If another `session_created` event is received, it means that the
previous session was lost, and a new one was established automatically.

If an `error` event is received, it means that a new session can't be
established without intervention.  The client code must call setParams()
to supply new credentials, unless it decides to close().

### Params:

* **Function** *callback* 

## Session.onEvent(callback)

Set the handler for in-session events.  It will be invoked with an event
header and a payload array parameter.

`error` events received via this callback are not fatal.

### Params:

* **Function** *callback* 

## Session.onClose(callback)

Set an optional session closure handler.  It doesn't take any
parameters.

It will be invoked after a close() call has been fully processed.  It
won't be invoked if an `error` event is received via onSessionEvent
(unless setParams is called again).

### Params:

* **Function** *callback* 

## Session.onConnState(callback)

Set an optional connection state change monitor.  It will be called with
one of the following strings:

- `connecting`
- `connected`
- `disconnected`

### Params:

* **Function** *callback* 

## Session.onConnActive(callback)

Set an optional connection activity monitor.  It will be called with a
timestamp (in milliseconds) indicating the latest time when data was
received on the connection.

### Params:

* **Function** *callback* 

## Session.onLog(callback)

Set an optional message logger.  It will be called with a single string
argument.

### Params:

* **Function** *callback* 

## Session.setParams(params)

Set `create_session` action parameters.  If open() has already been
called, this takes effect when a session is lost.

### Params:

* **Object** *params* Initial action parameters.

## Session.setHeader(key, value)

Set an HTTP header.  The key must be in canonical (Title-Case) format.

See: https://golang.org/pkg/net/http/#CanonicalHeaderKey

### Params:

* **String** *key* 
* **String** *value* 

## Session.setAddress(address)

Use an alternative API endpoint.

### Params:

* **String** *address* 

## Session.open()

Create a session on the server.

## Session.close()

Close the session on the server.

## Session.send(params, [payload])

Send an action.

An `action_id` sequence number is generated automatically; it must not
be specified explicitly.  To send an action without an `action_id`
parameter, specify it as null (the only valid value).

If an `action_id` is generated (the default), a [Promise](#promise) is
returned.  It may be used to wait for a reply from the server; the
promise will be resolved with an event header and a payload array
parameter.  If the Session object is closed before a reply is received,
the promise will be rejected without a parameter.

With specific actions that cause multiple reply events, the notify
callback will be called for each event until the final event which
resolves the promise.

### Params:

* **Object** *params* Action parameters to send.
* **Array** *[payload]* Consists of (already encoded) data                             frames.

### Return:

* **Promise|Null** 

## Promise

Promise objects may not be instantiated directly.

## Promise.then([onFulfilled], [onRejected], [onNotified])

Add callback to be called when the promise is resolved, rejected and/or
updated.

### Params:

* **Function** *[onFulfilled]* 
* **Function** *[onRejected]* 
* **Function** *[onNotified]* 

### Return:

* **Promise** 

<!-- End docs/ninchatclient.js -->

