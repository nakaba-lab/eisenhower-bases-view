import { defineConfig, type Plugin } from "vitest/config";
import path from "node:path";
import { createRequire } from "node:module";

const requireFromHere = createRequire(import.meta.url);

// dnd-kit（#20）は `react`/`react-dom` を import する。Preact アプリへ寄せるため
// preact/compat へ解決する（実 react を掴むと hooks の dispatcher が null になり落ちる）。
const preactCompat = path.resolve(
  __dirname,
  "node_modules/preact/compat/dist/compat.mjs",
);
const preactJsxRuntime = path.resolve(
  __dirname,
  "node_modules/preact/jsx-runtime/dist/jsxRuntime.mjs",
);

/** `@dnd-kit/<pkg>` を ESM ビルドの絶対パスに解決する（package dir 起点）。 */
function dndKitEsm(pkg: string): string {
  const pkgJsonPath = requireFromHere.resolve(`@dnd-kit/${pkg}/package.json`);
  const meta = requireFromHere(`@dnd-kit/${pkg}/package.json`) as {
    module: string;
  };
  return path.resolve(path.dirname(pkgJsonPath), meta.module);
}

/**
 * react/react-dom を preact/compat へ寄せ、dnd-kit を **inline（external:false）** で
 * Vite 変換に通すための resolve プラグイン。
 *
 * dnd-kit を externalize すると Node が内部の `react` を実 react に解決してしまい、
 * Preact レンダリング下で hooks の dispatcher が null になって落ちる（`ssr.noExternal`
 * /`deps.inline` では inline されなかった）。ESM ビルドへ明示解決し external:false を
 * 返すことで Vite に変換させ、その中の `react` import も本プラグインで preact/compat へ寄せる。
 */
function preactDndKitResolver(): Plugin {
  const dndKit: Record<string, string> = {
    "@dnd-kit/core": dndKitEsm("core"),
    "@dnd-kit/utilities": dndKitEsm("utilities"),
    "@dnd-kit/accessibility": dndKitEsm("accessibility"),
  };
  return {
    name: "eisenhower-preact-dnd-kit-resolver",
    enforce: "pre",
    resolveId(id) {
      if (id === "react" || id === "react-dom") return preactCompat;
      if (id === "react/jsx-runtime" || id === "react/jsx-dev-runtime") {
        return preactJsxRuntime;
      }
      if (id in dndKit) return { id: dndKit[id], external: false };
      return null;
    },
  };
}

export default defineConfig({
  plugins: [preactDndKitResolver()],
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
