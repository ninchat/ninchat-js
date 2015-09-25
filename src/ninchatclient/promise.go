package main

import (
	"github.com/gopherjs/gopherjs/js"
	"github.com/ninchat/ninchat-go"
)

type callback1 func(params map[string]interface{})
type callback2 func(paramsOrArrayOfParams interface{}, payload []*js.Object)

type promise struct {
	resolvers []callback2
	rejecters []callback1
	notifiers []callback2
	onPanic   func(string, interface{})
}

func (p *promise) object() map[string]interface{} {
	return map[string]interface{}{
		"then": func(resolve callback2, reject callback1, notify callback2) {
			if resolve != nil {
				p.resolvers = append(p.resolvers, resolve)
			}

			if reject != nil {
				p.rejecters = append(p.rejecters, reject)
			}

			if notify != nil {
				p.notifiers = append(p.notifiers, notify)
			}
		},
	}
}

func (p *promise) onReply(e *ninchat.Event) {
	if e != nil {
		if e.String() == "error" {
			for _, f := range p.rejecters {
				p.invoke1(f, e, "Promise reject callback:")
			}
		} else if e.LastReply {
			for _, f := range p.resolvers {
				p.invoke2(f, e, "Promise resolve callback:")
			}
		} else {
			for _, f := range p.notifiers {
				p.invoke2(f, e, "Promise notify callback:")
			}
		}
	}
}

func (p *promise) resolveCall(paramsArray []map[string]interface{}) {
	for _, f := range p.resolvers {
		p.invokeCall(f, paramsArray, "Promise resolve callback:")
	}
}

func (p *promise) invoke1(f callback1, e *ninchat.Event, logPrefix string) {
	defer func() {
		p.onPanic(logPrefix, recover())
	}()

	f(e.Params)
}

func (p *promise) invoke2(f callback2, e *ninchat.Event, logPrefix string) {
	defer func() {
		p.onPanic(logPrefix, recover())
	}()

	f(e.Params, e.Payload)
}

func (p *promise) invokeCall(f callback2, paramsArray []map[string]interface{}, logPrefix string) {
	defer func() {
		p.onPanic(logPrefix, recover())
	}()

	f(paramsArray, nil)
}
