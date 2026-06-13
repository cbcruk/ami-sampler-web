import { defineConfig } from "vite";

// On GitHub Actions the project deploys to https://<owner>.github.io/<repo>/,
// so derive the base path from the repo name. Local builds keep base "/".
const ghRepo = process.env.GITHUB_REPOSITORY?.split("/")[1];

export default defineConfig(({ command }) => ({
  root: ".",
  base: command === "build" && ghRepo ? `/${ghRepo}/` : "/",
  server: { port: 5173 },
  build: { target: "es2022" },
}));
