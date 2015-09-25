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
				msg = "?"
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

				onEvent.Invoke(e.Params, e.Payload)
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
					str := "?"

					if y, ok := x.(string); ok {
						str = y
					} else if y, ok := x.(error); ok {
						str = y.Error()
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

		"send": func(params map[string]interface{}, payload *js.Object) (result map[string]interface{}) {
			action := &ninchat.Action{
				Params: params,
			}

			if _, disabled := params["action_id"]; !disabled {
				p := &promise{
					onPanic: onPanic,
				}

				action.OnReply = p.onReply
				result = p.object()
			}

			if payload != nil && payload != js.Undefined {
				for i := 0; i < payload.Length(); i++ {
					action.Payload = append(action.Payload, payload.Index(i))
				}
			}

			s.Send(action)
			return
		},
	}
}
