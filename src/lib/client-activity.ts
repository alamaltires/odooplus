import { getAuth } from "firebase/auth";

type ClientActivity = {
    action: string;
    category: "account" | "navigation" | "export" | "write" | "settings";
    target?: string;
    detail?: string;
};

/** Reports something only the browser knows about to the admin activity log. Best effort: never throws or blocks. */
export async function logActivity(entry: ClientActivity): Promise<void> {
    try {
        const user = getAuth().currentUser;
        if (!user) return;
        const token = await user.getIdToken();
        await fetch("/api/activity", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(entry),
            keepalive: true,
        });
    } catch {
        // logging must never get in the way
    }
}

/** Saves a workbook and records the download. */
export function writeWorkbook(XLSX: typeof import("xlsx"), workbook: import("xlsx").WorkBook, fileName: string) {
    void logActivity({ action: "Exported to Excel", category: "export", target: fileName });
    XLSX.writeFile(workbook, fileName);
}
