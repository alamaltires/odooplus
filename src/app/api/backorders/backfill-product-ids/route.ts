import { NextResponse } from "next/server";

export async function POST(request: Request) {
    void request;
    return NextResponse.json(
        {
            error: "Temporary backfill is disabled.",
        },
        { status: 410 }
    );
}

/*
Temporary backfill kept for reference. Re-enable only when a one-time migration is needed.

import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import {
    backfillBackorderProductCategoriesTemporary,
    backfillMissingBackorderProductIdsTemporary,
} from "@/lib/server/backorders-store";

export async function POST(request: Request) {
    const { credentials } = await getOdooCredentialsFromRequest(request);
    const productIdBackfill = await backfillMissingBackorderProductIdsTemporary(credentials);
    const categoryBackfill = await backfillBackorderProductCategoriesTemporary(credentials);
    return NextResponse.json({ success: true, productIdBackfill, categoryBackfill });
}
*/
