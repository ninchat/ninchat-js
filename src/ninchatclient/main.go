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
	js.Global.Set(namespace, module)
}
