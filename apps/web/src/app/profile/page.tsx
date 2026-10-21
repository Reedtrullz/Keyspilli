import { redirect } from "next/navigation";
import Link from "next/link";
import { requestAccessAction } from "@/app/actions/access";
import { signOutAction } from "@/app/actions/auth";
import { auth } from "@/auth";
import { getAccessRecord, MAX_MESSAGE_LENGTH } from "@/lib/access-store";
import { accessRole, type AccessRole } from "@/lib/authz";

export const metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<AccessRole, string> = {
  owner: "Owner",
  tester: "Tester",
  pending: "Request pending",
  declined: "Request declined",
  none: "No access yet",
  anonymous: "Signed out",
};

export default async function ProfilePage() {
  const user = (await auth())?.user;
  const role = accessRole(user);
  if (role === "anonymous" || !user) redirect("/signin?callbackUrl=%2Fprofile");
  const record = user.id ? safeRecord(user.id) : undefined;

  return (
    <div className="max-w-xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-semibold">Profile</h1>
      <section aria-label="GitHub account" className="mt-6 flex items-center gap-4">
        {user.image ? (
          <img src={user.image} alt="" width={56} height={56} referrerPolicy="no-referrer" className="h-14 w-14 rounded-full border border-zinc-200" />
        ) : null}
        <div className="min-w-0">
          <p className="truncate font-medium">{user.name ?? user.login ?? "GitHub account"}</p>
          <p className="truncate text-sm text-zinc-600">
            {user.login ? `@${user.login} · ` : ""}GitHub id {user.id}
          </p>
        </div>
        <span className="ml-auto shrink-0 rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold">{ROLE_LABEL[role]}</span>
      </section>

      {role === "owner" || role === "tester" ? (
        <p className="mt-6 text-sm text-zinc-700">
          {role === "owner" ? "You are the owner of this Keyspilli." : "You have tester access."}{" "}
          <Link href="/songs" className="underline">Open songs</Link>
          {role === "owner" ? (
            <>
              {" · "}
              <Link href="/admin" className="underline">Manage testers</Link>
            </>
          ) : null}
        </p>
      ) : null}

      {role === "none" ? (
        <form action={requestAccessAction} className="mt-8 rounded-md border border-zinc-200 p-4">
          <h2 className="font-semibold">Keyspilli is private</h2>
          <p className="mt-2 text-sm text-zinc-600">
            This GitHub account is not on the tester list. You can ask the owner for tester access.
          </p>
          <label htmlFor="message" className="mt-4 block text-sm font-medium">Note to the owner (optional)</label>
          <textarea id="message" name="message" rows={3} maxLength={MAX_MESSAGE_LENGTH} className="mt-1 w-full rounded-md border border-zinc-300 p-2 text-sm" />
          <button type="submit" className="mt-4 min-h-11 rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2">
            Apply for tester access
          </button>
        </form>
      ) : null}

      {role === "pending" ? (
        <p role="status" className="mt-8 rounded-md border border-zinc-200 p-4 text-sm text-zinc-700">
          Your request{record ? ` from ${new Date(record.requestedAt).toLocaleDateString("en-GB")}` : ""} is waiting for the owner. Come back after it has been approved.
        </p>
      ) : null}

      {role === "declined" ? (
        <p role="status" className="mt-8 rounded-md border border-zinc-200 p-4 text-sm text-zinc-700">
          The owner has not granted this account tester access.
        </p>
      ) : null}

      <form action={signOutAction} className="mt-10">
        <button type="submit" className="min-h-11 rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2">
          Sign out
        </button>
      </form>
    </div>
  );
}

function safeRecord(id: string) {
  try {
    return getAccessRecord(id);
  } catch {
    return undefined;
  }
}
