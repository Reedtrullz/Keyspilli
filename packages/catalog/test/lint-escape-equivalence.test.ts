// Pins the no-useless-escape cleanup (lint batch 4) as behaviour-preserving.
// Each pair is a literal exactly as it was written before the cleanup and after it,
// so the old and new spellings can be compared directly.
// Regex pairs must give identical match/replace results on an adversarial corpus.
// String/template pairs must cook to identical runtime strings.
import { describe, expect, it } from "vitest";

const REGEX_PAIRS: ReadonlyArray<{ file: string; old: string; new: string }> = [
  {
    "file": "apps/web/src/components/song-display.ts",
    "old": "/\\s*[\\[(][^\\])]*(piano|synthesia|tutorial|cover|sheet)[^\\])]*[\\])]/gi",
    "new": "/\\s*[[(][^\\])]*(piano|synthesia|tutorial|cover|sheet)[^\\])]*[\\])]/gi"
  },
  {
    "file": "apps/web/src/components/song-display.ts",
    "old": "/\\s*[-–—|]\\s*(piano\\s+)?(accompaniment|karaoke)(\\s*[\\[(][^\\])]*[\\])])?\\s*$/i",
    "new": "/\\s*[-–—|]\\s*(piano\\s+)?(accompaniment|karaoke)(\\s*[[(][^\\])]*[\\])])?\\s*$/i"
  },
  {
    "file": "apps/web/src/lib/music-review-jobs.ts",
    "old": "/\"(?:[^\"\\\\]|\\\\.)*\"|[{}\\[\\]]/g",
    "new": "/\"(?:[^\"\\\\]|\\\\.)*\"|[{}[\\]]/g"
  },
  {
    "file": "packages/catalog/scripts/diagnose-piano-candidates.ts",
    "old": "/(^|[\\s(\"'=,;\\[\\]])[A-Za-z]:[\\\\/][^\\s\"'<>;,)]*/g",
    "new": "/(^|[\\s(\"'=,;[\\]])[A-Za-z]:[\\\\/][^\\s\"'<>;,)]*/g"
  },
  {
    "file": "packages/catalog/scripts/diagnose-piano-candidates.ts",
    "old": "/(^|[\\s(\"'=,;\\[\\]])(?:\\.\\.?\\/|[^\\s/]+\\/)[^\\s\"']+\\.(?:mid|midi|json|wav|mp3)(?=$|[\\s\"'])/gi",
    "new": "/(^|[\\s(\"'=,;[\\]])(?:\\.\\.?\\/|[^\\s/]+\\/)[^\\s\"']+\\.(?:mid|midi|json|wav|mp3)(?=$|[\\s\"'])/gi"
  },
  {
    "file": "packages/catalog/scripts/evaluate-piano-candidates.ts",
    "old": "/(^|[\\s(\\\"'=,;\\[\\]])\\/(?:[A-Za-z0-9._-]+\\/)+[^\\s\"'<>;,)]*/g",
    "new": "/(^|[\\s(\"'=,;[\\]])\\/(?:[A-Za-z0-9._-]+\\/)+[^\\s\"'<>;,)]*/g"
  },
  {
    "file": "packages/catalog/scripts/evaluate-piano-candidates.ts",
    "old": "/(^|[\\s(\\\"'=,;\\[\\]])[A-Za-z]:[\\\\/][^\\s\"'<>;,)]*/g",
    "new": "/(^|[\\s(\"'=,;[\\]])[A-Za-z]:[\\\\/][^\\s\"'<>;,)]*/g"
  },
  {
    "file": "packages/catalog/scripts/evaluate-real-shadow-pair.ts",
    "old": "/(^|[\\s(=,:])[A-Za-z]:[\\\\\\/][^\\s\"'<>;,)]*/g",
    "new": "/(^|[\\s(=,:])[A-Za-z]:[\\\\/][^\\s\"'<>;,)]*/g"
  },
  {
    "file": "packages/catalog/src/arrangement-evaluation.ts",
    "old": "/^\\\\\\\\[^\\\"'<>;,)]*$/",
    "new": "/^\\\\\\\\[^\"'<>;,)]*$/"
  },
  {
    "file": "packages/catalog/src/arrangement-evaluation.ts",
    "old": "/(^|[\\s(\\\"'=,;\\[\\]])\\/(?:[A-Za-z0-9._-]+\\/)+[^\\s\\\"'<>;,)]*/g",
    "new": "/(^|[\\s(\"'=,;[\\]])\\/(?:[A-Za-z0-9._-]+\\/)+[^\\s\"'<>;,)]*/g"
  },
  {
    "file": "packages/catalog/src/arrangement-evaluation.ts",
    "old": "/(^|[\\s(\\\"'=,;\\[\\]])[A-Za-z]:[\\\\/][^\\s\\\"'<>;,)]*/g",
    "new": "/(^|[\\s(\"'=,;[\\]])[A-Za-z]:[\\\\/][^\\s\"'<>;,)]*/g"
  },
  {
    "file": "packages/catalog/src/arrangement-evaluation.ts",
    "old": "/(^|[\\s(\\\"'=,;\\[\\]])\\/(?:[A-Za-z0-9._-]+\\.[A-Za-z0-9_-]+)(?=$|[\\s\\\"'<>;,\\)])/g",
    "new": "/(^|[\\s(\"'=,;[\\]])\\/(?:[A-Za-z0-9._-]+\\.[A-Za-z0-9_-]+)(?=$|[\\s\"'<>;,)])/g"
  },
  {
    "file": "packages/catalog/src/arrangement-evaluation.ts",
    "old": "/(^|[\\s\\\"'=,;([\\]])(?!(?:[A-Za-z][A-Za-z0-9+.-]*:)?\\/\\/)(?:\\.\\.?\\/|[A-Za-z0-9._-]+\\/[A-Za-z0-9._-]+\\/)[^\\s\\\"'<>;,\\)]*(?=$|[\\s\\\"'<>;,\\)])/gi",
    "new": "/(^|[\\s\"'=,;([\\]])(?!(?:[A-Za-z][A-Za-z0-9+.-]*:)?\\/\\/)(?:\\.\\.?\\/|[A-Za-z0-9._-]+\\/[A-Za-z0-9._-]+\\/)[^\\s\"'<>;,)]*(?=$|[\\s\"'<>;,)])/gi"
  },
  {
    "file": "packages/catalog/src/arrangement-evaluation.ts",
    "old": "/(^|[\\s\\\"'=,;([\\]])(?!(?:[A-Za-z][A-Za-z0-9+.-]*:)?\\/\\/)(\\.\\.?\\/|[^\\s/]+\\/)[^\\s\\\"']+\\.(?:mid|midi|json|wav|mp3|txt|pdf|xml|mxl|csv|log)(?=$|[\\s\\\"'<>;,\\)])/gi",
    "new": "/(^|[\\s\"'=,;([\\]])(?!(?:[A-Za-z][A-Za-z0-9+.-]*:)?\\/\\/)(\\.\\.?\\/|[^\\s/]+\\/)[^\\s\"']+\\.(?:mid|midi|json|wav|mp3|txt|pdf|xml|mxl|csv|log)(?=$|[\\s\"'<>;,)])/gi"
  },
  {
    "file": "packages/catalog/src/arrangement-evaluation.ts",
    "old": "/([A-Za-z][A-Za-z0-9+.-]*:\\/\\/)([^\\/\\s\"'<>;,)\\]]*)(\\/[^\\s\"'<>;,)\\]]*)?/g",
    "new": "/([A-Za-z][A-Za-z0-9+.-]*:\\/\\/)([^/\\s\"'<>;,)\\]]*)(\\/[^\\s\"'<>;,)\\]]*)?/g"
  },
  {
    "file": "packages/catalog/src/direct-amt-evaluation.ts",
    "old": "/(^|[\\s(\"'=,;\\[])([A-Za-z]:[\\\\/][^\\s\"'<>;,)]*)/g",
    "new": "/(^|[\\s(\"'=,;[])([A-Za-z]:[\\\\/][^\\s\"'<>;,)]*)/g"
  },
  {
    "file": "packages/catalog/src/direct-amt-evaluation.ts",
    "old": "/(^|[\\s(\"'=,;\\[])(\\\\\\\\[^\\s\"'<>;,)]*)/g",
    "new": "/(^|[\\s(\"'=,;[])(\\\\\\\\[^\\s\"'<>;,)]*)/g"
  },
  {
    "file": "packages/catalog/src/direct-amt-evaluation.ts",
    "old": "/(^|[\\s\"'=(:,;\\[])(?:\\.\\.?(?:\\/|\\\\))+(?:[^\\s\"'<>;,)]*)/g",
    "new": "/(^|[\\s\"'=(:,;[])(?:\\.\\.?(?:\\/|\\\\))+(?:[^\\s\"'<>;,)]*)/g"
  },
  {
    "file": "packages/catalog/src/direct-amt-evaluation.ts",
    "old": "/(^|[\\s\"'=(:,;\\[])(?:[A-Za-z0-9._-]+(?:\\/|\\\\))+[A-Za-z0-9._-]+\\.(?:wav|wave|mid|midi|mp3|flac|json|ckpt|onnx|pt|pth)(?=$|\\s|[.,;)}\\]])/gi",
    "new": "/(^|[\\s\"'=(:,;[])(?:[A-Za-z0-9._-]+(?:\\/|\\\\))+[A-Za-z0-9._-]+\\.(?:wav|wave|mid|midi|mp3|flac|json|ckpt|onnx|pt|pth)(?=$|\\s|[.,;)}\\]])/gi"
  },
  {
    "file": "packages/catalog/src/gaps-attribution.ts",
    "old": "/(^|[\\s(\"'=,;\\[])(?:file:\\/\\/)?\\/(?!\\/)[^\\s\"'<>;,)]*/gi",
    "new": "/(^|[\\s(\"'=,;[])(?:file:\\/\\/)?\\/(?!\\/)[^\\s\"'<>;,)]*/gi"
  },
  {
    "file": "packages/catalog/src/listening-manifest.ts",
    "old": "/(^|[\\s(\"'=,;:\\[\\]])file:\\/\\/[^\\s\"'<>;,)]*/gi",
    "new": "/(^|[\\s(\"'=,;:[\\]])file:\\/\\/[^\\s\"'<>;,)]*/gi"
  },
  {
    "file": "packages/catalog/src/listening-manifest.ts",
    "old": "/(^|[\\s(\"'=,;:\\[\\]])(?:~\\/|\\.\\.?\\/)[^\\s\"'<>;,)]*/g",
    "new": "/(^|[\\s(\"'=,;:[\\]])(?:~\\/|\\.\\.?\\/)[^\\s\"'<>;,)]*/g"
  },
  {
    "file": "packages/catalog/src/listening-manifest.ts",
    "old": "/(^|[\\s(\"'=,;:\\[\\]])\\/(?:[^\\s\"'<>;,)]*\\/)+[^\\s\"'<>;,)]*/g",
    "new": "/(^|[\\s(\"'=,;:[\\]])\\/(?:[^\\s\"'<>;,)]*\\/)+[^\\s\"'<>;,)]*/g"
  },
  {
    "file": "packages/catalog/src/listening-manifest.ts",
    "old": "/(^|[\\s(\"'=,;:\\[\\]])[A-Za-z]:[\\\\/][^\\s\"'<>;,)]*/g",
    "new": "/(^|[\\s(\"'=,;:[\\]])[A-Za-z]:[\\\\/][^\\s\"'<>;,)]*/g"
  },
  {
    "file": "packages/catalog/src/local-reference-listening.ts",
    "old": "/\\\"/g",
    "new": "/\"/g"
  },
  {
    "file": "packages/catalog/src/midi-corpus-report.ts",
    "old": "/(^|[\\s(=,:;\\[\\]])\\/(?:Users|private|tmp|var|home|root|opt|mnt|workspace|etc|srv|data|app)(?:[^\"'<>;,)\\n\\r]*)?/gi",
    "new": "/(^|[\\s(=,:;[\\]])\\/(?:Users|private|tmp|var|home|root|opt|mnt|workspace|etc|srv|data|app)(?:[^\"'<>;,)\\n\\r]*)?/gi"
  },
  {
    "file": "packages/catalog/src/midi-corpus-report.ts",
    "old": "/(^|[\\s(=,:;\\[\\]])[A-Za-z]:[\\\\/][^\"'<>;,)\\n\\r]*/g",
    "new": "/(^|[\\s(=,:;[\\]])[A-Za-z]:[\\\\/][^\"'<>;,)\\n\\r]*/g"
  },
  {
    "file": "packages/catalog/src/midi-corpus-report.ts",
    "old": "/(^|[\\s(=,:;\\[\\]])(?:\\.\\.?\\/|[A-Za-z0-9._-]+\\/)[^\\s\"'<>;,)]*\\.(?:mid|midi|json|wav|mp3|txt|pdf|xml|mxl|csv|log)(?=$|[\\s\"'<>;,\\)])/gi",
    "new": "/(^|[\\s(=,:;[\\]])(?:\\.\\.?\\/|[A-Za-z0-9._-]+\\/)[^\\s\"'<>;,)]*\\.(?:mid|midi|json|wav|mp3|txt|pdf|xml|mxl|csv|log)(?=$|[\\s\"'<>;,)])/gi"
  },
  {
    "file": "packages/catalog/src/omr-consensus.ts",
    "old": "/([A-Za-z][A-Za-z0-9+.-]*:\\/\\/)([^\\s\\/@:]+)(?::[^\\s\\/@]*)?@/g",
    "new": "/([A-Za-z][A-Za-z0-9+.-]*:\\/\\/)([^\\s/@:]+)(?::[^\\s/@]*)?@/g"
  },
  {
    "file": "packages/catalog/src/red-baron-survival.ts",
    "old": "/^(https?:\\/\\/)(?:[^\\/\\s@]+(?::[^\\/\\s@]*)?@)/i",
    "new": "/^(https?:\\/\\/)(?:[^/\\s@]+(?::[^/\\s@]*)?@)/i"
  },
  {
    "file": "packages/catalog/src/rotating-listening-bundle.ts",
    "old": "/(^|[\\s(\"'=,;:\\[\\]])(?:\\.\\.?\\/|[^\\s/]+\\/)[^\\s\"']+\\.(?:mid|midi|wav|mp3|sf2)(?=$|[\\s\"'])/gi",
    "new": "/(^|[\\s(\"'=,;:[\\]])(?:\\.\\.?\\/|[^\\s/]+\\/)[^\\s\"']+\\.(?:mid|midi|wav|mp3|sf2)(?=$|[\\s\"'])/gi"
  },
  {
    "file": "packages/catalog/src/route-funnel.ts",
    "old": "/(^|[\\s(\"'=,;\\[])(?:\\.\\.?\\/|[^\\s/]+\\/)[^\\s\"'<>;,)]*\\.(?:mid|midi|json|wav|mp3|xml|mxl)(?=$|[\\s\"'<>;,\\)])/gi",
    "new": "/(^|[\\s(\"'=,;[])(?:\\.\\.?\\/|[^\\s/]+\\/)[^\\s\"'<>;,)]*\\.(?:mid|midi|json|wav|mp3|xml|mxl)(?=$|[\\s\"'<>;,)])/gi"
  },
  {
    "file": "packages/catalog/src/score-consensus-corpus.ts",
    "old": "/(?:[A-Za-z]:[\\\\/]|\\/)[^\\s'\"`;,\\)\\]\\r\\n]*/g",
    "new": "/(?:[A-Za-z]:[\\\\/]|\\/)[^\\s'\"`;,)\\]\\r\\n]*/g"
  },
  {
    "file": "packages/catalog/src/shadow-evaluation.ts",
    "old": "/(?:file:\\/\\/|(?:^|[\\s(\"'=,;\\[\\]])\\/(?:Users|private|tmp|var|home|Volumes|opt|etc|System|Applications|root|mnt|workspace|data|srv)(?:[\\\\/]|$)|(?:^|[\\s(\"'=,;\\[\\]])[A-Za-z]:[\\\\/]|(?:^|[\\s(\"'=,;\\[\\]])\\\\\\\\)/i",
    "new": "/(?:file:\\/\\/|(?:^|[\\s(\"'=,;[\\]])\\/(?:Users|private|tmp|var|home|Volumes|opt|etc|System|Applications|root|mnt|workspace|data|srv)(?:[\\\\/]|$)|(?:^|[\\s(\"'=,;[\\]])[A-Za-z]:[\\\\/]|(?:^|[\\s(\"'=,;[\\]])\\\\\\\\)/i"
  },
  {
    "file": "packages/catalog/src/shadow-evaluation.ts",
    "old": "/(?:^|[\\s(\"'=,;\\[\\]])(?:\\.\\.?[\\\\/]|(?:[A-Za-z0-9._-]+[\\\\/]){2,})[^\\s\"'<>;,)]*\\.(?:mid|midi|wav|mp3|json|xml|mxl|txt|csv|log)(?=$|[\\s\"'<>;,\\)])/i",
    "new": "/(?:^|[\\s(\"'=,;[\\]])(?:\\.\\.?[\\\\/]|(?:[A-Za-z0-9._-]+[\\\\/]){2,})[^\\s\"'<>;,)]*\\.(?:mid|midi|wav|mp3|json|xml|mxl|txt|csv|log)(?=$|[\\s\"'<>;,)])/i"
  },
  {
    "file": "packages/catalog/src/song-research.ts",
    "old": "/^(?:file:|[~.]?[\\/]|[A-Za-z]:[\\\\/])/",
    "new": "/^(?:file:|[~.]?[/]|[A-Za-z]:[\\\\/])/"
  },
  {
    "file": "packages/catalog/src/youtube-discovery.ts",
    "old": "/\\[[^\\[\\]]*\\]/g",
    "new": "/\\[[^[\\]]*\\]/g"
  }
];

const STRING_PAIRS: ReadonlyArray<{ file: string; old: string; new: string }> = [
  {
    "file": "apps/web/scripts/build-player-reference-bank.mts",
    "old": "'globalThis.__name = (fn, name) => Object.defineProperty(fn, \\\"name\\\", { value: name, configurable: true });'",
    "new": "'globalThis.__name = (fn, name) => Object.defineProperty(fn, \"name\", { value: name, configurable: true });'"
  },
  {
    "file": "packages/catalog/scripts/benchmark-score.ts",
    "old": "`(^|[\\\\s(\\\"'=,;:\\\\[\\\\]])`",
    "new": "`(^|[\\\\s(\"'=,;:\\\\[\\\\]])`"
  },
  {
    "file": "packages/catalog/scripts/diagnose-piano-candidates.ts",
    "old": "`(^|[\\\\s(\\\"'=,;\\\\[\\\\]])/${",
    "new": "`(^|[\\\\s(\"'=,;\\\\[\\\\]])/${"
  },
  {
    "file": "packages/catalog/scripts/diagnose-piano-candidates.ts",
    "old": "}(?:/[^\\\\s\\\"'<>;,)]*)?`",
    "new": "}(?:/[^\\\\s\"'<>;,)]*)?`"
  },
  {
    "file": "packages/catalog/src/arrangement-evaluation.ts",
    "old": "})(?:[\\\\\\\\/][^\\\"'<>;,)]*)*$`",
    "new": "})(?:[\\\\\\\\/][^\"'<>;,)]*)*$`"
  },
  {
    "file": "packages/catalog/src/arrangement-evaluation.ts",
    "old": "`^[A-Za-z]:[\\\\\\\\/][^\\\"'<>;,)]*$`",
    "new": "`^[A-Za-z]:[\\\\\\\\/][^\"'<>;,)]*$`"
  },
  {
    "file": "packages/catalog/src/arrangement-evaluation.ts",
    "old": "})(?:[\\\\\\\\/][^\\\"'<>;,)]*)*|[A-Za-z]:[\\\\\\\\/][^\\\"'<>;,)]*)$`",
    "new": "})(?:[\\\\\\\\/][^\"'<>;,)]*)*|[A-Za-z]:[\\\\\\\\/][^\"'<>;,)]*)$`"
  },
  {
    "file": "packages/catalog/src/arrangement-evaluation.ts",
    "old": "})[^\\\\s\\\"'<>;,)]*?(?:\\\\s+[^\\\\s\\\"'<>;,)]*)*\\\\.${",
    "new": "})[^\\\\s\"'<>;,)]*?(?:\\\\s+[^\\\\s\"'<>;,)]*)*\\\\.${"
  },
  {
    "file": "packages/catalog/src/arrangement-evaluation.ts",
    "old": "}([A-Za-z]:[\\\\\\\\/][^\\\\s\\\"'<>;,)]*?(?:\\\\s+[^\\\\s\\\"'<>;,)]*)*\\\\.${",
    "new": "}([A-Za-z]:[\\\\\\\\/][^\\\\s\"'<>;,)]*?(?:\\\\s+[^\\\\s\"'<>;,)]*)*\\\\.${"
  },
  {
    "file": "packages/catalog/src/arrangement-evaluation.ts",
    "old": "}(\\\\\\\\[^\\\"'<>;,)]*?(?:\\\\s+[^\\\\s\\\"'<>;,)]*)*\\\\.${",
    "new": "}(\\\\\\\\[^\"'<>;,)]*?(?:\\\\s+[^\\\\s\"'<>;,)]*)*\\\\.${"
  },
  {
    "file": "packages/catalog/src/arrangement-evaluation.ts",
    "old": "})(?:[\\\\\\\\/][^\\\"'<>;,)]*)*)${",
    "new": "})(?:[\\\\\\\\/][^\"'<>;,)]*)*)${"
  },
  {
    "file": "packages/catalog/src/arrangement-evaluation.ts",
    "old": "}([A-Za-z]:[\\\\\\\\/][^\\\"'<>;,)]*)${",
    "new": "}([A-Za-z]:[\\\\\\\\/][^\"'<>;,)]*)${"
  },
  {
    "file": "packages/catalog/src/arrangement-evaluation.ts",
    "old": "}(\\\\\\\\[^\\\"'<>;,)]*)${",
    "new": "}(\\\\\\\\[^\"'<>;,)]*)${"
  },
  {
    "file": "packages/catalog/src/arrangement-evaluation.ts",
    "old": "})(?:[\\\\\\\\/][^\\\"'<>;,)]*)+|[A-Za-z]:[\\\\\\\\/][^\\\"'<>;,)]*)\\\\s*$`",
    "new": "})(?:[\\\\\\\\/][^\"'<>;,)]*)+|[A-Za-z]:[\\\\\\\\/][^\"'<>;,)]*)\\\\s*$`"
  },
  {
    "file": "packages/catalog/src/score-benchmark.ts",
    "old": "}\\\\s*=\\\\s*[\\\"']([^\\\"']*)[\\\"']`",
    "new": "}\\\\s*=\\\\s*[\"']([^\"']*)[\"']`"
  }
];

function compile(literal: string): RegExp {
  const end = literal.lastIndexOf("/");
  return new RegExp(literal.slice(1, end), literal.slice(end + 1));
}

// A template fragment such as `abc${ or }abc${ is cooked by closing it into a full template literal.
function cook(fragment: string): string {
  let body = fragment;
  if (body.startsWith("}")) body = "`" + body.slice(1);
  if (body.endsWith("${")) body = body.slice(0, -2) + "`";
  return new Function(`return ${body};`)() as string;
}

const SPECIALS = [..."[](){}<>\"'`/\\.-=,;:|?#@~ \t\r\n\u0000\u001f\u007f\u00e9–—"];
const ASCII = Array.from({ length: 128 }, (_, code) => String.fromCharCode(code));
const CORPUS: string[] = [
  "",
  "/tmp/a.json",
  "see /Users/reed/Music/song.mid, then [/private/var/x.wav]",
  "C:\\Users\\reed\\a.mid and D:/data/b.json",
  "\\\\server\\share\\c.mp3",
  "file:///Users/reed/a%20b.mid?x=1#y",
  "https://user:pw@example.com/path?q=1",
  "rel ./a/b.mid ../c.json x/y/z.wav \"quoted/path.mid\" 'single/q.json'",
  "(Piano Tutorial) Song [Synthesia] - piano accompaniment [HD]",
  "Title - Karaoke (cover)",
  "{\"a\":[1,{\"b\":\"c\\\"d\"}]}",
  "<tag key=\"v\" other='w'>",
  "a=b;c,d:e(f)g[h]i\"j'k",
  ...ASCII,
  ...ASCII.map((c) => `x${c}/tmp/q.mid${c}y`),
  "[a[b]c] and (x (y) z) and [p (q] r)",
  ...SPECIALS.flatMap((a) => SPECIALS.map((b) => `${a}/workspace/f.json${b}`)),
  // Every 3-character string over the escape-relevant alphabet, so class membership is checked exhaustively.
  ...SPECIALS.flatMap((a) => SPECIALS.flatMap((b) => SPECIALS.map((c) => `${a}${b}${c}`))),
];

function observe(re: RegExp, input: string): string {
  const copy = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  return input.replace(copy, (...args) => JSON.stringify(args.slice(0, -1)));
}

describe("lint batch 4: removed useless escapes do not change behaviour", () => {
  it.each(REGEX_PAIRS.map((pair) => [pair.file, pair] as const))("regex in %s", (_file, pair) => {
    const before = compile(pair.old);
    const after = compile(pair.new);
    expect(after.flags).toBe(before.flags);
    for (const input of CORPUS) {
      expect(observe(after, input)).toBe(observe(before, input));
      expect(compile(pair.new).test(input)).toBe(compile(pair.old).test(input));
    }
  }, 60_000);

  it.each(STRING_PAIRS.map((pair) => [pair.file, pair] as const))("string/template literal in %s", (_file, pair) => {
    expect(cook(pair.new)).toBe(cook(pair.old));
  });
});
