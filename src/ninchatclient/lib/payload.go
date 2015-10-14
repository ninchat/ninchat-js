package clientlib

import (
	"github.com/gopherjs/gopherjs/js"
	"github.com/ninchat/ninchat-go"
)

func wrapPayload(input *js.Object) (output []ninchat.Frame) {
	if input != nil && input != js.Undefined {
		for i := 0; i < input.Length(); i++ {
			output = append(output, input.Index(i))
		}
	}
	return
}

func unwrapPayload(input []ninchat.Frame) (output []*js.Object) {
	for _, frame := range input {
		output = append(output, frame)
	}
	return
}
