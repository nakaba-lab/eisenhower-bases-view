// scripts/preview/ のブラウザ・プレビュー / E2E ハーネスをバンドルする。
// 使い方: node scripts/preview/build.mjs（= npm run preview:build）→ scripts/preview/preview.bundle.js を生成。
// その後リポジトリルートから HTTP サーバ（例: python -m http.server 8765）で index.html /
// preview-contain.html を開く（詳細は scripts/preview/README.md）。
import esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [path.join(here, "preview.tsx")],
  bundle: true,
  outfile: path.join(here, "preview.bundle.js"),
  format: "iife",
  target: "es2022",
  jsx: "automatic",
  jsxImportSource: "preact",
  // dnd-kit（react/react-dom を import）を preact/compat へ alias する
  // （本体の esbuild.config.mjs / vitest.config.ts の resolve.alias と対応させる）。
  alias: {
    react: "preact/compat",
    "react-dom": "preact/compat",
    "react/jsx-runtime": "preact/jsx-runtime",
  },
});

console.log("built: scripts/preview/preview.bundle.js");
