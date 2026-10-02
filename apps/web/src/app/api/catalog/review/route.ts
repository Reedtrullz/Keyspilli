import {NextResponse} from "next/server";
import {checkMutationAuth} from "@/lib/mutation-auth";
import {ownerReviewList} from "@/lib/owner-review";
export const dynamic="force-dynamic";
export async function GET(req:Request){
 const auth=checkMutationAuth(req);if(auth)return auth;
 const after=new URL(req.url).searchParams.get("after")??"";
 if(after&&!/^[a-z0-9][a-z0-9-]{0,119}$/.test(after))return NextResponse.json({error:"Invalid review page."},{status:400});
 try{return NextResponse.json(await ownerReviewList(after),{headers:{"Cache-Control":"no-store"}});}
 catch{return NextResponse.json({error:"Review inventory unavailable. Catalog policy must be valid before inspection."},{status:503});}
}
