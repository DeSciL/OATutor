const cookieSession = require("cookie-session")

const SESSION_HOURS = 8
const ANONYMOUS = { sub: null, name: "", role: "anonymous" }

function sessions(settings) {
    // With sign-in off there is nothing to remember: every request is the same anonymous visitor.
    if (settings.mode === "off") {
        return (req, res, next) => {
            req.session = { user: ANONYMOUS }
            next()
        }
    }
    // A signed cookie, so the server keeps nothing between requests.
    return cookieSession({
        name: "oatutor_session",
        keys: [settings.sessionSecret],
        maxAge: SESSION_HOURS * 60 * 60 * 1000,
        httpOnly: true,
        // Lax keeps the cookie off cross-site POSTs, which is what protects the routes that change something.
        sameSite: "lax",
        secure: settings.secure,
    })
}

function requireUser(req, res, next) {
    if (!req.session?.user) return res.status(401).json({ detail: "Please sign in." })
    next()
}

module.exports = { sessions, requireUser }
