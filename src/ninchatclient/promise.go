package main

import (
	"github.com/gopherjs/gopherjs/js"
)

const (
	promiseResolveInvocationName = namespace + " promise resolve callback"
	promiseRejectInvocationName  = namespace + " promise reject callback"
	promiseNotifyInvocationName  = namespace + " promise notify callback"
)

// Deferred
type Deferred struct {
	resolve []js.Object
	reject  []js.Object
	notify  []js.Object
}

// Defer
func Defer() (d *Deferred, promise map[string]interface{}) {
	d = &Deferred{}

	promise = map[string]interface{}{
		"then": d.then,
	}

	return
}

// then implements the Promise.then(function|null[, function|null[,
// function|null]]) JavaScript API.
func (d *Deferred) then(resolve, reject, notify js.Object) {
	if resolve != js.Undefined && resolve != nil {
		d.resolve = append(d.resolve, resolve)
	}

	if reject != js.Undefined && reject != nil {
		d.reject = append(d.reject, reject)
	}

	if notify != js.Undefined && notify != nil {
		d.notify = append(d.notify, notify)
	}
}

// Resolve
func (d *Deferred) Resolve(args ...interface{}) {
	for _, callback := range d.resolve {
		jsInvoke(promiseResolveInvocationName, callback, args...)
	}
}

// Reject
func (d *Deferred) Reject(args ...interface{}) {
	for _, callback := range d.reject {
		jsInvoke(promiseRejectInvocationName, callback, args...)
	}
}

// Notify
func (d *Deferred) Notify(args ...interface{}) {
	for _, callback := range d.notify {
		jsInvoke(promiseNotifyInvocationName, callback, args...)
	}
}
