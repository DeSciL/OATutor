const { test, beforeEach, afterEach } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")
const { contentSource, zipOf, startServer } = require("./helpers")

let server

beforeEach(async () => {
    server = await startServer()
})

afterEach(() => server.close())

test("an imported lesson appears in the overlay", async () => {
    const { status, body } = await server.upload(await zipOf(contentSource()))

    assert.equal(status, 201)
    assert.deepEqual(body.lessonIds, ["algebra_k1-lesson"])
    assert.deepEqual(body.lessonUrls, ["https://tutor.example/#/lessons/algebra_k1-lesson"])
    const overlay = await server.overlay()
    assert.deepEqual(overlay.coursePlans.map(course => course.courseName), ["Algebra"])
    assert.deepEqual(overlay.problems.map(problem => problem.id), ["p1"])
    // Steps and pathways arrive assembled, the way the built-in pool has them.
    assert.equal(overlay.problems[0].steps[0].hints.DefaultPathway[0].id, "p1a-h1")
    assert.deepEqual(overlay.skillModel, { p1a: ["algebra_k1"] })
    assert.ok(overlay.bktParams.default.algebra_k1)
})

test("importing again replaces the earlier import", async () => {
    await server.upload(await zipOf(contentSource({ problems: ["p1", "p2"], figure: true })))
    assert.equal((await fetch(`${server.base}/static/images/figures/oatutor/p1/graph.png`, { headers: server.student })).status, 200)

    const { status, body } = await server.upload(await zipOf(contentSource({ problems: ["p2"] })))

    assert.equal(status, 200)
    assert.equal(body.replaced, true)
    const overlay = await server.overlay()
    assert.deepEqual(overlay.problems.map(problem => problem.id), ["p2"])
    assert.equal(overlay.coursePlans.length, 1)
    assert.equal((await fetch(`${server.base}/static/images/figures/oatutor/p1/graph.png`, { headers: server.student })).status, 404)
})

test("a Finder zip of the folder is accepted", async () => {
    const nested = Object.fromEntries(
        Object.entries(contentSource()).map(([name, content]) => [`algebra-oatutor/${name}`, content])
    )
    nested["__MACOSX/algebra-oatutor/._coursePlans.json"] = "resource fork"

    assert.equal((await server.upload(await zipOf(nested))).status, 201)
})

test("the overlay revalidates with its ETag", async () => {
    const first = await fetch(`${server.base}/api/content/overlay`, { headers: server.student })
    const etag = first.headers.get("etag")
    const cached = { ...server.student, "If-None-Match": etag }
    assert.equal((await fetch(`${server.base}/api/content/overlay`, { headers: cached })).status, 304)

    await server.upload(await zipOf(contentSource()))

    const after = await fetch(`${server.base}/api/content/overlay`, { headers: cached })
    assert.equal(after.status, 200)
    assert.notEqual(after.headers.get("etag"), etag)
})

test("importing needs the token", async () => {
    const zip = await zipOf(contentSource())
    assert.equal((await server.upload(zip, {})).status, 401)
    assert.equal((await server.upload(zip, { Authorization: "Bearer wrong" })).status, 401)
    assert.deepEqual((await server.overlay()).problems, [])
})

test("importing is off when no token is configured", async () => {
    const closed = await startServer({ importToken: undefined })
    try {
        assert.equal((await closed.upload(await zipOf(contentSource()))).status, 503)
    } finally {
        await closed.close()
    }
})

test("built-in ids and course names are refused", async () => {
    const { status, body } = await server.upload(
        await zipOf(contentSource({ problems: ["a005bd5real1"], courseName: "OpenStax: College Algebra" }))
    )

    assert.equal(status, 409)
    assert.equal(body.issues.length, 2)
})

test("another source's lesson is refused", async () => {
    await server.upload(await zipOf(contentSource({ key: "first" })))

    const { status, body } = await server.upload(
        await zipOf(contentSource({ key: "second", problems: ["p9"], lessonId: "first-lesson" }))
    )

    assert.equal(status, 409)
    assert.match(body.issues[0], /first-lesson already belongs to the imported source first/)
})

test("a problem outside the source's lessons is refused", async () => {
    // Without a lessonId, OATutor would show the problem in every lesson.
    const files = contentSource()
    files["content-pool/p1/p1.json"] = JSON.stringify({ id: "p1", title: "Loose" })

    const { status, body } = await server.upload(await zipOf(files))

    assert.equal(status, 422)
    assert.match(body.issues[0], /does not belong to a lesson/)
})

test("a path escaping the upload is refused", async () => {
    const files = contentSource()
    // Three levels up from <dataDir>/tmp/import-*/unpacked is the data directory itself,
    // which outlives the import, so an escape would be caught below.
    files["aaaaaaaa/evil.json"] = "{}"
    // yazl will not write a ".." path, so rename the entry in the finished archive.
    const zip = await zipOf(files)
    const planted = Buffer.from(zip.toString("latin1").replaceAll("aaaaaaaa/evil.json", "../../../evil.json"), "latin1")

    const { status } = await server.upload(planted)

    assert.equal(status, 400)
    const written = fs.readdirSync(server.dataDir, { recursive: true }).map(name => path.basename(name))
    assert.ok(!written.includes("evil.json"))
    assert.deepEqual((await server.overlay()).problems, [])
})

test("an oversized upload is refused", async () => {
    const small = await startServer({ limits: { maxUploadBytes: 1024 } })
    try {
        const files = contentSource()
        files["padding.txt"] = require("crypto").randomBytes(4096).toString("hex")
        assert.equal((await small.upload(await zipOf(files))).status, 413)
    } finally {
        await small.close()
    }
})

test("something that is not a zip is refused", async () => {
    assert.equal((await server.upload(Buffer.from("plain text"))).status, 400)
})

test("built-in skill parameters are kept, with a warning", async () => {
    const { body } = await server.upload(await zipOf(contentSource({ skills: ["real_numbers", "algebra_k1"] })))

    assert.match(body.warnings.join(), /real_numbers/)
    assert.deepEqual(Object.keys((await server.overlay()).bktParams.default), ["algebra_k1"])
})

test("a source can be listed and deleted", async () => {
    await server.upload(await zipOf(contentSource({ figure: true })))
    assert.deepEqual((await server.list()).map(source => source.sourceKey), ["algebra_k1"])

    assert.equal((await server.remove("algebra_k1")).status, 204)
    assert.equal((await server.remove("algebra_k1")).status, 404)
    assert.deepEqual((await server.overlay()).problems, [])
    assert.equal((await fetch(`${server.base}/static/images/figures/oatutor/p1/graph.png`, { headers: server.student })).status, 404)
})

test("a source without a manifest is known by its lesson", async () => {
    const { status, body } = await server.upload(await zipOf(contentSource({ manifest: false })))

    assert.equal(status, 201)
    assert.equal(body.sourceKey, "algebra_k1-lesson")
    assert.match(body.warnings[0], /no manifest/)
})
