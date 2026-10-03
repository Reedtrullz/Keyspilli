import Link from "next/link";
import {OwnerHarmony} from "@/components/OwnerHarmony";
export const dynamic="force-dynamic";
export default async function HarmonyPage({searchParams}:{searchParams:Promise<{id?:string;revision?:string}>}){const {id,revision}=await searchParams;return <div className="page-shell max-w-3xl mx-auto px-4 py-8"><Link href="/maintenance">Return to owner maintenance</Link><h1 className="text-2xl font-semibold my-4">Owner harmony preview</h1>{id&&/^[a-z0-9][a-z0-9-]{0,125}$/.test(id)&&revision&&/^[A-Za-z0-9_-]{1,128}$/.test(revision)?<OwnerHarmony key={`${id}:${revision}`} songId={id} revision={revision}/>:<p>Choose a pinned variant from the review inventory.</p>}</div>;}
