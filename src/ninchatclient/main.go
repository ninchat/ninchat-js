package main

import (
	"github.com/gopherjs/gopherjs/js"

	"ninchatclient/lib"
)

const (
	namespace = "NinchatClient"
)

func main() {
	module := js.Global.Get("Object").New()
	clientlib.Init(module)
	if js.Module != js.Undefined && js.Module.Get("exports") != js.Undefined {
		e := js.Module.Get("exports")
		e.Set("call", module.Get("call"))
		e.Set("newSession", module.Get("newSession"))
		e.Set("stringifyFrame", module.Get("stringifyFrame"))
	} else {
		js.Global.Set(namespace, module)
	}
}
