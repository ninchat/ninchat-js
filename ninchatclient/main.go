package main

import (
	"github.com/gopherjs/gopherjs/js"

	clientlib "github.com/ninchat/ninchat-js/ninchatclient/lib"
)

const (
	namespace = "NinchatClient"
)

func main() {
	api := js.Undefined

	if js.Module != js.Undefined {
		api = js.Module.Get("exports")
	}

	if api == js.Undefined {
		api = js.Global.Get("Object").New()
		js.Global.Set(namespace, api)
	}

	clientlib.Init(api)
}
