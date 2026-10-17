// @ts-check
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/next-env.d.ts",
      "apps/web/public/**",
      "data/**",
      "docs/**",
      "evidence/**",
      "output/**",
      ".transcribe-test-venv/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    linterOptions: { reportUnusedDisableDirectives: "warn" },
  },
  {
    // Baseline: these rules already have violations on main. They report as
    // warnings so CI passes today; tighten them back to errors as the counts
    // reach zero. New rules are errors by default.
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "@typescript-eslint/no-this-alias": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "no-useless-escape": "warn",
      "no-control-regex": "warn",
      "preserve-caught-error": "warn",
      "no-empty": "warn",
      "no-useless-assignment": "warn",
      "prefer-const": "warn",
      "no-unexpected-multiline": "warn",
      "no-unsafe-finally": "warn",
      "no-var": "warn",
      "no-irregular-whitespace": "warn",
      "no-loss-of-precision": "warn",
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx,js,jsx,mjs}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Hook order bugs are always real: keep this an error from day one.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
  },
);
