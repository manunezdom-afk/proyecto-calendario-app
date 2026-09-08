#!/usr/bin/env node
// Compatibility entry point. A URL alone now produces an OFFLINE inventory.
// Add --live-db, and optionally --chat, to explicitly run bounded checks.
import { main } from './ai-remote-check.mjs'
await main(process.argv.slice(2))
