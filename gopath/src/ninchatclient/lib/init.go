package clientlib

import (
	"github.com/gopherjs/gopherjs/js"
	ninchat "github.com/ninchat/ninchat-go"
)

func Init(module *js.Object) {
	module.Set("defaultXUserAgent", defaultXUserAgent)
	module.Set("call", call)
	module.Set("newCaller", newCaller)
	module.Set("newSession", newSession)
	module.Set("stringifyFrame", ninchat.StringifyFrame)
}
