import tseslint from "typescript-eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";
import obsidianmd from "eslint-plugin-obsidianmd";

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
      // テスト・テスト基盤・ビルド設定は main.js に同梱されず、Obsidian 提出レビュー bot も走査対象外
      //（実績: 過去3巡でテストファイルは未指摘）。提出前チェックを bot と一致させるため除外する
      //（テストの正しさは vitest 実行で担保）。
      "**/*.test.ts",
      "**/*.test.tsx",
      "src/test-support/**",
      "vitest.config.ts",
    ],
  },
  // Obsidian 公式デベロッパーガイドライン（提出前の bot 相当をローカル再現）。
  // recommended = 型チェック付き typescript-eslint（no-unsafe-* 等）＋ eslint-comments
  //（require-description / disable-enable-pair）＋ @microsoft/sdl（innerHTML 等）＋ Obsidian 固有ルール。
  ...obsidianmd.configs.recommended,
  // 型情報必須ルール（no-unsafe-* 等）を発火させるため projectService を有効化する。
  // これが無いと recommended の recommendedTypeChecked 由来ルールが走らず bot 指摘を取りこぼす。
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // getSettingDefinitions（宣言的 settings API）は Obsidian 1.13.0 で導入。本プラグインの
      // manifest.minAppVersion は 1.12.0 のため display() フォールバックを維持する（本プロジェクトの
      // サポート対象では非適用のルール）。minAppVersion を 1.13.0 以上へ上げる際に再有効化して移行する。
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
    },
  },
  // Preact UI のアクセシビリティ（既存）。
  {
    files: ["src/**/*.tsx"],
    plugins: { "jsx-a11y": jsxA11y },
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: jsxA11y.configs.recommended.rules,
  },
);
