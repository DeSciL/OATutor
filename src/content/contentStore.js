import { CONTENT_SOURCE } from "@common/global-config";
import builtinCoursePlans from "../content-sources/oatutor/coursePlans.json";
import builtinSkillModel from "../content-sources/oatutor/skillModel.json";
import builtinDefaultBKTParams from "../content-sources/oatutor/bkt-params/defaultBKTParams.json";
import builtinExperimentalBKTParams from "../content-sources/oatutor/bkt-params/experimentalBKTParams.json";

// The only place content comes from. The problem pool is fetched rather than
// bundled (see src/tools/preprocessProblemPool.js), and courses imported at
// runtime (see server/importer) are merged into these same objects. src/index.js
// does both before loading anything that reads them, so importing the JSON
// directly elsewhere would miss the problems and the imported courses.

export const coursePlans = builtinCoursePlans;
export const skillModel = builtinSkillModel;
export const defaultBKTParams = builtinDefaultBKTParams;
export const experimentalBKTParams = builtinExperimentalBKTParams;
export const problemPool = [];

let applied = false;

function addMissing(target, additions = {}) {
    for (const [key, value] of Object.entries(additions)) {
        // Built-in entries win: replacing them would change how existing lessons behave.
        if (!(key in target)) target[key] = value;
    }
}

export function applyOverlay(overlay) {
    if (applied || !overlay) return;
    applied = true;
    coursePlans.push(...(overlay.coursePlans || []));
    problemPool.push(...(overlay.problems || []));
    addMissing(skillModel, overlay.skillModel);
    addMissing(defaultBKTParams, overlay.bktParams?.default);
    addMissing(experimentalBKTParams, overlay.bktParams?.experimental);
}

async function fetchJson(path, { timeoutMs } = {}) {
    const controller = new AbortController();
    const timer = timeoutMs && setTimeout(() => controller.abort(), timeoutMs);
    try {
        // no-cache still uses the cached copy, after the server confirms it is current.
        const response = await fetch(`${process.env.PUBLIC_URL}${path}`, { signal: controller.signal, cache: "no-cache" });
        if (!response.ok) throw new Error(`${path} returned ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

let poolLoaded = false;

export async function loadProblemPool() {
    if (poolLoaded) return;
    const problems = await fetchJson(`/content-pool/${CONTENT_SOURCE}.json`);
    poolLoaded = true;
    problemPool.unshift(...problems);
}

export function loadOverlay({ timeoutMs = 3000 } = {}) {
    return fetchJson("/api/content/overlay", { timeoutMs });
}
