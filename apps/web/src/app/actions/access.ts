"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { AccessError, MAX_MESSAGE_LENGTH, decideAccess, requestAccess } from "@/lib/access-store";
import { accessRole } from "@/lib/authz";

/** A signed-in account without access asks to become a tester. */
export async function requestAccessAction(formData: FormData) {
  const user = (await auth())?.user;
  if (accessRole(user) === "none" && user?.id) {
    const message = formData.get("message");
    requestAccess({
      id: user.id,
      login: user.login,
      name: user.name,
      message: typeof message === "string" ? message.slice(0, MAX_MESSAGE_LENGTH) : "",
    });
  }
  revalidatePath("/profile");
  redirect("/profile");
}

/** Owner only; the role is re-read from the session on every call, not trusted from the page. */
export async function decideAccessAction(formData: FormData) {
  const owner = (await auth())?.user;
  if (accessRole(owner) !== "owner" || !owner?.id) throw new AccessError("forbidden");
  const id = formData.get("id");
  const decision = formData.get("decision");
  if (typeof id !== "string" || !/^\d{1,20}$/.test(id)) throw new AccessError("invalid id");
  if (decision !== "approve" && decision !== "decline") throw new AccessError("invalid decision");
  decideAccess(id, decision === "approve" ? "approved" : "declined", owner.id);
  revalidatePath("/admin");
}
