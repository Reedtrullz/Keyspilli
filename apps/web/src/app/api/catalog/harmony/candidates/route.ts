import { NextResponse } from "next/server";
import { checkMutationAuth } from "@/lib/mutation-auth";
import { readJsonObject } from "@/lib/bounded-body";
import { PublicationRevisionConflictError } from "@/lib/catalog-api";
import { ArtifactReconciliationError } from "@keyspilli/catalog";
import { getHarmonyCandidate, listHarmonyCandidates, saveHarmonyCandidate, importHarmonyReview, publishHarmonyCandidate } from "@/lib/harmony-publication";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
function failure(error: unknown) {
    const conflict = error instanceof PublicationRevisionConflictError, reconciliation = error instanceof ArtifactReconciliationError;
    return NextResponse.json({ error: reconciliation ? "Backing publication requires reconciliation. Preserve the journal and reload maintenance before retrying." : conflict ? "This publication changed. Reload before working on this candidate." : "Candidate operation refused. Check the exact preview, frozen files, complete review evidence and owner authorization.", ...(reconciliation ? { reconciliationRequired: true } : {}) }, { status: reconciliation ? 503 : conflict ? 409 : 422, headers });
}
export async function GET(req: Request) {
    const auth = checkMutationAuth(req);
    if (auth)
        return auth;
    const query = new URL(req.url).searchParams, id = query.get("id"), revision = query.get("revision"), sha = query.get("candidateSha256");
    if (!id || !revision)
        return NextResponse.json({ error: "Choose an exact Advanced version." }, { status: 400, headers });
    try {
        return NextResponse.json(sha ? await getHarmonyCandidate(id, revision, sha) : await listHarmonyCandidates(id, revision), { headers });
    }
    catch (error) {
        return failure(error);
    }
}
export async function POST(req: Request) {
    const auth = checkMutationAuth(req);
    if (auth)
        return auth;
    const input = await readJsonObject(req, 65536);
    if (input.response)
        return input.response;
    try {
        return NextResponse.json(await saveHarmonyCandidate(input.body, req.signal), { headers });
    }
    catch (error) {
        return failure(error);
    }
}
export async function PATCH(req: Request) {
    const auth = checkMutationAuth(req);
    if (auth)
        return auth;
    const input = await readJsonObject(req, 65536);
    if (input.response)
        return input.response;
    const body = input.body;
    if (Object.keys(body).sort().join(" ") !== "candidateSha256 id receipt revision" || typeof body.id !== "string" || typeof body.revision !== "string" || typeof body.candidateSha256 !== "string")
        return NextResponse.json({ error: "Choose an exact candidate and review receipt." }, { status: 400, headers });
    try {
        return NextResponse.json(await importHarmonyReview(body.id, body.revision, body.candidateSha256, body.receipt, req.signal), { headers });
    }
    catch (error) {
        return failure(error);
    }
}
export async function PUT(req: Request) {
    const auth = checkMutationAuth(req);
    if (auth)
        return auth;
    const input = await readJsonObject(req, 32768);
    if (input.response)
        return input.response;
    try {
        return NextResponse.json(await publishHarmonyCandidate(input.body, req.signal), { headers });
    }
    catch (error) {
        return failure(error);
    }
}
