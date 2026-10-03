import {expect, it} from "vitest";
import {parseMusicalReviewReceipt, summarizeMusicalReviews} from "../src/musical-review.js";

const identity = {baseId:"fixture",variantId:"fixture-a",mode:"Chords" as const,publicationRevision:"version1",sourceArtifactSha256:"a".repeat(64),sourceFingerprint:"source:v1",playbackSha256:"b".repeat(64)};
const evidence = [{id:"review-session",sha256:"c".repeat(64)}];
const receipt = () => ({schemaVersion:1,kind:"musical-review-receipt",...identity,reviewer:{id:"independent-player",role:"pianist",independent:true},reviewedAt:"2026-10-03T11:00:00Z",coverage:[{startBeat:0,endBeat:8}],decision:"accepted",rationale:"Reviewed exact output and physical keyboard releases.",checks:{source:{result:"passed",evidence},listening:{result:"passed",evidence},keyboard:{result:"passed",evidence}}});

it("keeps partial, stale, rejected and separate mode receipts distinct from full acceptance",()=>{
 const full=parseMusicalReviewReceipt(receipt());
 expect(summarizeMusicalReviews([full],identity,8).status).toBe("accepted");
 const partial=parseMusicalReviewReceipt({...receipt(),coverage:[{startBeat:0,endBeat:4}]});
 expect(summarizeMusicalReviews([partial],identity,8)).toMatchObject({status:"partial",listening:"partial",keyboard:"partial"});
 expect(summarizeMusicalReviews([full],{...identity,publicationRevision:"version2"},8)).toMatchObject({status:"pending",staleCount:1});
 expect(summarizeMusicalReviews([full],{...identity,mode:"Original"},8).status).toBe("pending");
 const rejected=parseMusicalReviewReceipt({...receipt(),decision:"rejected"});
 expect(summarizeMusicalReviews([rejected],identity,8).status).toBe("rejected");
 expect(summarizeMusicalReviews([full,rejected],identity,8).status).toBe("conflict");
});

it("refuses malformed attestations and cannot promote unqualified or automated checks",()=>{
 for(const malformed of [
  {...receipt(),schemaVersion:2}, {...receipt(),accepted:true},
  {...receipt(),playbackSha256:""}, {...receipt(),coverage:[{startBeat:4,endBeat:3}]},
  {...receipt(),reviewer:{id:"owner",role:"owner",independent:false}},
  {...receipt(),checks:{...receipt().checks,keyboard:{result:"passed",evidence:[]}}},
  {...receipt(),decision:"accepted",checks:{...receipt().checks,listening:{result:"failed",evidence}}},
  {...receipt(),reviewer:{id:"model",role:"automated",independent:true}},
 ])expect(()=>parseMusicalReviewReceipt(malformed)).toThrow();
 const owner=parseMusicalReviewReceipt({...receipt(),reviewer:{id:"owner",role:"owner",independent:false},checks:{...receipt().checks,keyboard:{result:"pending",evidence:[]}}});
 expect(summarizeMusicalReviews([owner],identity,8)).toMatchObject({status:"partial",listening:"passed",keyboard:"pending"});
});
