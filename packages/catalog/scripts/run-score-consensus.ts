#!/usr/bin/env node
/**
 * Local-only entry point for the score-consensus corpus evaluator.
 *
 * The implementation lives in the evaluation module so it can be exercised
 * directly by tests. This wrapper intentionally has no catalog, network, or
 * production side effects; the caller must provide explicit local corpus and
 * output roots.
 */
import { runScoreConsensusCli } from "../src/score-consensus-corpus.js";

void runScoreConsensusCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
