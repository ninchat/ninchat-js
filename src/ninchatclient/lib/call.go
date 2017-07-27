package clientlib

import (
	"github.com/gopherjs/gopherjs/js"
	"github.com/ninchat/ninchat-go"
)

func call(params map[string]interface{}, onLog *js.Object, address string) *js.Object {
	if address == "undefined" {
		address = ""
	}

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
		caller := ninchat.Caller{
			Address: address,
		}

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
