package main

import (
	"github.com/gopherjs/gopherjs/js"
	"github.com/ninchat/ninchat-go"
)

func call(params map[string]interface{}, onLog *js.Object, address string) map[string]interface{} {
	p := &promise{
		onPanic: func(prefix string, x interface{}) {
			if x != nil && onLog != nil {
				var msg string

				switch t := x.(type) {
				case string:
					msg = t

				case error:
					msg = t.Error()

				default:
					msg = "?"
				}

				onLog.Invoke(prefix + " " + msg)
			}
		},
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
			onLog.Invoke(reason)
			p.onReply(&ninchat.Event{
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

		p.resolveCall(paramsArray)
	}()

	return p.object()
}
