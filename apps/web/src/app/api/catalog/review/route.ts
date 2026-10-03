import {NextResponse} from "next/server";
import {checkMutationAuth} from "@/lib/mutation-auth";
import {ownerReviewList} from "@/lib/owner-review";
import {importMusicalReview} from "@/lib/owner-admission";
import {readJsonObject} from "@/lib/bounded-body";
import {PublicationRevisionConflictError} from "@/lib/catalog-api";
export const dynamic="force-dynamic";
export async function GET(req:Request){
 const auth=checkMutationAuth(req);if(auth)return auth;
 const after=new URL(req.url).searchParams.get("after")??"";
 if(after&&!/^[a-z0-9][a-z0-9-]{0,119}$/.test(after))return NextResponse.json({error:"Invalid review page."},{status:400});
 try{return NextResponse.json(await ownerReviewList(after),{headers:{"Cache-Control":"no-store"}});}
 catch{return NextResponse.json({error:"Review inventory unavailable. Catalog policy must be valid before inspection."},{status:503});}
}
export async function POST(req:Request) {
 const auth=checkMutationAuth(req);if(auth)return auth;
 const input=await readJsonObject(req,32768);if(input.response)return input.response;
 try {return NextResponse.json(await importMusicalReview(input.body,req.signal),{headers:{"Cache-Control":"no-store"}});}
 catch(error) {return NextResponse.json({error:error instanceof PublicationRevisionConflictError?"This publication changed. Reload before importing its review.":"Review import refused. Check the receipt schema, exact output, coverage and evidence. Existing music and policy are unchanged."},{status:error instanceof PublicationRevisionConflictError?409:422,headers:{"Cache-Control":"no-store"}});}
}
