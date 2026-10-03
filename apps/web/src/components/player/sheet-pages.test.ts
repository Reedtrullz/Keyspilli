import {it,expect} from 'vitest';
import {retainSheetPages} from './sheet-pages';
it('ignores late pages from a previous window and bounds retained bytes without dropping visible notation',()=>{
 const visible=retainSheetPages({1:'old',2:'neighbor',50:'current'},48,52,49,'needed');expect(visible).toEqual({49:'needed',50:'current'});
 expect(retainSheetPages(visible,48,52,1,'late old reply')).toEqual(visible);expect(retainSheetPages(visible,1,5,2,'revisit')).toEqual({2:'revisit'});
 expect(()=>retainSheetPages({},1,5,1,'123456',10)).toThrow(/memory ceiling/);
});
