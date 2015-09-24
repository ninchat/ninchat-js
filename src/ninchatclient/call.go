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
			Params:  params,
			OnReply: p.onReply,
		}

		if _, err := caller.Call(action); err != nil {
			onLog.Invoke(err.Error())
		}
	}()

	return p.object()
}
