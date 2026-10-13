// Who is using the site. src/index.js loads this before the app, so everything
// that renders can read it without waiting. A server running without sign-in
// (AUTH_MODE=off) answers with an anonymous user: no sub, role "anonymous".

const api = path => `${process.env.PUBLIC_URL}/api/auth${path}`;

// `npm start` on its own has no server to ask.
const LOCAL_USER = { sub: null, name: "", role: "anonymous" };

let user = null;

export const currentUser = () => user;

/** Lesson links are hash routes, which the server never sees, so the fragment travels as a parameter. */
export const signInUrl = () => api(`/login?next=${encodeURIComponent(window.location.hash)}`);

/** The signed-in user, or null when the visitor has yet to sign in. */
export async function loadUser() {
    const response = await fetch(api("/me"), { cache: "no-store" }).catch(() => null);
    if (response?.status === 401) return null;
    const isJson = response?.headers.get("content-type")?.includes("application/json");
    if (response?.ok && isJson) {
        user = await response.json();
    } else if (process.env.NODE_ENV === "development") {
        user = LOCAL_USER;
    } else {
        throw new Error(`Could not check who is signed in (${response?.status ?? "no answer"}).`);
    }
    return user;
}

export async function signOut() {
    const response = await fetch(api("/logout"), { method: "POST" });
    const { redirect } = await response.json();
    window.location.assign(redirect);
}
