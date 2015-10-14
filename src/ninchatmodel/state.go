package main

import (
	"github.com/gopherjs/gopherjs/js"
	"github.com/ninchat/ninchat-go"
	api "github.com/ninchat/ninchat-go/ninchatapi"
	model "github.com/ninchat/ninchat-go/ninchatmodel"

	"ninchatclient/lib"
)

func invoke(adapter *clientlib.SessionAdapter, logPrefix string, callback *js.Object, args ...interface{}) {
	defer func() {
		adapter.OnPanic(logPrefix, recover())
	}()

	callback.Invoke(args...)
}

// Create an uninitialized [State](#state) object.
//
// @return {State}
//
// @function NinchatModel.newState
//
func newState() js.M {
	state := new(model.State)
	adapter := clientlib.NewSessionAdapter(&state.Session)

	// State needs to be initialized by calling at least the Self.onChange,
	// Settings.onChange, Users.onChange, Dialogues.onChange,
	// Dialogues.Messages.onReceive, Dialogues.Messages.onUpdate and setParams
	// methods.  After that the open method is used to create a session.
	// Finally, the close method may be used to close the session.
	//
	// State objects may be created via the NinchatModel.newState function.
	//
	// @class State
	//
	return js.M{

		"Self": js.M{

			// @param {Function} callback
			//
			// @type method
			//
			// @method State.Self.onChange
			//
			"onChange": func(callback *js.Object) {
				state.Self.OnChange = func(c model.Change, u *model.User, auth string) {
					invoke(adapter, "State.Self.onChange callback:", callback, c, wrapUser(u), auth)
				}
			},

			// @return {User}
			//
			// @type method
			//
			// @method State.Self.getUser
			//
			"getUser": func() *js.Object {
				return wrapUser(&state.Self.User)
			},
		},

		"Settings": js.M{

			// @param {Function} callback
			//
			// @type method
			//
			// @method State.Settings.onChange
			//
			"onChange": func(callback *js.Object) {
				state.Settings.OnChange = func(c model.Change, s map[string]interface{}) {
					invoke(adapter, "State.Settings.onChange callback:", callback, c, s)
				}
			},

			// @return {Object}
			//
			// @type method
			//
			// @method State.Settings.get
			//
			"get": func() js.M {
				return state.Settings.Data
			},
		},

		"Users": js.M{

			// @param {Function} callback
			//
			// @type method
			//
			// @method State.Users.onChange
			//
			"onChange": func(callback *js.Object) {
				state.Users.OnChange = func(c model.Change, u *model.User) {
					invoke(adapter, "State.Users.onChange callback:", callback, c, wrapUser(u))
				}
			},

			// @param {String} id
			//
			// @return {User|Null}
			//
			// @type method
			//
			// @method State.Users.get
			//
			"get": func(id string) *js.Object {
				return wrapUser(state.Users.Map[id])
			},
		},

		"Dialogues": js.M{

			// @see MessageState
			//
			// @name State.Dialogues.Messages
			//
			"Messages": wrapMessageState(adapter, &state.Dialogues.Messages),

			// @param {Function} callback
			//
			// @type method
			//
			// @method State.Dialogues.onChange
			//
			"onChange": func(callback *js.Object) {
				state.Dialogues.OnChange = func(c model.Change, d *model.Dialogue) {
					invoke(adapter, "State.Dialogues.onChange callback:", callback, c, wrapDialogue(d))
				}
			},

			// @param {String} peerId
			//
			// @return {Dialogue|Null}
			//
			// @type method
			//
			// @method State.Dialogues.get
			//
			"get": func(peerId string) interface{} {
				return wrapDialogue(state.Dialogues.Map[peerId])
			},

			// @see [`Promise`](ninchatclient.md#promise) of NinchatClient
			//
			// @param {String} peerId
			//
			// @return {Promise}
			//
			// @type method
			//
			// @method State.Dialogues.loadEarlier
			//
			"loadEarlier": func(peerId string) *js.Object {
				loading := state.Dialogues.LoadEarlier(peerId)

				p := &clientlib.Promise{
					OnPanic: adapter.OnPanic,
				}

				go func() {
					if err := <-loading; err == nil {
						p.Resolve(peerId)
					} else {
						p.Reject(peerId, err)
					}
				}()

				return p.Object()
			},

			// @param {String} peerId
			// @param {String} status
			//
			// @return {Boolean}
			//
			// @type method
			//
			// @method State.Dialogues.updateStatus
			//
			"updateStatus": func(peerId, status string) (found bool) {
				d, found := state.Dialogues.Map[peerId]
				if found {
					state.Dialogues.UpdateStatus(d, status)
				}
				return
			},

			// @param {String} peerId
			//
			// @return {Boolean}
			//
			// @type method
			//
			// @method State.Dialogues.activate
			//
			"activate": func(peerId string) (found bool) {
				d, found := state.Dialogues.Map[peerId]
				if found {
					state.Dialogues.Activate(d)
				}
				return
			},

			// @param {String} peerId
			//
			// @return {Boolean}
			//
			// @type method
			//
			// @method State.Dialogues.discard
			//
			"discard": func(peerId string) (found bool) {
				d, found := state.Dialogues.Map[peerId]
				if found {
					state.Dialogues.Discard(d)
				}
				return
			},
		},

		// @see [`Session.onSessionEvent`](ninchatclient.md#sessiononsessioneventcallback)
		//
		// @param {Function} callback
		//
		// @type method
		//
		// @method State.onSessionEvent
		//
		"onSessionEvent": func(callback *js.Object) {
			state.OnSessionEvent = func(e *ninchat.Event) {
				adapter.InvokeOnSessionEvent("State.onSessionEvent callback:", callback, e)
			}
		},

		// @see [`Session.onEvent`](ninchatclient.md#sessiononeventcallback)
		//
		// @param {Function} callback
		//
		// @type method
		//
		// @method State.onEvent
		//
		"onEvent": func(callback *js.Object) {
			state.OnEvent = func(e *ninchat.Event) {
				adapter.InvokeOnEvent("State.onEvent callback:", callback, e)
			}
		},

		// @see [`Session.onClose`](ninchatclient.md#sessiononclosecallback)
		//
		// @param {Function} callback
		//
		// @type method
		//
		// @method State.onClose
		//
		"onClose": state.OnClose,

		// @see [`Session.onConnState`](ninchatclient.md#sessiononconnstatecallback)
		//
		// @param {Function} callback
		//
		// @type method
		//
		// @method State.onConnState
		//
		"onConnState": adapter.OnConnState,

		// @see [`Session.onConnActive`](ninchatclient.md#sessiononconnactivecallback)
		//
		// @param {Function} callback
		//
		// @type method
		//
		// @method State.onConnActive
		//
		"onConnActive": adapter.OnConnActive,

		// @see [`Session.onLog`](ninchatclient.md#sessiononlogcallback)
		//
		// @param {Function} callback
		//
		// @type method
		//
		// @method State.onLog
		//
		"onLog": adapter.OnLog,

		// @see [`Session.setParams`](ninchatclient.md#sessionsetparamsparams)
		//
		// @param {Object} params
		//
		// @type method
		//
		// @method State.setParams
		//
		"setParams": state.SetParams,

		// @see [`Session.setTransport`](ninchatclient.md#sessionsettransportname)
		//
		// @param {String} name
		//
		// @type method
		//
		// @method State.setTransport
		//
		"setTransport": state.SetTransport,

		// @see [`Session.setAddress`](ninchatclient.md#sessionsetaddressaddress)
		//
		// @param {String} address
		//
		// @type method
		//
		// @method State.setAddress
		//
		"setAddress": adapter.SetAddress,

		// @see [`Promise`](ninchatclient.md#promise) of NinchatClient
		//
		// @return {Promise}
		//
		// @type method
		//
		// @method State.open
		//
		"open": func() *js.Object {
			p := &clientlib.Promise{
				OnPanic: adapter.OnPanic,
			}

			go func() {
				if err := state.Open(); err == nil {
					p.Resolve()
				} else {
					p.Reject(err)
				}
			}()

			return p.Object()
		},

		// @see [`Session.close`](ninchatclient.md#sessionclose)
		//
		// @type method
		//
		// @method State.close
		//
		"close": state.Close,

		// @see [`Session.send`](ninchatclient.md#sessionsendheader-payload)
		//
		// @param {Object} header
		// @param {Array}  [payload]
		//
		// @return {Promise|Null}
		//
		// @type method
		//
		// @method State.send
		//
		"send": adapter.Send,
	}
}

// @class MessageState
//
func wrapMessageState(adapter *clientlib.SessionAdapter, state *model.MessageState) js.M {
	return js.M{

		// @param {Function} callback
		//
		// @type method
		//
		// @method MessageState.onReceive
		//
		"onReceive": func(callback *js.Object) {
			state.OnReceive = func(targetId string, e *api.MessageReceived) {
				invoke(adapter, "MessageState.onReceive callback:", callback, targetId, e)
			}
		},

		// @param {Function} callback
		//
		// @type method
		//
		// @method MessageState.onUpdate
		//
		"onUpdate": func(callback *js.Object) {
			state.OnUpdate = func(targetId string, e *api.MessageUpdated) {
				invoke(adapter, "MessageState.onUpdate callback:", callback, targetId, e)
			}
		},
	}
}

// Properties:
//
// - Id (String)
//
// @class User
//
func wrapUser(u *model.User) (o *js.Object) {
	if u != nil {
		o = js.Global.Get("Object").New()
		o.Set("Id", u.Id)

		// @see https://godoc.org/github.com/ninchat/ninchat-go/ninchatapi#UserAttrs
		//
		// @return {UserAttrs}
		//
		// @type method
		//
		// @method User.getAttrs
		//
		o.Set("getAttrs", func() *api.UserAttrs {
			return u.Attrs
		})

		// @param {Any} key
		//
		// @return {Any}
		//
		// @type method
		//
		// @method User.getAux
		//
		o.Set("getAux", u.GetAux)

		// @param {Any} key
		// @param {Any} value
		//
		// @type method
		//
		// @method User.setAux
		//
		o.Set("setAux", u.SetAux)
	}
	return
}

// Properties:
//
// - PeerId (String)
// - Window (MessageWindow)
//
// @class Dialogue
//
func wrapDialogue(d *model.Dialogue) (o *js.Object) {
	if d != nil {
		o = js.Global.Get("Object").New()
		o.Set("PeerId", d.PeerId)
		o.Set("Window", jsMakeWrapper(&d.Window))

		// @return {String}
		//
		// @type method
		//
		// @method Dialogue.getStatus
		//
		o.Set("getStatus", func() string {
			return d.Status
		})

		// @see https://godoc.org/github.com/ninchat/ninchat-go/ninchatapi#DialogueMemberAttrs
		//
		// @return {DialogueMemberAttrs}
		//
		// @type method
		//
		// @method Dialogue.getSelfMemberAttrs
		//
		o.Set("getSelfMemberAttrs", func() *api.DialogueMemberAttrs {
			return d.SelfMemberAttrs
		})

		// @see https://godoc.org/github.com/ninchat/ninchat-go/ninchatapi#DialogueMemberAttrs
		//
		// @return {DialogueMemberAttrs}
		//
		// @type method
		//
		// @method Dialogue.getPeerMemberAttrs
		//
		o.Set("getPeerMemberAttrs", func() *api.DialogueMemberAttrs {
			return d.PeerMemberAttrs
		})

		// @return {Object}
		//
		// @type method
		//
		// @method Dialogue.getAudienceMetadata
		//
		o.Set("getAudienceMetadata", func() map[string]interface{} {
			return d.AudienceMetadata
		})
	}
	return
}

// @see https://godoc.org/github.com/ninchat/ninchat-go/ninchatmodel#MessageWindow
//
// @class MessageWindow
//
