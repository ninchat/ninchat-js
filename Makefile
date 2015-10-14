GO		:= go
GOFMT		:= gofmt
GOPATH		:= $(PWD)
GOPHERJS	:= bin/gopherjs
MARKDOX		:= markdox
MARKDOWN	:= markdown
AWK		:= awk

DOCKER		:= docker
DOCKER_TAG	:= ninchat-js
DOCKER_BROWSER	:= chromium-browser --disable-setuid-sandbox

export GOPATH

build: ninchatclient ninchatmodel

ninchatclient: gen/ninchatclient.js gen/ninchatclient.min.js doc/ninchatclient.md

gen/ninchatclient.js gen/ninchatclient.min.js: $(wildcard src/ninchatclient/*.go src/ninchatclient/*/*.go) $(wildcard src/github.com/ninchat/ninchat-go/*.go) $(GOPHERJS)
	@ mkdir -p gen
	$(GOPHERJS) build -o gen/ninchatclient.js ninchatclient
	$(GOPHERJS) build -m -o gen/ninchatclient.min.js ninchatclient
	$(GOFMT) -d -s src/ninchatclient
	$(GO) vet ninchatclient

doc/ninchatclient.md: doc/ninchatclient.js
	$(MARKDOX) -o $@ doc/ninchatclient.js

ninchatmodel: gen/ninchatmodel.js gen/ninchatmodel.min.js doc/ninchatmodel.md

gen/ninchatmodel.js gen/ninchatmodel.min.js: $(wildcard src/ninchatmodel/*.go src/github.com/ninchat/ninchat-go/*.go src/github.com/ninchat/ninchat-go/ninchatapi/*.go src/github.com/ninchat/ninchat-go/ninchatmodel/*.go) $(GOPHERJS)
	@ mkdir -p gen
	$(GOPHERJS) build -o gen/ninchatmodel.js ninchatmodel
	$(GOPHERJS) build -m -o gen/ninchatmodel.min.js ninchatmodel
	$(GOFMT) -d -s src/ninchatmodel
	$(GO) vet ninchatmodel

doc/ninchatmodel.md: doc/ninchatmodel.js
	$(MARKDOX) -o $@ doc/ninchatmodel.js

doc/ninchatmodel.js: \
		src/ninchatmodel/main.go \
		src/ninchatmodel/state.go
	cat $^ | $(AWK) -f doc/ninchatmodel.awk > $@ || (rm -f $@; false)

doc/%.html: doc/%.md
	$(MARKDOWN) < doc/$*.md > $@

$(GOPHERJS):
	$(GO) get github.com/fsnotify/fsnotify
	$(GO) get github.com/kardianos/osext
	$(GO) get github.com/neelance/sourcemap
	$(GO) get github.com/spf13/cobra
	$(GO) get github.com/spf13/pflag
	$(GO) get golang.org/x/crypto/ssh/terminal
	$(GO) get golang.org/x/tools/go/types/typeutil
	$(GO) build -o $@ github.com/gopherjs/gopherjs

clean:
	rm -f doc/ninchatmodel.js
	rm -rf bin
	rm -rf pkg
	rm -rf src/github.com/fsnotify/fsnotify
	rm -rf src/github.com/kardianos/osext
	rm -rf src/github.com/neelance/sourcemap
	rm -rf src/github.com/spf13/cobra
	rm -rf src/github.com/spf13/pflag
	rm -rf src/golang.org/x/crypto
	rm -rf src/golang.org/x/tools

container-for-testing:
	$(DOCKER) build -t $(DOCKER_TAG) .

test-in-container:
	$(DOCKER) run -e DISPLAY=$(DISPLAY) -i --rm -t -v /tmp:/tmp -v $(PWD):/work $(DOCKER_TAG) $(DOCKER_BROWSER) file:///work/example/test.html

.PHONY: build ninchatclient ninchatmodel clean container-for-testing test-in-container
