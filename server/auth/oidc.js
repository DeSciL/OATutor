/** The Keycloak realm, reduced to what the sign-in routes need. */
async function connectOidc(settings) {
    // Both are ES modules, which this CommonJS server can only load this way on Node 20.
    const client = await import("openid-client")
    const { createRemoteJWKSet, jwtVerify } = await import("jose")

    // A local Keycloak has no certificate.
    const options = settings.issuer.startsWith("http://") ? { execute: [client.allowInsecureRequests] } : undefined
    const config = await client.discovery(new URL(settings.issuer), settings.clientId, settings.clientSecret, undefined, options)
    const metadata = config.serverMetadata()
    const keys = createRemoteJWKSet(new URL(metadata.jwks_uri))
    const redirectUri = `${settings.publicBaseUrl}/api/auth/callback`

    return {
        async begin() {
            const verifier = client.randomPKCECodeVerifier()
            const state = client.randomState()
            const url = client.buildAuthorizationUrl(config, {
                redirect_uri: redirectUri,
                scope: "openid profile",
                code_challenge: await client.calculatePKCECodeChallenge(verifier),
                code_challenge_method: "S256",
                state,
            })
            return { url: url.href, pending: { verifier, state } }
        },

        async finish(callbackPath, pending) {
            const tokens = await client.authorizationCodeGrant(config, new URL(callbackPath, settings.publicBaseUrl), {
                pkceCodeVerifier: pending.verifier,
                expectedState: pending.state,
            })
            const claims = tokens.claims()
            // Keycloak puts client roles in the access token but not, by default, in the ID token.
            const { payload } = await jwtVerify(tokens.access_token, keys, { issuer: metadata.issuer })
            if (payload.azp !== settings.clientId) throw new Error("The access token was issued to another client.")
            return {
                sub: claims.sub,
                name: claims.name || claims.preferred_username || "",
                roles: payload.resource_access?.[settings.rolesClient]?.roles || [],
            }
        },

        endSessionUrl() {
            // No id_token_hint, so Keycloak asks before signing out; that spares keeping the token in the cookie.
            return client.buildEndSessionUrl(config, {
                client_id: settings.clientId,
                post_logout_redirect_uri: `${settings.publicBaseUrl}/`,
            }).href
        },
    }
}

module.exports = { connectOidc }
