const path = require("path")
const compression = require("compression")
const express = require("express")
const { authRoutes } = require("./auth/routes")
const { requireUser, sessions } = require("./auth/session")
const { eventRoutes } = require("./events/routes")
const { importRoutes } = require("./importer/routes")

function createApp({ buildDir, store, importToken, publicBaseUrl, auth, oidc, events }) {
    const app = express()
    app.disable("x-powered-by")
    // One ingress sits in front; its X-Forwarded-Proto is what allows a Secure session cookie.
    app.set("trust proxy", 1)
    // The problem pool is 36 MB of JSON; compressed it is a fraction of that.
    app.use(compression())

    const session = sessions(auth)
    app.get("/api/health", (req, res) => res.json({ status: "ok" }))
    // The path the static nginx image answered on, so existing probes keep working.
    app.get("/healthz", (req, res) => res.type("text/plain").send("ok\n"))
    app.use("/api", session)
    app.use("/api/auth", authRoutes({ settings: auth, oidc }))
    app.use("/api/events", eventRoutes({ events }))
    app.use("/api", importRoutes({ store, importToken, publicBaseUrl }))

    // CRA fingerprints these, so they can be cached for good. The rest of /static
    // (figures, icons) keeps its name across deploys and must stay revalidated.
    for (const hashed of ["js", "css", "media"]) {
        app.use(`/static/${hashed}`, express.static(path.join(buildDir, "static", hashed), { immutable: true, maxAge: "1y" }))
    }
    app.use(express.static(buildDir))
    // Imported figures sit at the same URLs as built-in ones, so the renderer needs no change.
    app.use("/static/images/figures/oatutor", session, requireUser, express.static(store.figuresDir))

    return app
}

module.exports = { createApp }
