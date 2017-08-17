GOROOT		:= /usr/local/go1.7.6
GO		:= $(GOROOT)/bin/go
GOFMT		:= $(GOROOT)/bin/gofmt
GOPATH		:= $(PWD)
GOPHERJS	:= bin/gopherjs
MARKDOX		:= markdox

DOCKER		:= docker
DOCKER_TAG	:= ninchat-js
DOCKER_BROWSER	:= chromium-browser --disable-setuid-sandbox

export GOROOT GOPATH

build: ninchatclient

ninchatclient: gen/ninchatclient.js gen/ninchatclient.min.js docs/ninchatclient.md

gen/ninchatclient.js gen/ninchatclient.min.js: $(wildcard src/ninchatclient/*.go src/ninchatclient/*/*.go) $(wildcard src/github.com/ninchat/ninchat-go/*.go) $(GOPHERJS)
	@ mkdir -p gen
	$(GOPHERJS) build -o gen/ninchatclient.js ninchatclient
	$(GOPHERJS) build -m -o gen/ninchatclient.min.js ninchatclient
	$(GOFMT) -d -s src/ninchatclient
	$(GO) vet ninchatclient

docs/ninchatclient.md: docs/ninchatclient.js
	$(MARKDOX) -o $@ docs/ninchatclient.js

$(GOPHERJS):
	$(GO) build -o $@ github.com/gopherjs/gopherjs

clean:
	rm -rf bin
	rm -rf pkg

container-for-testing:
	$(DOCKER) build -t $(DOCKER_TAG) .

test-in-container:
	$(DOCKER) run -e DISPLAY=$(DISPLAY) -i --rm -t -v /tmp:/tmp -v $(PWD):/work $(DOCKER_TAG) $(DOCKER_BROWSER) file:///work/example/test.html

.PHONY: build ninchatclient clean container-for-testing test-in-container
