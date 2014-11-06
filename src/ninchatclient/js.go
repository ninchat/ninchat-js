package main

import (
	"errors"

	"github.com/gopherjs/gopherjs/js"
)

func jsError(x interface{}) (err error) {
	if x == nil {
		return
	}

	if jsErr, ok := x.(*js.Error); ok {
		msg := jsErr.Get("message").Str()
		if msg == "" {
			msg = "error"
		}

		err = errors.New(msg)
		return
	}

	err = x.(error)
	return
}

func jsInvoke(name string, function js.Object, args ...interface{}) (ok bool) {
	defer func() {
		if err := jsError(recover()); err != nil {
			println(name + " invocation error: " + err.Error())
		}
	}()

	function.Invoke(args...)

	ok = true
	return
}

func EncodeBase64(data js.Object) (encoded js.Object, err error) {
	defer func() {
		err = jsError(recover())
	}()

	str := js.Global.Get("String").Get("fromCharCode").Call("apply", nil, data)
	encoded = js.Global.Call("btoa", str)
	return
}

func NewArray() js.Object {
	return js.Global.Get("Array").New()
}

func NewUint8Array(arrayBuffer js.Object) js.Object {
	return js.Global.Get("Uint8Array").New(arrayBuffer)
}

func NewObject() js.Object {
	return js.Global.Get("Object").New()
}

func EncodeURIComponent(s string) string {
	return js.Global.Call("encodeURIComponent", s).Str()
}

func ParseJSON(json string) (object js.Object, err error) {
	defer func() {
		err = jsError(recover())
	}()

	object = js.Global.Get("JSON").Call("parse", json)
	return
}

func StringifyJSON(object interface{}) (json string, err error) {
	defer func() {
		err = jsError(recover())
	}()

	json = js.Global.Get("JSON").Call("stringify", object).Str()
	return
}

func Random() float64 {
	return js.Global.Get("Math").Call("random").Float()
}

func SetTimeout(callback func(), timeout Duration) (id js.Object) {
	return js.Global.Call("setTimeout", callback, timeout)
}

func ClearTimeout(id js.Object) {
	js.Global.Call("clearTimeout", id)
}
