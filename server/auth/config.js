const crypto = require("crypto")

// off: no sign-in, every lesson open to every visitor. oidc: Keycloak. dev: everyone is an admin.
const MODES = ["off", "oidc", "dev"]

/** Sign-in settings from the environment; refuses ones that would let everyone in by accident, or no one. */
function authSettings(env) {
    const mode = env.AUTH_MODE || "off"
    if (!MODES.includes(mode)) throw new Error(`AUTH_MODE must be one of: ${MODES.join(", ")}.`)

    const publicBaseUrl = (env.PUBLIC_BASE_URL || "").replace(/\/$/, "")
    const settings = {
        mode,
        publicBaseUrl,
        secure: publicBaseUrl.startsWith("https://"),
        sessionSecret: env.SESSION_SECRET,
        issuer: env.OIDC_ISSUER,
        clientId: env.OIDC_CLIENT_ID,
        clientSecret: env.OIDC_CLIENT_SECRET,
        // Teachers are whoever TutorCreator calls a teacher, so its client's roles are read here too.
        rolesClient: env.OIDC_ROLES_CLIENT || "tutor-creator-client",
        teacherRole: env.OIDC_TEACHER_ROLE || "teacher",
        adminRole: env.OIDC_ADMIN_ROLE || "admin",
    }

    if (mode === "off") return settings

    if (mode === "dev") {
        if (settings.secure) {
            throw new Error("AUTH_MODE=dev signs every visitor in as an admin and must not run behind https.")
        }
        // Dev sessions may die with the process.
        return { ...settings, sessionSecret: settings.sessionSecret || crypto.randomBytes(32).toString("hex") }
    }

    const required = ["SESSION_SECRET", "OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "PUBLIC_BASE_URL"]
    const missing = required.filter(name => !env[name])
    if (missing.length > 0) {
        throw new Error(`AUTH_MODE=oidc needs ${missing.join(", ")}.`)
    }
    return settings
}

module.exports = { authSettings }
