/** Private CLI wrapper around the worker's tutorial resolver. */
import {resolveTutorialLink} from '../src/tutorial-route.js';
await resolveTutorialLink(process.argv[2]!, process.argv[3]!);
