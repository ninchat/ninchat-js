

<!-- Start doc/ninchatmodel.js -->

## NinchatModel.call(header, [onLog], [address])

See: [`NinchatClient.call`](ninchatclient.md#ninchatclientcallheader-onlog-address)

### Params:

* **Object** *header* 
* **Function** *[onLog]* 
* **String** *[address]* 

### Return:

* **Promise** 

## NinchatModel.newSession()

See: [`NinchatClient.newSession`](ninchatclient.md#ninchatclientnewsession)

### Return:

* **Session** 

## NinchatModel.stringifyFrame(data)

See: [`NinchatClient.stringifyFrame`](ninchatclient.md#ninchatclientstringifyframedata)

### Params:

* **Object** *data* 

### Return:

* **String** 

## NinchatModel.newState()

Create an uninitialized [State](#state) object.

### Return:

* **State** 

## State

State needs to be initialized by calling at least the Self.onChange,
Settings.onChange, Users.onChange, Dialogues.onChange,
Dialogues.Messages.onReceive, Dialogues.Messages.onUpdate and setParams
methods.  After that the open method is used to create a session.
Finally, the close method may be used to close the session.

State objects may be created via the NinchatModel.newState function.

## State.Self.onChange(callback)

### Params:

* **Function** *callback* 

## State.Self.getUser()

### Return:

* **User** 

## State.Settings.onChange(callback)

### Params:

* **Function** *callback* 

## State.Settings.get()

### Return:

* **Object** 

## State.Users.onChange(callback)

### Params:

* **Function** *callback* 

## State.Users.get(id)

### Params:

* **String** *id* 

### Return:

* **User|Null** 

## State.Dialogues.Messages

See: MessageState

## State.Dialogues.onChange(callback)

### Params:

* **Function** *callback* 

## State.Dialogues.get(peerId)

### Params:

* **String** *peerId* 

### Return:

* **Dialogue|Null** 

## State.Dialogues.loadEarlier(peerId)

See: [`Promise`](ninchatclient.md#promise) of NinchatClient

### Params:

* **String** *peerId* 

### Return:

* **Promise** 

## State.Dialogues.updateStatus(peerId, status)

### Params:

* **String** *peerId* 
* **String** *status* 

### Return:

* **Boolean** 

## State.Dialogues.activate(peerId)

### Params:

* **String** *peerId* 

### Return:

* **Boolean** 

## State.Dialogues.discard(peerId)

### Params:

* **String** *peerId* 

### Return:

* **Boolean** 

## State.onSessionEvent(callback)

See: [`Session.onSessionEvent`](ninchatclient.md#sessiononsessioneventcallback)

### Params:

* **Function** *callback* 

## State.onEvent(callback)

See: [`Session.onEvent`](ninchatclient.md#sessiononeventcallback)

### Params:

* **Function** *callback* 

## State.onClose(callback)

See: [`Session.onClose`](ninchatclient.md#sessiononclosecallback)

### Params:

* **Function** *callback* 

## State.onConnState(callback)

See: [`Session.onConnState`](ninchatclient.md#sessiononconnstatecallback)

### Params:

* **Function** *callback* 

## State.onConnActive(callback)

See: [`Session.onConnActive`](ninchatclient.md#sessiononconnactivecallback)

### Params:

* **Function** *callback* 

## State.onLog(callback)

See: [`Session.onLog`](ninchatclient.md#sessiononlogcallback)

### Params:

* **Function** *callback* 

## State.setParams(params)

See: [`Session.setParams`](ninchatclient.md#sessionsetparamsparams)

### Params:

* **Object** *params* 

## State.setTransport(name)

See: [`Session.setTransport`](ninchatclient.md#sessionsettransportname)

### Params:

* **String** *name* 

## State.setAddress(address)

See: [`Session.setAddress`](ninchatclient.md#sessionsetaddressaddress)

### Params:

* **String** *address* 

## State.open()

See: [`Promise`](ninchatclient.md#promise) of NinchatClient

### Return:

* **Promise** 

## State.close()

See: [`Session.close`](ninchatclient.md#sessionclose)

## State.send(header, [payload])

See: [`Session.send`](ninchatclient.md#sessionsendheader-payload)

### Params:

* **Object** *header* 
* **Array** *[payload]* 

### Return:

* **Promise|Null** 

## MessageState

## MessageState.onReceive(callback)

### Params:

* **Function** *callback* 

## MessageState.onUpdate(callback)

### Params:

* **Function** *callback* 

## User

Properties:

- Id (String)

## User.getAttrs()

See: https://godoc.org/github.com/ninchat/ninchat-go/ninchatapi#UserAttrs

### Return:

* **UserAttrs** 

## User.getAux(key)

### Params:

* **Any** *key* 

### Return:

* **Any** 

## User.setAux(key, value)

### Params:

* **Any** *key* 
* **Any** *value* 

## Dialogue

Properties:

- PeerId (String)
- Window (MessageWindow)

## Dialogue.getStatus()

### Return:

* **String** 

## Dialogue.getSelfMemberAttrs()

See: https://godoc.org/github.com/ninchat/ninchat-go/ninchatapi#DialogueMemberAttrs

### Return:

* **DialogueMemberAttrs** 

## Dialogue.getPeerMemberAttrs()

See: https://godoc.org/github.com/ninchat/ninchat-go/ninchatapi#DialogueMemberAttrs

### Return:

* **DialogueMemberAttrs** 

## Dialogue.getAudienceMetadata()

### Return:

* **Object** 

## MessageWindow

See: https://godoc.org/github.com/ninchat/ninchat-go/ninchatmodel#MessageWindow

<!-- End doc/ninchatmodel.js -->

