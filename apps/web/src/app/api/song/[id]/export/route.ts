import { NextRequest, NextResponse } from "next/server";
import {renderPdfResponse} from "@/lib/pdf-export";
import { getArtifactFileWithRevision, getSongDetailShell, PublicationRevisionConflictError } from "@/lib/catalog-api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const value = req.nextUrl.searchParams.get("revision");
  const requiredRevision = value === null ? undefined : value === "unpinned" ? null : value;
  const type = req.nextUrl.searchParams.get("type") ?? "midi";
  const layout = req.nextUrl.searchParams.get("layout") ?? "simplify";

  if (type === "midi" || type === "musicxml") {
    try {
      const artifact = await getArtifactFileWithRevision(id, type === "midi" ? "variant.mid" : "variant.xml", requiredRevision);
      if (!artifact) return NextResponse.json({ error: "not found" }, { status: 404 });
      return new NextResponse(new Uint8Array(artifact.data), {
      headers: {
        "Content-Type": type === "midi" ? "audio/midi" : "application/vnd.recordare.musicxml+xml",
        "Content-Disposition": `attachment; filename="${id}.${type === "midi" ? "mid" : "musicxml"}"`,
        "X-Publication-Revision": artifact.publicationRevision ?? "unpinned",
      },
      });
    } catch (error) {
      if (error instanceof PublicationRevisionConflictError) {
        return NextResponse.json({ error: error.message, code: "PUBLICATION_REVISION_CONFLICT" }, { status: 409, headers: { "Cache-Control": "no-store" } });
      }
      throw error;
    }
  }

  if (type === "pdf") {
    if (layout !== "simplify" && layout !== "classic") {
      return NextResponse.json({ error: "unknown PDF layout" }, { status: 400 });
    }
    let shell;
    try {
      shell = await getSongDetailShell(id, requiredRevision);
    } catch (error) {
      if (error instanceof PublicationRevisionConflictError) {
        return NextResponse.json({ error: error.message, code: "PUBLICATION_REVISION_CONFLICT" }, { status: 409, headers: { "Cache-Control": "no-store" } });
      }
      throw error;
    }
    if (!shell) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (layout === "classic") {
      if (shell.song.hasSheetXml !== 1) {
        return NextResponse.json(
          { error: "classic PDF unavailable", code: "CLASSIC_PDF_UNAVAILABLE" },
          { status: 404 },
        );
      }
    }

    return renderPdfResponse(req,id,layout,shell);
  }
  return NextResponse.json({ error: "unknown type" }, { status: 400 });
}
