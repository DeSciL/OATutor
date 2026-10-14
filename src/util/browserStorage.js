import localforage from "localforage";
import { PROGRESS_STORAGE_KEY } from "../config/config.js";

import { currentUser } from "../auth/session";

const CANVAS_PROGRESS_KEY_MARKER = "::canvas::";
const USER_PROGRESS_KEY_MARKER = "::user::";

// Students share computers, so progress in this browser belongs to whoever is signed in.
const ownerSuffix = () => {
    const owner = currentUser()?.sub;
    return owner ? `${USER_PROGRESS_KEY_MARKER}${encodeURIComponent(owner)}` : "";
};

class BrowserStorage {
    /**
     * @private
     * @param key
     * @return {*}
     */
    getCtxByKey = (key) => this._app['state']['additionalContext'][key]

    /**
     * @private
     * @return {*}
     */
    noRestore = () => this.getCtxByKey('noRestore')
    /**
     * @private
     */
    _app;

    constructor(app) {
        this._app = app
    }

    getStorageKey = (key) => {
        const owned = [CANVAS_PROGRESS_KEY_MARKER, USER_PROGRESS_KEY_MARKER].some((marker) => String(key).includes(marker));
        if (typeof key !== "string" || !key.startsWith(PROGRESS_STORAGE_KEY) || owned) {
            return key;
        }
        if (ownerSuffix()) {
            return `${key}${ownerSuffix()}`;
        }

        const user = this._app.state.additionalContext.user || {};
        const isFromCanvas = String(user.tool_consumer_info_product_family_code || "").toLowerCase() === "canvas";
        const canvasProgressOwner = user.lis_result_sourcedid || user.user_id;

        return isFromCanvas && canvasProgressOwner
            ? `${key}${CANVAS_PROGRESS_KEY_MARKER}${encodeURIComponent(canvasProgressOwner)}`
            : key;
    }

    removeByKey = async key => localforage.removeItem(this.getStorageKey(key))
    getKeys = async () => {
        if (this.noRestore()) return false;
        const keys = await localforage.keys();
        // Resetting progress removes every key listed here, so list only this user's.
        return ownerSuffix() ? keys.filter((key) => key.endsWith(ownerSuffix())) : keys;
    }
    getByKey = async key => !this.noRestore() && localforage.getItem(this.getStorageKey(key))
    /**
     *
     * @param key
     * @param value
     * @param [callback]
     * @return {Promise<*>}
     */
    setByKey = async (key, value, callback) => {
        const storageKey = this.getStorageKey(key);
        console.debug('setting key', storageKey, 'to value', value)
        return localforage.setItem(storageKey, value, callback)
    }
}

export default BrowserStorage
