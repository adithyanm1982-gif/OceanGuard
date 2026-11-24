import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi", ".nitro", ".tanstack", "src/routeTree.gen.ts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": [
        "error",
        {
          allowConstantExport: true,
          allowExportNames: [
            "buttonVariants",
            "badgeVariants",
            "useFormField",
            "navigationMenuTriggerStyle",
            "useSidebar",
            "toggleVariants",
          ],
        },
      ],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: ["src/**/*.{js,jsx}"],
    extends: [js.configs.recommended],
    languageOptions: {
      parser: tseslint.parser,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-unused-vars": [
        "error",
        { varsIgnorePattern: "^[A-Z]", argsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/data/mockDatasets*"],
              message: "Workflow components must read data through oceanGuardApi.js.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/algorithms/**/*.js", "src/services/**/*.js"],
    rules: { "no-restricted-imports": "off" },
  },
  eslintPluginPrettier,
);
