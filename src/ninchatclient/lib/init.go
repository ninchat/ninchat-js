package clientlib

import (
	"github.com/gopherjs/gopherjs/js"
	"github.com/ninchat/ninchat-go"
)

func Init(module *js.Object) {
	module.Set("call", call)
	module.Set("newSession", newSession)
	module.Set("stringifyFrame", ninchat.StringifyFrame)
}
