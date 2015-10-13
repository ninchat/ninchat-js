package main

import (
	"github.com/gopherjs/gopherjs/js"
	"github.com/ninchat/ninchat-go"
)

func newSession() map[string]interface{} {
	s := &ninchat.Session{}

	onPanic := func(prefix string, x interface{}) {
		if x != nil && s.OnLog != nil {
			var msg string

			switch t := x.(type) {
			case string:
				msg = t

			case error:
				msg = t.Error()

			default:
				msg = js.Global.Get("JSON").Call("stringify", t).String()
			}

			s.OnLog(prefix, msg)
		}
	}

	return map[string]interface{}{
		"onSessionEvent": func(onSessionEvent *js.Object) {
			s.OnSessionEvent = func(e *ninchat.Event) {
				defer func() {
					onPanic("Session onSessionEvent callback:", recover())
				}()

				onSessionEvent.Invoke(e.Params)
			}
		},

		"onEvent": func(onEvent *js.Object) {
			s.OnEvent = func(e *ninchat.Event) {
				defer func() {
					onPanic("Session onEvent callback:", recover())
				}()

				onEvent.Invoke(e.Params, unwrapPayload(e.Payload))
			}
		},

		"onConnState": func(onConnState *js.Object) {
			if onConnState == nil {
				s.OnConnState = nil
				return
			}

			s.OnConnState = func(state string) {
				defer func() {
					onPanic("Session onConnState callback:", recover())
				}()

				onConnState.Invoke(state)
			}
		},

		"onConnActive": func(onConnActive *js.Object) {
			if onConnActive == nil {
				s.OnConnActive = nil
				return
			}

			s.OnConnActive = func() {
				defer func() {
					onPanic("Session onConnActive callback:", recover())
				}()

				onConnActive.Invoke(js.Global.Get("Date").New().Call("getTime"))
			}
		},

		"onLog": func(onLog *js.Object) {
			if onLog == nil {
				s.OnLog = nil
				return
			}

			s.OnLog = func(tokens ...interface{}) {
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

				onLog.Invoke(message)
			}
		},

		"setParams": s.SetParams,

		"setTransport": s.SetTransport,

		"setAddress": func(value string) {
			s.Address = value
		},

		"open": s.Open,

		"close": s.Close,

		"send": func(params map[string]interface{}, payload *js.Object) (result *js.Object) {
			action := &ninchat.Action{
				Params:  params,
				Payload: wrapPayload(payload),
			}

			if _, disabled := params["action_id"]; !disabled {
				p := &promise{
					onPanic: onPanic,
				}

				action.OnReply = p.onReply
				result = p.object()
			}

			s.Send(action)
			return
		},
	}
}
