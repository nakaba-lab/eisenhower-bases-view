import tseslint from "typescript-eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default tseslint.config(
  {
    ignores: [
      "main.js",
      "node_modules/**",
      "docs-site/**",
      "scripts/**",
      "coverage/**",
      // remember プラグインのローカル作業ディレクトリ（gitignore 済み・自動生成）。
      // ESLint flat config は .gitignore を自動参照しないため、ここで明示除外しないと
      // `eslint .`（npm run lint）が .remember/tmp のスクラッチを拾って落ちる。
      ".remember/**",
      "esbuild.config.mjs",
      "eslint.config.mjs",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.tsx"],
    plugins: { "jsx-a11y": jsxA11y },
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: jsxA11y.configs.recommended.rules,
  },
);
