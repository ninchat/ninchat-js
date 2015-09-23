GO		:= go
GOFMT		:= gofmt
GOPATH		:= $(PWD)
GOPHERJS	:= bin/gopherjs

DOCKER		:= docker
DOCKER_TAG	:= ninchat-js
DOCKER_BROWSER	:= chromium-browser --disable-setuid-sandbox

export GOPATH

build: gen/ninchatclient.js gen/ninchatclient.min.js

gen/ninchatclient.js gen/ninchatclient.min.js: $(wildcard src/ninchatclient/*.go) $(GOPHERJS)
	@ mkdir -p gen
	$(GOPHERJS) build -o gen/ninchatclient.js ninchatclient
	$(GOPHERJS) build -m -o gen/ninchatclient.min.js ninchatclient
	$(GOFMT) -d -s src/ninchatclient
	$(GO) vet ninchatclient

$(GOPHERJS):
	$(GO) get github.com/kardianos/osext
	$(GO) get github.com/neelance/sourcemap
	$(GO) get github.com/spf13/cobra
	$(GO) get golang.org/x/crypto/ssh/terminal
	$(GO) get golang.org/x/tools/go/exact
	$(GO) get gopkg.in/fsnotify.v1
	$(GO) build -o $@ github.com/gopherjs/gopherjs

clean:
	rm -rf bin
	rm -rf pkg
	rm -rf src/github.com/cpuguy83/go-md2man
	rm -rf src/github.com/inconshreveable/mousetrap
	rm -rf src/github.com/kardianos/osext
	rm -rf src/github.com/neelance/sourcemap
	rm -rf src/github.com/russross/blackfriday
	rm -rf src/github.com/shurcooL/sanitized_anchor_name
	rm -rf src/github.com/spf13/cobra
	rm -rf src/github.com/spf13/pflag
	rm -rf src/golang.org/x/crypto
	rm -rf src/golang.org/x/tools
	rm -rf src/gopkg.in/fsnotify.v1

container-for-testing:
	$(DOCKER) build -t $(DOCKER_TAG) .

test-in-container:
	$(DOCKER) run -e DISPLAY=$(DISPLAY) -i --rm -t -v /tmp:/tmp -v $(PWD):/work $(DOCKER_TAG) $(DOCKER_BROWSER) file:///work/example/test.html

.PHONY: build clean container-for-testing test-in-container
