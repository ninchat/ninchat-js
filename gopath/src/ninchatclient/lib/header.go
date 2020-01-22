package clientlib

const defaultXUserAgent = "ninchat-js/1"

func makeDefaultHeader() map[string][]string {
	return map[string][]string{
		"X-User-Agent": []string{defaultXUserAgent},
	}
}

