const express = require("express")
const { requireUser } = require("../auth/session")

const COLLECTIONS = new Set(["problemSubmissions", "problemStartLogs", "feedbacks", "siteLogs", "focusStatus"])
const MAX_BODY = "64kb"

const text = value => (typeof value === "string" && value ? value : null)

function eventRoutes({ events }) {
    const router = express.Router()

    router.post("/", requireUser, express.json({ limit: MAX_BODY }), async (req, res) => {
        const { collection, oats_user_id, ...payload } = req.body || {}
        if (!COLLECTIONS.has(collection)) return res.status(400).json({ detail: "Unknown event collection." })
        // A signed-in user is who the session says. Without sign-in the browser's own id is all there is.
        const userSub = req.session.user.sub || (text(oats_user_id) && `anon:${oats_user_id}`)
        if (!userSub) return res.status(400).json({ detail: "The event does not say whose it is." })
        await events.insert({
            userSub,
            collection,
            eventType: text(payload.eventType) || text(payload.logType),
            lessonId: text(payload.lessonId),
            problemId: text(payload.problemID),
            stepId: text(payload.stepID),
            isCorrect: typeof payload.isCorrect === "boolean" ? payload.isCorrect : null,
            clientTime: Number.isFinite(payload.time_stamp) ? new Date(payload.time_stamp) : null,
            payload,
        })
        res.status(204).end()
    })

    router.use((err, req, res, next) => {
        if (err.type === "entity.too.large") return res.status(413).json({ detail: `The event is larger than ${MAX_BODY}.` })
        if (err.type === "entity.parse.failed") return res.status(400).json({ detail: "The event is not valid JSON." })
        next(err)
    })

    return router
}

module.exports = { eventRoutes }
