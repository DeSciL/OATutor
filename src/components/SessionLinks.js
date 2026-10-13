import React from "react";
import Button from "@material-ui/core/Button";
import { currentUser, signOut } from "../auth/session";
import { useTranslation } from "../util/useTranslation";

/** Signing out and, for teachers, the way to the import page. */
export default function SessionLinks() {
    const { translate } = useTranslation();
    const user = currentUser();
    if (!user?.sub) return null;

    return (
        <>
            {user.role !== "student" && (
                <Button size="small" href="#/import">
                    {translate("platform.ImportContent")}
                </Button>
            )}
            <Button size="small" onClick={signOut}>
                {translate("platform.SignOut")}
            </Button>
        </>
    );
}
