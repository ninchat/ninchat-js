package main

import (
	"github.com/gopherjs/gopherjs/js"
	"github.com/ninchat/ninchat-go"
)

const (
	namespace = "NinchatClient"
)

func main() {
	module := js.Global.Get("Object").New()
	module.Set("call", call)
	module.Set("newSession", newSession)
	module.Set("stringifyFrame", ninchat.StringifyFrame)

	js.Global.Set(namespace, module)
}
