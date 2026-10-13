import React, { useCallback, useEffect, useState } from "react";
import { AppBar, Box, Button, CircularProgress, Grid, Paper, TextField, Toolbar, Typography } from "@material-ui/core";
import BrandLogoNav from "@components/BrandLogoNav";
import { currentUser } from "../auth/session";

const TOKEN_KEY = "import:token";

const readToken = () => {
    try {
        return sessionStorage.getItem(TOKEN_KEY) || "";
    } catch {
        return "";
    }
};

const storeToken = value => {
    try {
        if (value) sessionStorage.setItem(TOKEN_KEY, value);
        else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
        // Private windows may refuse storage; the token then lasts until reload.
    }
};

// A signed-in teacher is known by the session cookie; without sign-in the import token speaks instead.
async function request(path, token, options = {}) {
    const response = await fetch(`${process.env.PUBLIC_URL}/api${path}`, {
        ...options,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
        const error = new Error(body?.detail || `The server answered ${response.status}.`);
        error.issues = body?.issues || [];
        error.status = response.status;
        throw error;
    }
    return body;
}

// Imported courses are merged in when the app starts (src/index.js), so a
// lesson imported a moment ago only exists after a full reload.
const openLesson = (event, lessonId) => {
    event.preventDefault();
    window.location.hash = `#/lessons/${lessonId}`;
    window.location.reload();
};

const LessonLinks = ({ lessonIds }) =>
    lessonIds.map(id => (
        <div key={id}>
            <a href={`#/lessons/${id}`} onClick={event => openLesson(event, id)}>
                {id}
            </a>
        </div>
    ));

const Issues = ({ items }) =>
    items.length > 0 && (
        <ul>
            {items.map(item => (
                <li key={item}>{item}</li>
            ))}
        </ul>
    );

const box = { padding: 16, marginTop: 16 };

const ImportContent = () => {
    const role = currentUser()?.role;
    // Nobody is signed in when the site runs without sign-in; then the import token decides.
    const byToken = role === "anonymous";
    const [token, setToken] = useState(() => (byToken ? readToken() : ""));
    const [draftToken, setDraftToken] = useState("");
    const mayImport = byToken ? Boolean(token) : role === "teacher" || role === "admin";
    const mayRemove = byToken ? Boolean(token) : role === "admin";
    const [sources, setSources] = useState(null);
    const [busy, setBusy] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    const changeToken = value => {
        storeToken(value);
        setToken(value);
        setResult(null);
        setError(null);
    };

    const refresh = useCallback(async () => {
        if (!mayImport) return setSources(null);
        try {
            setSources(await request("/imports", token));
        } catch (err) {
            setSources(null);
            setError(err);
            if (byToken && err.status === 401) {
                storeToken("");
                setToken("");
            }
        }
    }, [mayImport, byToken, token]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const upload = async file => {
        if (!file || busy) return;
        setBusy(true);
        setResult(null);
        setError(null);
        const form = new FormData();
        form.append("file", file);
        try {
            setResult(await request("/imports", token, { method: "POST", body: form }));
            await refresh();
        } catch (err) {
            setError(err);
        } finally {
            setBusy(false);
        }
    };

    const remove = async sourceKey => {
        if (!window.confirm(`Remove ${sourceKey} and its lessons from OATutor?`)) return;
        setResult(null);
        setError(null);
        try {
            await request(`/imports/${encodeURIComponent(sourceKey)}`, token, { method: "DELETE" });
            await refresh();
        } catch (err) {
            setError(err);
        }
    };

    const onDrop = event => {
        event.preventDefault();
        setDragging(false);
        if (mayImport) upload(event.dataTransfer.files[0]);
    };

    return (
        <div style={{ backgroundColor: "#F6F6F6", minHeight: "100vh", paddingBottom: 40 }}>
            <AppBar position="static">
                <Toolbar>
                    <Grid container spacing={0} role={"navigation"}>
                        <Grid item xs={3}>
                            <BrandLogoNav />
                        </Grid>
                    </Grid>
                </Toolbar>
            </AppBar>
            <Box maxWidth={800} margin="0 auto" padding="16px">
                <Typography variant="h4" component="h1" gutterBottom>
                    Import content
                </Typography>
                {mayImport || byToken ? (
                    <Typography>
                        Drop a zip exported from TutorCreator, or any OATutor content source with a manifest.json.
                        Importing the same source again replaces it.
                    </Typography>
                ) : (
                    <Typography>Only teachers can import content.</Typography>
                )}

                {byToken &&
                    (token ? (
                        <Typography style={{ marginTop: 16 }}>
                            Using the import token.{" "}
                            <Button size="small" onClick={() => changeToken("")}>
                                Forget it
                            </Button>
                        </Typography>
                    ) : (
                        <form
                            style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}
                            onSubmit={event => {
                                event.preventDefault();
                                changeToken(draftToken.trim());
                            }}
                        >
                            <TextField
                                label="Import token"
                                type="password"
                                variant="outlined"
                                size="small"
                                value={draftToken}
                                onChange={event => setDraftToken(event.target.value)}
                            />
                            <Button type="submit" variant="contained" color="primary" disabled={!draftToken.trim()}>
                                Continue
                            </Button>
                        </form>
                    ))}

                {mayImport && (
                    <Paper
                        variant="outlined"
                        onDragOver={event => {
                            event.preventDefault();
                            setDragging(true);
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={onDrop}
                        style={{
                            ...box,
                            padding: 40,
                            textAlign: "center",
                            borderStyle: "dashed",
                            borderWidth: 2,
                            borderColor: dragging ? "#3f51b5" : undefined,
                        }}
                    >
                        {busy ? (
                            <CircularProgress />
                        ) : (
                            <>
                                <Typography gutterBottom>Drop the zip here, or</Typography>
                                <Button variant="outlined" component="label">
                                    Choose a file
                                    <input
                                        type="file"
                                        accept=".zip,application/zip"
                                        hidden
                                        onChange={event => {
                                            upload(event.target.files[0]);
                                            event.target.value = "";
                                        }}
                                    />
                                </Button>
                            </>
                        )}
                    </Paper>
                )}

                {result && (
                    <Paper style={{ ...box, borderLeft: "4px solid #2e7d32" }}>
                        <Typography>
                            {result.replaced ? "Replaced" : "Imported"} <b>{result.sourceKey}</b> with{" "}
                            {result.problemCount} problems. Open a lesson:
                        </Typography>
                        <LessonLinks lessonIds={result.lessonIds} />
                        {result.warnings.length > 0 && <Typography style={{ marginTop: 8 }}>Warnings:</Typography>}
                        <Issues items={result.warnings} />
                    </Paper>
                )}

                {error && (
                    <Paper style={{ ...box, borderLeft: "4px solid #c62828" }} role="alert">
                        <Typography>{error.message}</Typography>
                        <Issues items={error.issues} />
                    </Paper>
                )}

                {sources && (
                    <Paper style={box}>
                        <Typography variant="h6" component="h2">
                            Imported sources
                        </Typography>
                        {sources.length === 0 && <Typography>Nothing has been imported yet.</Typography>}
                        {sources.map(source => (
                            <div key={source.sourceKey} style={{ borderTop: "1px solid #eee", paddingTop: 8, marginTop: 8 }}>
                                <Typography>
                                    <b>{source.courseNames.join(", ")}</b> ({source.problemCount} problems, imported{" "}
                                    {new Date(source.importedAt).toLocaleString()})
                                </Typography>
                                <Typography variant="body2" color="textSecondary">
                                    {source.sourceKey}
                                </Typography>
                                <LessonLinks lessonIds={source.lessonIds} />
                                {/* Signed-in teachers unpublish in TutorCreator, which knows whose source this is. */}
                                {mayRemove && (
                                    <Button size="small" color="secondary" onClick={() => remove(source.sourceKey)}>
                                        Remove
                                    </Button>
                                )}
                            </div>
                        ))}
                    </Paper>
                )}
            </Box>
        </div>
    );
};

export default ImportContent;
