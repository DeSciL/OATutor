const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { startServer } = require("./helpers")

let server

before(async () => {
    server = await startServer()
})

after(() => server.close())

test("serves the app at the root", async () => {
    const response = await fetch(`${server.base}/`)
    assert.equal(response.status, 200)
    assert.match(await response.text(), /id=root/)
})

test("reports health", async () => {
    const response = await fetch(`${server.base}/api/health`)
    assert.deepEqual(await response.json(), { status: "ok" })
})

test("caches fingerprinted bundles for good", async () => {
    const response = await fetch(`${server.base}/static/js/main.abc123.js`)
    assert.match(response.headers.get("cache-control"), /immutable/)
})

test("keeps figures revalidated, since their names survive a redeploy", async () => {
    const response = await fetch(`${server.base}/static/images/figures/oatutor/builtin1/graph.png`)
    assert.equal(response.status, 200)
    assert.doesNotMatch(response.headers.get("cache-control"), /immutable/)
})

test("sends the problem pool compressed", async () => {
    const response = await fetch(`${server.base}/content-pool/oatutor.json`, { headers: { "Accept-Encoding": "gzip" } })
    assert.equal(response.headers.get("content-encoding"), "gzip")
    assert.equal((await response.json()).length, 200)
})
