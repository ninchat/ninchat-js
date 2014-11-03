JavaScript utilities for use with the [Ninchat](https://ninchat.com) API.

Points of interest:

- `src/ninchatclient/` contains Go sources for NinchatClient, a library for
  accessing `api.ninchat.com` from a web browser.
- `gen/ninchatclient.js` contains JavaScript sources generated with GopherJS.
  Regenerate with `make` (requires Go).
- `doc/ninchatclient.js` contains API documentation.

The library API hasn't been stabilized, so it's best to only depend on a
specific Git commit for now.
