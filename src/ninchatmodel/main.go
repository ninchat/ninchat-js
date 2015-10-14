package main

import (
	"github.com/gopherjs/gopherjs/js"
	model "github.com/ninchat/ninchat-go/ninchatmodel"

	"ninchatclient/lib"
)

const (
	namespace = "NinchatModel"
)

func main() {
	module := js.Global.Get("Object").New()

	// @see [`NinchatClient.call`](ninchatclient.md#ninchatclientcallheader-onlog-address)
	//
	// @param {Object}   header
	// @param {Function} [onLog]
	// @param {String}   [address]
	//
	// @return {Promise}
	//
	// @function NinchatModel.call
	//

	// @see [`NinchatClient.newSession`](ninchatclient.md#ninchatclientnewsession)
	//
	// @return {Session}
	//
	// @function NinchatModel.newSession
	//

	// @see [`NinchatClient.stringifyFrame`](ninchatclient.md#ninchatclientstringifyframedata)
	//
	// @param {Object} data
	//
	// @return {String}
	//
	// @function NinchatModel.stringifyFrame
	//
	clientlib.Init(module)

	module.Set("ADDED", model.Added)
	module.Set("UPDATED", model.Updated)
	module.Set("REMOVED", model.Removed)

	module.Set("newState", newState)

	js.Global.Set(namespace, module)
}
