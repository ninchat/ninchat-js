package clientlib

import (
	"github.com/gopherjs/gopherjs/js"
	"github.com/ninchat/ninchat-go"
)

type SessionAdapter struct {
	Session *ninchat.Session
	OnPanic func(string, interface{})
}

func NewSessionAdapter(session *ninchat.Session) *SessionAdapter {
	return &SessionAdapter{
		Session: session,
		OnPanic: Panicer(func() func(string) {
			return func(msg string) {
				if session.OnLog != nil {
					session.OnLog(msg)
				}
			}
		}),
	}
}

func (adapter *SessionAdapter) InvokeOnSessionEvent(logPrefix string, callback *js.Object, e *ninchat.Event) {
	defer func() {
		adapter.OnPanic(logPrefix, recover())
	}()

	callback.Invoke(e.Params)
}

func (adapter *SessionAdapter) OnSessionEvent(callback *js.Object) {
	adapter.Session.OnSessionEvent = func(e *ninchat.Event) {
		adapter.InvokeOnSessionEvent("Session.onSessionEvent callback:", callback, e)
	}
}

func (adapter *SessionAdapter) InvokeOnEvent(logPrefix string, callback *js.Object, e *ninchat.Event) {
	defer func() {
		adapter.OnPanic(logPrefix, recover())
	}()

	callback.Invoke(e.Params, UnwrapPayload(e.Payload))
}

func (adapter *SessionAdapter) OnEvent(callback *js.Object) {
	adapter.Session.OnEvent = func(e *ninchat.Event) {
		adapter.InvokeOnEvent("Session.onEvent callback:", callback, e)
	}
}

func (adapter *SessionAdapter) OnClose(callback *js.Object) {
	adapter.Session.OnClose = func() {
		defer func() {
			adapter.OnPanic("Session.onClose callback:", recover())
		}()

		callback.Invoke()
	}
}

func (adapter *SessionAdapter) OnConnState(callback *js.Object) {
	if callback == nil {
		adapter.Session.OnConnState = nil
		return
	}

	adapter.Session.OnConnState = func(state string) {
		defer func() {
			adapter.OnPanic("Session.onConnState callback:", recover())
		}()

		callback.Invoke(state)
	}
}

func (adapter *SessionAdapter) OnConnActive(callback *js.Object) {
	if callback == nil {
		adapter.Session.OnConnActive = nil
		return
	}

	adapter.Session.OnConnActive = func() {
		defer func() {
			adapter.OnPanic("Session.onConnActive callback:", recover())
		}()

		callback.Invoke(js.Global.Get("Date").New().Call("getTime"))
	}
}

func (adapter *SessionAdapter) OnLog(callback *js.Object) {
	if callback == nil {
		adapter.Session.OnLog = nil
		return
	}

	adapter.Session.OnLog = func(tokens ...interface{}) {
		defer func() {
			recover()
		}()

		message := ""

		for _, x := range tokens {
			var str string

			switch t := x.(type) {
			case string:
				str = t

			case error:
				str = t.Error()

			default:
				str = js.Global.Get("JSON").Call("stringify", t).String()
			}

			if len(message) > 0 {
				message += " "
			}

			message += str
		}

		for len(message) > 0 && message[len(message)-1] == ' ' {
			message = message[:len(message)-1]
		}

		callback.Invoke(message)
	}
}

func (adapter *SessionAdapter) SetAddress(value string) {
	adapter.Session.Address = value
}

func (adapter *SessionAdapter) Send(params map[string]interface{}, payload *js.Object) (result *js.Object) {
	action := &ninchat.Action{
		Params:  params,
		Payload: WrapPayload(payload),
	}

	if _, disabled := params["action_id"]; !disabled {
		p := &Promise{
			OnPanic: adapter.OnPanic,
		}

		action.OnReply = p.OnReply
		result = p.Object()
	}

	adapter.Session.Send(action)
	return
}

func newSession() map[string]interface{} {
	session := new(ninchat.Session)
	adapter := NewSessionAdapter(session)

	return map[string]interface{}{
		"onSessionEvent": adapter.OnSessionEvent,
		"onEvent":        adapter.OnEvent,
		"onClose":        adapter.OnClose,
		"onConnState":    adapter.OnConnState,
		"onConnActive":   adapter.OnConnActive,
		"onLog":          adapter.OnLog,
		"setParams":      session.SetParams,
		"setTransport":   setTransport,
		"setAddress":     adapter.SetAddress,
		"open":           session.Open,
		"close":          session.Close,
		"send":           adapter.Send,
	}
}

func setTransport(string) {
	println("NinchatClient.Session.setTransport doesn't do anything anymore")
}
