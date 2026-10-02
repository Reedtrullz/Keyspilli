import {TombstoneRecovery} from "@/components/TombstoneRecovery";
import {OwnerReview} from "@/components/OwnerReview";
import Link from "next/link";
import {CatalogRecovery} from "@/components/CatalogRecovery";
export const dynamic="force-dynamic";
export default function MaintenancePage(){return <div className="page-shell max-w-3xl mx-auto px-4 py-8"><Link href="/">Return home</Link><h1 className="text-2xl font-semibold my-4">Owner catalog maintenance</h1><CatalogRecovery/><div className="mt-8"><TombstoneRecovery/></div><div className="mt-8"><OwnerReview/></div></div>;}
