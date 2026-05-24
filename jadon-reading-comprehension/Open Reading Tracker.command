#!/bin/bash
set -e

cd "$(dirname "$0")"
open "http://localhost:4317"
node server.js
