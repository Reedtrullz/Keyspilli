import { notFound } from "next/navigation";
import { decideAccessAction } from "@/app/actions/access";
import { auth } from "@/auth";
import { listAccessRecords, type AccessRecord } from "@/lib/access-store";
import { accessRole } from "@/lib/authz";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

function configuredTesters(): string[] {
  return (process.env.TESTER_GITHUB_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
}

function DecisionButton({ id, decision, children, danger }: { id: string; decision: "approve" | "decline"; children: string; danger?: boolean }) {
  return (
    <form action={decideAccessAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="decision" value={decision} />
      <button
        type="submit"
        className={`min-h-11 rounded-md px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 ${danger ? "border border-zinc-300 hover:bg-zinc-100" : "bg-zinc-900 text-white hover:bg-zinc-700"}`}
      >
        {children}
      </button>
    </form>
  );
}

function Row({ record, children }: { record: AccessRecord; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-zinc-200 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          <a href={`https://github.com/${record.login}`} target="_blank" rel="noreferrer" className="underline">@{record.login}</a>
          {record.name ? <span className="font-normal text-zinc-600"> · {record.name}</span> : null}
        </p>
        <p className="text-xs text-zinc-500">
          GitHub id {record.id} · requested {new Date(record.requestedAt).toLocaleString("en-GB")}
        </p>
        {record.message ? <p className="mt-1 text-sm text-zinc-700">“{record.message}”</p> : null}
      </div>
      <div className="flex gap-2">{children}</div>
    </li>
  );
}

export default async function AdminPage() {
  if (accessRole((await auth())?.user) !== "owner") notFound();
  const records = listAccessRecords();
  const pending = records.filter((r) => r.status === "pending");
  const approved = records.filter((r) => r.status === "approved");
  const declined = records.filter((r) => r.status === "declined");
  const configured = configuredTesters();

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 space-y-10">
      <h1 className="text-2xl font-semibold">Admin</h1>

      <section aria-labelledby="pending-heading">
        <h2 id="pending-heading" className="text-lg font-semibold">Pending requests ({pending.length})</h2>
        {pending.length === 0 ? <p className="mt-3 text-sm text-zinc-600">No one is waiting.</p> : null}
        <ul className="mt-3 space-y-2">
          {pending.map((r) => (
            <Row key={r.id} record={r}>
              <DecisionButton id={r.id} decision="approve">Approve</DecisionButton>
              <DecisionButton id={r.id} decision="decline" danger>Decline</DecisionButton>
            </Row>
          ))}
        </ul>
      </section>

      <section aria-labelledby="testers-heading">
        <h2 id="testers-heading" className="text-lg font-semibold">Testers ({approved.length + configured.length})</h2>
        <ul className="mt-3 space-y-2">
          {approved.map((r) => (
            <Row key={r.id} record={r}>
              <DecisionButton id={r.id} decision="decline" danger>Remove access</DecisionButton>
            </Row>
          ))}
          {configured.map((id) => (
            <li key={id} className="rounded-md border border-zinc-200 p-3 text-sm text-zinc-600">
              GitHub id {id} · set in the deploy settings, remove it there
            </li>
          ))}
        </ul>
        {approved.length + configured.length === 0 ? <p className="mt-3 text-sm text-zinc-600">No testers yet.</p> : null}
      </section>

      {declined.length > 0 ? (
        <section aria-labelledby="declined-heading">
          <h2 id="declined-heading" className="text-lg font-semibold">Declined or removed ({declined.length})</h2>
          <ul className="mt-3 space-y-2">
            {declined.map((r) => (
              <Row key={r.id} record={r}>
                <DecisionButton id={r.id} decision="approve">Approve</DecisionButton>
              </Row>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
