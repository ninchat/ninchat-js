#!/usr/bin/env python

import argparse

try:
    # Python 3
    from http.server import SimpleHTTPRequestHandler, HTTPServer
except ImportError:
    # Python 2
    from BaseHTTPServer import HTTPServer
    from SimpleHTTPServer import SimpleHTTPRequestHandler

PORT = 8080

parser = argparse.ArgumentParser()
parser.add_argument("port", nargs="?", type=int, default=8080, help="default: 8080")
args = parser.parse_args()

server = HTTPServer(("localhost", args.port), SimpleHTTPRequestHandler)
server.serve_forever()
