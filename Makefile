GO		:= go
GOFMT		:= gofmt
GOPATH		:= $(PWD)
GOPHERJS	:= bin/gopherjs
MARKDOX		:= markdox

DOCKER		:= docker
DOCKER_TAG	:= ninchat-js
DOCKER_BROWSER	:= chromium-browser --disable-setuid-sandbox

export GOPATH

build: ninchatclient

ninchatclient: gen/ninchatclient.js gen/ninchatclient.min.js docs/ninchatclient.md

gen/ninchatclient.js gen/ninchatclient.min.js: $(wildcard src/ninchatclient/*.go src/ninchatclient/*/*.go) $(wildcard src/github.com/ninchat/ninchat-go/*.go) $(GOPHERJS)
	@ mkdir -p gen
	$(GOPHERJS) build -o gen/ninchatclient.js ninchatclient
	$(GOPHERJS) build -m -o gen/ninchatclient.min.js ninchatclient
	$(GOFMT) -d -s src/ninchatclient
	$(GO) vet -tags=js ninchatclient

docs/ninchatclient.md: docs/ninchatclient.js
	$(MARKDOX) -o $@ docs/ninchatclient.js

$(GOPHERJS):
	$(GO) get github.com/fsnotify/fsnotify
	$(GO) get github.com/kisielk/gotool
	$(GO) get github.com/neelance/sourcemap
	$(GO) get github.com/shurcooL/httpfs/vfsutil
	$(GO) get github.com/spf13/cobra
	$(GO) get golang.org/x/crypto/ssh/terminal
	$(GO) get golang.org/x/tools/go/types/typeutil
	$(GO) build -o $@ github.com/gopherjs/gopherjs

clean:
	rm -rf bin
	rm -rf pkg
	rm -rf src/github.com/fsnotify/fsnotify
	rm -rf src/github.com/kisielk/gotool
	rm -rf src/github.com/neelance/sourcemap
	rm -rf src/github.com/spf13/cobra
	rm -rf src/golang.org/x/crypto
	rm -rf src/golang.org/x/tools

container-for-testing:
	$(DOCKER) build -t $(DOCKER_TAG) .

test-in-container:
	$(DOCKER) run -e DISPLAY=$(DISPLAY) -i --rm -t -v /tmp:/tmp -v $(PWD):/work $(DOCKER_TAG) $(DOCKER_BROWSER) file:///work/example/test.html

.PHONY: build ninchatclient clean container-for-testing test-in-container
