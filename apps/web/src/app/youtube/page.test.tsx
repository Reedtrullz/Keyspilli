import React from "react";
import {afterEach,expect,it,vi} from "vitest";
import {tutorialImportsEnabled} from "../../../../../packages/catalog/src/tutorial-imports";
vi.mock("@keyspilli/catalog",()=>({tutorialImportsEnabled}));
import YoutubePage,{dynamic} from "./page";
import TutorialImport from "./TutorialImport";
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it("renders the private beta from the runtime flag and opts out of static generation",()=>{
 vi.stubGlobal("React",React);
 expect(dynamic).toBe("force-dynamic");
 vi.stubEnv("NODE_ENV","production");vi.stubEnv("KEYSPILLI_DATA_DIR","/private-beta");
 vi.stubEnv("KEYSPILLI_TUTORIAL_BETA","");
 expect(YoutubePage().type).not.toBe(TutorialImport);
 vi.stubEnv("KEYSPILLI_TUTORIAL_BETA","1");
 expect(YoutubePage().type).toBe(TutorialImport);
});
