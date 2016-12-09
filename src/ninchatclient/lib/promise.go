package clientlib

import (
	"github.com/gopherjs/gopherjs/js"
	ninchat "github.com/ninchat/ninchat-go"
)

type Promise struct {
	OnPanic func(string, interface{})

	fulfillers []*js.Object
	rejecters  []*js.Object
	notifiers  []*js.Object
}

func (p *Promise) Object() (o *js.Object) {
	o = js.Global.Get("Object").New()

	o.Set("then", func(onFulfilled, onRejected, onNotified *js.Object) *js.Object {
		if onFulfilled != nil && onFulfilled != js.Undefined {
			p.fulfillers = append(p.fulfillers, onFulfilled)
		}

		if onRejected != nil && onRejected != js.Undefined {
			p.rejecters = append(p.rejecters, onRejected)
		}

		if onNotified != nil && onNotified != js.Undefined {
			p.notifiers = append(p.notifiers, onNotified)
		}

		return o
	})

	return
}

func (p *Promise) OnReply(e *ninchat.Event) {
	if e != nil {
		if e.String() == "error" {
			p.Reject(e.Params)
		} else if e.LastReply {
			p.Resolve(e.Params, UnwrapPayload(e.Payload))
		} else {
			p.Notify(e.Params, UnwrapPayload(e.Payload))
		}
	}
}

func (p *Promise) Resolve(args ...interface{}) {
	for _, callback := range p.fulfillers {
		p.invoke("Promise onFulfilled callback:", callback, args...)
	}
}

func (p *Promise) Reject(args ...interface{}) {
	for _, callback := range p.rejecters {
		p.invoke("Promise onRejected callback:", callback, args...)
	}
}

func (p *Promise) Notify(args ...interface{}) {
	for _, callback := range p.notifiers {
		p.invoke("Promise onNotified callback:", callback, args...)
	}
}

func (p *Promise) invoke(logPrefix string, callback *js.Object, args ...interface{}) {
	if p.OnPanic != nil {
		defer func() {
			p.OnPanic(logPrefix, recover())
		}()
	}

	callback.Invoke(args...)
}
