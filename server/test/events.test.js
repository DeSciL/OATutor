const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { startServer } = require("./helpers")

let server

before(async () => {
    server = await startServer()
})

after(() => server.close())

const send = (body, headers = server.student, to = server) =>
    fetch(`${to.base}/api/events`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    })

const answer = {
    collection: "problemSubmissions",
    eventType: "answerStep",
    lessonId: "algebra-lesson",
    problemID: "p1",
    stepID: "p1a",
    isCorrect: true,
    time_stamp: 1760000000000,
    input: "4",
}

test("an answer is stored under the signed-in student", async () => {
    const response = await send({ ...answer, oats_user_id: "someone-else" })

    assert.equal(response.status, 204)
    const event = server.events.at(-1)
    assert.equal(event.userSub, "user-student")
    assert.deepEqual(
        [event.collection, event.eventType, event.lessonId, event.problemId, event.stepId, event.isCorrect],
        ["problemSubmissions", "answerStep", "algebra-lesson", "p1", "p1a", true]
    )
    assert.deepEqual(event.clientTime, new Date(1760000000000))
    assert.equal(event.payload.input, "4")
    assert.equal("oats_user_id" in event.payload, false)
})

test("events need a session", async () => {
    const before = server.events.length

    assert.equal((await send(answer, {})).status, 401)
    assert.equal(server.events.length, before)
})

test("with sign-in off, an event goes by the browser's own id", async () => {
    const open = await startServer({ authMode: "off" })
    try {
        assert.equal((await send({ ...answer, oats_user_id: "4711" }, {}, open)).status, 204)
        assert.equal(open.events.at(-1).userSub, "anon:4711")
        assert.equal((await send(answer, {}, open)).status, 400)
    } finally {
        await open.close()
    }
})

test("an unknown collection is refused", async () => {
    assert.equal((await send({ ...answer, collection: "mouseMovement" })).status, 400)
})

test("an oversized event is refused", async () => {
    assert.equal((await send({ ...answer, input: "x".repeat(70_000) })).status, 413)
})

test("events reach Postgres", { skip: !process.env.TEST_DATABASE_URL && "set TEST_DATABASE_URL to run" }, async () => {
    const { migrate } = require("../db/migrate")
    const { EventStore } = require("../events/store")
    const store = new EventStore(process.env.TEST_DATABASE_URL)
    try {
        await migrate(store.pool)
        // A second start finds nothing left to apply.
        await migrate(store.pool)
        const userSub = `test-${Date.now()}`

        await store.insert({
            userSub,
            collection: "problemSubmissions",
            eventType: "answerStep",
            lessonId: "algebra-lesson",
            problemId: "p1",
            stepId: "p1a",
            isCorrect: false,
            clientTime: new Date(),
            payload: { input: "3" },
        })

        const { rows } = await store.pool.query("SELECT is_correct, payload FROM event WHERE user_sub = $1", [userSub])
        assert.deepEqual(rows, [{ is_correct: false, payload: { input: "3" } }])
    } finally {
        await store.pool.end()
    }
})
