import {afterEach, expect, it, vi} from "vitest";
import {tutorialImportsEnabled} from "../src/tutorial-imports.js";
afterEach(()=>vi.unstubAllEnvs());
it.each([
 ["production","1","", "/data",true],
 ["development","1","", "/data",true],
 ["production","","", "/data",false],
 ["production","","1", "/data",false],
 ["development","","1", "/data",true],
 ["production","1","", "",false],
 ["development","","1", "",false],
 ["test","1","", "/data",false],
])("gates tutorial imports (%s, beta=%s, preview=%s, data=%s)",(mode,beta,preview,data,enabled)=>{
 vi.stubEnv("NODE_ENV",mode);vi.stubEnv("KEYSPILLI_TUTORIAL_BETA",beta);vi.stubEnv("KEYSPILLI_TUTORIAL_PREVIEW",preview);vi.stubEnv("KEYSPILLI_DATA_DIR",data);
 expect(tutorialImportsEnabled()).toBe(enabled);
});
