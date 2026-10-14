const express = require("express")
const { requireUser } = require("./session")

function roleFor(roles, settings) {
    if (roles.includes(settings.adminRole)) return "admin"
    if (roles.includes(settings.teacherRole)) return "teacher"
    return "student"
}

// Lesson links are hash routes. Anything else could send the browser to another site.
const safeNext = next => (typeof next === "string" && next.startsWith("#/") ? next : "")

function authRoutes({ settings, oidc }) {
    const router = express.Router()

    router.get("/me", requireUser, (req, res) => res.json(req.session.user))
    // The app still asks who is there, and is told: nobody in particular.
    if (settings.mode === "off") return router

    const signedIn = (req, res, user) => {
        const next = safeNext(req.session.next)
        // A fresh session, so nothing from before sign-in carries over.
        req.session = { user }
        res.redirect(303, `/${next}`)
    }

    router.get("/login", async (req, res) => {
        req.session.next = safeNext(req.query.next)
        if (settings.mode === "dev") return signedIn(req, res, { sub: "dev", name: "Dev", role: "admin" })
        const { url, pending } = await oidc.begin()
        req.session.pending = pending
        res.redirect(303, url)
    })

    router.get("/callback", async (req, res) => {
        const pending = req.session.pending
        let identity
        try {
            if (!pending) throw new Error("no sign-in was started in this browser")
            identity = await oidc.finish(req.originalUrl, pending)
        } catch (err) {
            console.warn(`Sign-in failed: ${err.message}`)
            return res.redirect(303, "/?auth_error=failed")
        }
        signedIn(req, res, { sub: identity.sub, name: identity.name, role: roleFor(identity.roles, settings) })
    })

    router.post("/logout", (req, res) => {
        req.session = null
        // Ending only our session would sign the next person at this computer straight back in.
        res.json({ redirect: settings.mode === "dev" ? "/" : oidc.endSessionUrl() })
    })

    return router
}

module.exports = { authRoutes }
