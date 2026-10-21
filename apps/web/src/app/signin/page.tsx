import { redirect } from "next/navigation";
import { signInWithGitHub } from "@/app/actions/auth";
import { auth } from "@/auth";
import { isAllowedUser, safeCallbackPath } from "@/lib/authz";

export const metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const [session, params] = await Promise.all([auth(), searchParams]);
  const callbackUrl = safeCallbackPath(params.callbackUrl);
  if (isAllowedUser(session?.user)) redirect(callbackUrl);

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <h1 className="text-2xl font-semibold">Sign in to Keyspilli</h1>
      <p className="mt-3 text-sm text-zinc-600">Keyspilli is private. Sign in with the GitHub account that has been invited.</p>
      {params.error ? (
        <p role="alert" className="mt-5 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          That GitHub account does not have access, or sign-in was cancelled.
        </p>
      ) : null}
      <form action={signInWithGitHub} className="mt-6">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <button type="submit" className="min-h-11 rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2">
          Continue with GitHub
        </button>
      </form>
    </div>
  );
}
