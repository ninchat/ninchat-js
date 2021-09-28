package clientlib

import (
	"github.com/gopherjs/gopherjs/js"
	"github.com/ninchat/ninchat-go"
)

func newCaller() map[string]interface{} {
	var (
		onLog  = js.Undefined
		caller = ninchat.Caller{
			Header: makeDefaultHeader(),
		}
	)

	return map[string]interface{}{
		"onLog": func(callback *js.Object) {
			onLog = callback
		},

		"setHeader": func(key, value string) {
			if caller.Header == nil {
				caller.Header = make(map[string][]string)
			}
			caller.Header[key] = []string{value}
		},

		"setAddress": func(value string) {
			caller.Address = value
		},

		"call": func(params map[string]interface{}) *js.Object {
			return doCall(params, onLog, caller)
		},
	}
}

func call(params map[string]interface{}, onLog *js.Object, address *js.Object) *js.Object {
	var caller ninchat.Caller
	if address != js.Undefined {
		caller.Address = address.String()
	}

	return doCall(params, onLog, caller)
}

func doCall(params map[string]interface{}, onLog *js.Object, caller ninchat.Caller) *js.Object {
	p := &Promise{
		OnPanic: Panicer(func() func(string) {
			return func(msg string) {
				if onLog != js.Undefined {
					onLog.Invoke(msg)
				}
			}
		}),
	}

	go func() {
		action := &ninchat.Action{
			Params: params,
		}

		events, err := caller.Call(action)
		if err != nil {
			reason := err.Error()
			if onLog != js.Undefined {
				onLog.Invoke(reason)
			}
			p.OnReply(&ninchat.Event{
				Params: map[string]interface{}{
					"event":        "error",
					"error_type":   "internal",
					"error_reason": reason,
				},
			})
			return
		}

		var paramsArray []map[string]interface{}

		for _, e := range events {
			paramsArray = append(paramsArray, e.Params)
		}

		p.Resolve(paramsArray)
	}()

	return p.Object()
}
