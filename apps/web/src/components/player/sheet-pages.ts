// String estimates use UTF-16 units, not WASM/native memory. Visible oversized
// windows fail clearly instead of silently dropping notation. Print has its own ceiling.
export const SHEET_WINDOW_BYTES=4*1024*1024;
export const SHEET_PRINT_BYTES=64*1024*1024;
export function retainSheetPages(pages:Record<number,string>,start:number,end:number,page?:number,svg?:string,maxBytes=SHEET_WINDOW_BYTES):Record<number,string> {
 const next:Record<number,string>={};
 for(const [key,value] of Object.entries(pages)){const number=Number(key);if(number>=start&&number<=end)next[number]=value;}
 if(page!==undefined&&svg!==undefined&&page>=start&&page<=end)next[page]=svg;
 if(Object.values(next).reduce((sum,value)=>sum+value.length*2,0)>maxBytes)throw new Error('Sheet SVG window exceeds its memory ceiling; use a smaller source or another learning view.');
 return next;
}
