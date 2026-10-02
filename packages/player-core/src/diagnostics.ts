export const DIAGNOSTIC_MAX_BYTES=16_384;
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const bool=(value:unknown)=>typeof value==="boolean"?value:null;
const count=(value:unknown,max:number)=>typeof value==="number"&&Number.isInteger(value)&&value>=0&&value<=max?value:null;
const state=(value:unknown)=>typeof value==="string"&&["ready","unavailable","unknown"].includes(value)?value:"unknown";
/** Copy named public fields; never redact by guessing where secrets might be. */
export function diagnosticReceipt(input:unknown) {
 const row=object(input),health=object(row.health),readiness=object(health.readiness),catalog=object(readiness.catalog),capabilities=object(health.capabilities),browser=object(row.browser),counters=object(row.counters);
 const version=typeof health.version==="string"&&/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(health.version)?health.version:null;
 const commit=typeof health.commit==="string"&&/^[a-f0-9]{7,40}$/.test(health.commit)?health.commit:null;
 const publicationRevision=typeof row.publicationRevision==="string"&&/^(?:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|legacy-[a-f0-9]{64})$/.test(row.publicationRevision)?row.publicationRevision:null;
 return {schemaVersion:1,software:{version,commit},publicationRevision,
  catalog:{state:state(catalog.state),code:typeof catalog.code==="string"&&["CATALOG_UNAVAILABLE","UNSUPPORTED_SCHEMA"].includes(catalog.code)?catalog.code as string:null,schemaEpoch:count(catalog.schemaEpoch,1000)},
  capabilities:{symbolicUpload:bool(capabilities.symbolicUpload),tutorialImportsEnabled:bool(capabilities.tutorialImportsEnabled),sourceDiscoveryConfigured:bool(capabilities.sourceDiscoveryConfigured),sourceDiscovery:state(object(readiness.sourceDiscovery).state),tutorialImport:state(object(readiness.tutorialImport).state),worker:"unknown",midi:bool(browser.midi),microphone:bool(browser.microphone),offlineAudio:bool(browser.offlineAudio)},
  counters:{passages:count(counters.passages,100),attempts:count(counters.attempts,200),favorites:count(counters.favorites,5000),practiceSets:count(counters.practiceSets,20)},
  nonClaims:["Reported readiness and configuration only; no raw logs, source content, private metadata, environment configuration, recovery mutation or device measurements."]};
}
export type DiagnosticReceipt=ReturnType<typeof diagnosticReceipt>;
export function serializeDiagnosticReceipt(value:DiagnosticReceipt):string {
 const clean=diagnosticReceipt({health:{...value.software,readiness:{catalog:value.catalog,sourceDiscovery:{state:value.capabilities.sourceDiscovery},tutorialImport:{state:value.capabilities.tutorialImport}},capabilities:value.capabilities},publicationRevision:value.publicationRevision,counters:value.counters,browser:value.capabilities});
 const raw=JSON.stringify(value,null,2);
 if(JSON.stringify(clean)!==JSON.stringify(value)||new TextEncoder().encode(raw).length>DIAGNOSTIC_MAX_BYTES)throw Error("Invalid or excessive diagnostic receipt.");
 return raw;
}
