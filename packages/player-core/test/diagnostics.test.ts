import {expect,it} from "vitest";
import {diagnosticReceipt,serializeDiagnosticReceipt} from "../src/diagnostics.js";
it("exports only revision, state and bounded counters while stripping private strings",()=>{
 const secret="https://owner:password@example.org/private?token=secret /Users/private/source.mid Personal Song";
 const receipt=diagnosticReceipt({health:{version:secret,commit:secret,image:secret,readiness:{catalog:{state:"unavailable",code:"CATALOG_UNAVAILABLE",schemaEpoch:1,path:secret},sourceDiscovery:{state:"unknown",url:secret}},capabilities:{symbolicUpload:false,secret}},publicationRevision:secret,counters:{passages:4,attempts:201,favorites:2,title:secret},browser:{midi:true,microphone:false,userAgent:secret},error:secret});
 const raw=serializeDiagnosticReceipt(receipt);
 for(const value of ["owner:password","token=secret","/Users/","Personal Song","example.org"])expect(raw).not.toContain(value);
 expect(receipt.catalog).toEqual({state:"unavailable",code:"CATALOG_UNAVAILABLE",schemaEpoch:1});expect(receipt.software.commit).toBeNull();expect(receipt.counters.attempts).toBeNull();expect(raw.length).toBeLessThan(16_384);
 expect(diagnosticReceipt({health:null}).catalog.state).toBe("unknown");
 const known=diagnosticReceipt({health:{version:"0.1.0",commit:"a".repeat(40)},publicationRevision:"12345678-1234-1234-1234-123456789abc"});
 expect(known.software.version).toBe("0.1.0");expect(known.software.commit).toBe("a".repeat(40));expect(known.publicationRevision).toBeTruthy();
 const tampered={...known,unexpected:secret};expect(()=>serializeDiagnosticReceipt(tampered)).toThrow();
});
