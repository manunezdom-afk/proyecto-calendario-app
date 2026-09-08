#!/usr/bin/env node
// Compatibility entry point. One benchmark engine, no hidden SDK retries.
// Offline inventory by default. Metered execution requires --live --budget USD.
// Example: npm run nova:battery -- --live --limit 100 --budget 1
await import('./ai-router-benchmark.mjs')
