import { defineConfig } from 'vite-plus'

// On GitHub Actions the project deploys to https://<owner>.github.io/<repo>/,
// so derive the base path from the repo name. Local builds keep base "/".
const ghRepo = process.env.GITHUB_REPOSITORY?.split('/')[1]

export default defineConfig(({ command }) => ({
  fmt: {
    semi: false,
    singleQuote: true,
  },
  lint: {
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
    options: { typeAware: true, typeCheck: true },
  },
  root: '.',
  base: command === 'build' && ghRepo ? `/${ghRepo}/` : '/',
  server: { port: 5173 },
  build: { target: 'es2022' },
}))
