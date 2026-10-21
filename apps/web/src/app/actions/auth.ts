"use server";

import { signIn, signOut } from "@/auth";
import { safeCallbackPath } from "@/lib/authz";

export async function signInWithGitHub(formData: FormData) {
  await signIn("github", { redirectTo: safeCallbackPath(formData.get("callbackUrl")) });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}
