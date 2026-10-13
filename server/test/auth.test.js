const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { authSettings } = require("../auth/config")
const { contentSource, zipOf, startServer } = require("./helpers")

let server

before(async () => {
    server = await startServer()
})

after(() => server.close())

const me = async (headers, from = server) => {
    const response = await fetch(`${from.base}/api/auth/me`, { headers })
    return { status: response.status, body: await response.json() }
}

test("lesson content is for signed-in users only", async () => {
    assert.equal((await fetch(`${server.base}/api/content/overlay`)).status, 401)
    assert.equal((await fetch(`${server.base}/api/content/overlay`, { headers: server.student })).status, 200)
})

test("signing in returns to the lesson that was asked for", async () => {
    const { location, headers } = await server.signIn({ next: "#/lessons/algebra" })

    assert.equal(location, "/#/lessons/algebra")
    assert.deepEqual((await me(headers)).body, { sub: "user-student", name: "Test User", role: "student" })
})

test("signing in never leads off the site", async () => {
    for (const next of ["https://evil.example", "//evil.example", "/lessons"]) {
        assert.equal((await server.signIn({ next })).location, "/")
    }
})

test("the roles decide who is a teacher or an admin", async () => {
    const roleOf = async roles => (await me((await server.signIn({ roles })).headers)).body.role

    assert.equal(await roleOf(["teacher"]), "teacher")
    assert.equal(await roleOf(["teacher", "admin"]), "admin")
    assert.equal(await roleOf(["something-else"]), "student")
})

test("a callback nobody started ends on the error page", async () => {
    const response = await fetch(`${server.base}/api/auth/callback?sub=intruder&roles=admin`, { redirect: "manual" })

    assert.equal(response.headers.get("location"), "/?auth_error=failed")
    assert.equal((await me({})).status, 401)
})

test("signing out clears the session and points at the provider's sign-out", async () => {
    const { headers } = await server.signIn()

    const response = await fetch(`${server.base}/api/auth/logout`, { method: "POST", headers })

    assert.deepEqual(await response.json(), { redirect: "http://idp.test/logout" })
    assert.match(response.headers.getSetCookie().join(), /oatutor_session=;/)
})

test("teachers import with their session, and only admins remove", async () => {
    const zip = await zipOf(contentSource())
    const teacher = (await server.signIn({ roles: ["teacher"] })).headers
    const admin = (await server.signIn({ roles: ["admin"] })).headers

    assert.equal((await server.upload(zip, server.student)).status, 403)
    assert.equal((await server.upload(zip, teacher)).status, 201)
    assert.equal((await server.remove("algebra_k1", teacher)).status, 403)
    assert.equal((await server.remove("algebra_k1", admin)).status, 204)
})

test("with sign-in off, lessons are open and importing takes the token", async () => {
    const open = await startServer({ authMode: "off" })
    try {
        const zip = await zipOf(contentSource())

        assert.deepEqual((await me({}, open)).body, { sub: null, name: "", role: "anonymous" })
        assert.equal((await open.upload(zip, {})).status, 401)
        assert.equal((await open.upload(zip)).status, 201)
        assert.deepEqual((await open.overlay()).problems.map(problem => problem.id), ["p1"])
        assert.equal((await open.remove("algebra_k1")).status, 204)
    } finally {
        await open.close()
    }
})

test("sign-in is off unless it is asked for", () => {
    assert.equal(authSettings({}).mode, "off")
})

test("dev mode refuses to run behind https", () => {
    assert.throws(() => authSettings({ AUTH_MODE: "dev", PUBLIC_BASE_URL: "https://tutor.example" }), /https/)
})

test("oidc mode names the settings it is missing", () => {
    const settings = { AUTH_MODE: "oidc", SESSION_SECRET: "s" }
    assert.throws(() => authSettings(settings), /needs OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, PUBLIC_BASE_URL/)
})
