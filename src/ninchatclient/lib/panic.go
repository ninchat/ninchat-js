package clientlib

import (
	"github.com/gopherjs/gopherjs/js"
)

func Panicer(getLogger func() func(string)) func(string, interface{}) {
	return func(prefix string, x interface{}) {
		if x != nil {
			if logFunc := getLogger(); logFunc != nil {
				var msg string

				switch t := x.(type) {
				case string:
					msg = t

				case error:
					msg = t.Error()

				default:
					msg = js.Global.Get("JSON").Call("stringify", t).String()
				}

				logFunc(prefix + " " + msg)
			}
		}
	}
}
