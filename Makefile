GO		:= go
GOPHERJS	:= gopherjs
MARKDOX		:= markdox

DOCKER		:= docker
DOCKER_TAG	:= ninchat-js
DOCKER_BROWSER	:= chromium-browser --no-sandbox

build:
	@ mkdir -p gen
	$(GOPHERJS) build -o gen/ninchatclient.js ./ninchatclient
	$(GOPHERJS) build -m -o gen/ninchatclient.min.js ./ninchatclient
	$(MARKDOX) -o docs/ninchatclient.md docs/ninchatclient.js

container-for-testing:
	$(DOCKER) build -t $(DOCKER_TAG) .

test-in-container:
	$(DOCKER) run -e DISPLAY=$(DISPLAY) -i --rm -t -v /tmp:/tmp -v $(PWD):/work $(DOCKER_TAG) $(DOCKER_BROWSER) file:///work/example/client-test.html

.PHONY: build container-for-testing test-in-container
