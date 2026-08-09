import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Health/version contract used by the Ansible deploy playbook. */
export async function GET() {
  const version = process.env.VERSION ?? process.env.APP_VERSION ?? "dev";
  return NextResponse.json({
    status: "healthy",
    version,
    commit: version,
    image: process.env.IMAGE_REF ?? null,
  });
}
