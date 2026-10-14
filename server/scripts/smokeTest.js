// Checks a running image end to end: the app is served, and a lesson can be imported, read and removed.
// BASE_URL=http://127.0.0.1:8080 IMPORT_TOKEN=... node scripts/smokeTest.js
const assert = require("node:assert/strict")
const { contentSource, zipOf } = require("../test/helpers")

const base = process.env.BASE_URL || "http://127.0.0.1:8080"
const auth = { Authorization: `Bearer ${process.env.IMPORT_TOKEN}` }

async function waitUntilHealthy(seconds = 60) {
    for (let waited = 0; waited < seconds; waited++) {
        try {
            if ((await fetch(`${base}/api/health`)).ok) return
        } catch {
            // Not listening yet.
        }
        await new Promise(resolve => setTimeout(resolve, 1000))
    }
    throw new Error(`${base}/api/health did not answer within ${seconds} s`)
}

async function overlay() {
    const response = await fetch(`${base}/api/content/overlay`)
    assert.equal(response.status, 200)
    return response.json()
}

async function main() {
    await waitUntilHealthy()
    assert.equal((await fetch(`${base}/healthz`)).status, 200)

    const page = await (await fetch(base)).text()
    const bundle = page.match(/src="(\/static\/js\/main\.[^"]+\.js)"/)
    assert.ok(bundle, "index.html does not load the app's bundle")
    const code = await fetch(base + bundle[1])
    assert.equal(code.status, 200)
    assert.ok(!(await code.text()).includes("lambda-url"), "the bundle still points at upstream's AWS agent")
    console.log("app served")

    const form = new FormData()
    form.append("file", new Blob([await zipOf(contentSource({ key: "smoke_test" }))]), "smoke_test.zip")
    const imported = await fetch(`${base}/api/imports`, { method: "POST", body: form, headers: auth })
    assert.equal(imported.status, 201, await imported.text())
    const after = await overlay()
    assert.deepEqual(after.coursePlans.map(course => course.courseName), ["Algebra"])
    assert.deepEqual(after.problems.map(problem => problem.id), ["p1"])
    console.log("lesson imported")

    assert.equal((await fetch(`${base}/api/imports/smoke_test`, { method: "DELETE", headers: auth })).status, 204)
    assert.deepEqual((await overlay()).problems, [])
    console.log("lesson removed")
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
