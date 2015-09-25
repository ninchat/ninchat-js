

<!-- Start doc/ninchatclient.js -->

Ninchat API connection library.

See: https://ninchat.com/api/v2

## NinchatClient.call(header, [onLog], [address])

Call the sessionless API.  The returned promise will be resolved with an
event header array as a parameter to the callback functions, or rejected on
connection error.  Note that "error" events are delivered via the Promise's
resolve callback, not via the reject callback like when using a Session.
The notify callback is not used.

See: https://ninchat.com/api/v2#sessionless-http-calling

### Params:

* **Object** *header* Action parameters to send.
* **Function** *[onLog]* Message logger.
* **String** *[address]* Alternative API endpoint.

### Return:

* **NinchatClient.Promise** 

## NinchatClient.newSession()

Create an uninitialized Session object.

### Return:

* **NinchatClient.Session** 

## NinchatClient.stringifyFrame(data)

Convert an event's payload part to a string.

### Params:

* **Object** *data* 

### Return:

* **String** 

## NinchatClient.Session

Session hides the details of API connection management.  It needs to be
initialized by calling at least the onSessionEvent, onEvent and
setParams methods.  After that the open method is used to make a
connection to the server.  Finally, the close method disconnects from
the server.

Session objects may be instantiated only via the newSession function.

## onSessionEvent(callback)

Set the session creation handler.  It will be invoked with a
"session_created" or an "error" event header as a parameter.

If another "session_created" event is received, it means that the
previous session was lost, and a new one was established automatically.

If an "error" event is received, it means that a new session can't be
established without intervention.  The client code must call setParams()
to supply new credentials, unless it decides to close().

### Params:

* **Function** *callback* 

## onEvent(callback)

Set the handler for in-session events. It will be invoked with an
event header and a payload array parameter.

"error" events received via this callback are not fatal.

### Params:

* **Function** *callback* 

## onConnState(callback)

Set an optional connection state change monitor.  It will be called with
one of the following strings:

- "connecting"
- "connected"
- "disconnected"

### Params:

* **Function** *callback* 

## onConnActive(callback)

Set an optional connection activity monitor.  It will be called with a
timestamp (in milliseconds) indicating the latest time when data was
received on the connection.

### Params:

* **Function** *callback* 

## onLog(callback)

Set an optional message logger.  It will be called with a single string
argument.

### Params:

* **Function** *callback* 

## setParams(params)

Set "create_session" action parameters.  If open() has already been
called, this takes effect when a session is lost.

### Params:

* **Object** *params* 

## setTransport(name)

Force a specific network transport implementation to be used.
Currently only "longpoll" may be specified.

### Params:

* **String** *name* 

## setAddress(address)

Use an alternative API endpoint.

### Params:

* **String** *address* 

## open()

Create a session on the server.

## close()

Close the session on the server.

## send(header, [payload])

Send an action.

To send an action without an "action_id" parameter, specify it as
null.  Otherwise an "action_id" is generated automatically.

If an "action_id" is used, a promise is returned.  It may be used to
wait for a reply from the server; the promise will be resolved with
an event header and a payload array parameter.  If the Session
object is closed before a reply is received, the promise will be
rejected without a parameter.

With specific actions that cause multiple reply events, the notify
callback will be called for each event until the final event which
resolves the promise.

### Params:

* **object** *header* Action parameters to send.
* **array** *[payload]* Consists of (already encoded) data                             frames.

### Return:

* **NinchatClient.Promise** 

## NinchatClient.Promise

Promise objects may not be instantiated directly.

## then([resolve], [reject], [notify])

Add callback(s) to be called when the promise is resolved, updated
(notify) or rejected.

Promise objects may not be instantiated directly.

### Params:

* **Function** *[resolve]* 
* **Function** *[reject]* 
* **Function** *[notify]* 

<!-- End doc/ninchatclient.js -->

