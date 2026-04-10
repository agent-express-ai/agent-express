import { defineConfig } from "astro/config"
import starlight from "@astrojs/starlight"
import starlightTypeDoc from "starlight-typedoc"
import starlightLlmsTxt from "starlight-llms-txt"
import { pluginLineNumbers } from "@expressive-code/plugin-line-numbers"

export default defineConfig({
  site: "https://agent-express.ai",
  integrations: [
    starlight({
      title: "agent-express",
      description:
        "Minimalist middleware framework for building AI agents in TypeScript",
      disable404Route: true,
      routeMiddleware: "./src/routeData.ts",
      components: {
        Header: "./src/components/StarlightHeader.astro",
        Footer: "./src/components/StarlightFooter.astro",
        Sidebar: "./src/components/StarlightSidebar.astro",
      },
      expressiveCode: {
        themes: ["night-owl"],
        plugins: [pluginLineNumbers()],
        defaultProps: {
          showLineNumbers: false,
        },
      },
      customCss: ["./src/styles/custom.css"],
      head: [],
      sidebar: [
        { label: "Getting Started", slug: "getting-started" },
        { label: "Concepts", slug: "concepts" },
        {
          label: "Guides",
          items: [
            { label: "Models", slug: "guides/models" },
            { label: "Middleware", slug: "guides/middleware" },
            { label: "Sessions", slug: "guides/sessions" },
            { label: "Structured Output", slug: "guides/structured-output" },
            { label: "Streaming", slug: "guides/events" },
            { label: "Errors", slug: "guides/errors" },
            { label: "Testing", slug: "guides/testing" },
            { label: "CLI", slug: "guides/cli" },
            {
              label: "HTTP & Web Frameworks",
              slug: "guides/http-sse",
            },
            { label: "Templates", slug: "templates" },
          ],
        },
        {
          label: "Features",
          items: [
            { label: "Overview", slug: "guides/builtins" },
            { label: "Guard", slug: "guides/builtins/guard" },
            { label: "Observability", slug: "guides/builtins/observe" },
            { label: "Model", slug: "guides/builtins/model" },
            { label: "Memory", slug: "guides/builtins/memory" },
            { label: "Tools & MCP", slug: "guides/builtins/tools" },
            { label: "Development", slug: "guides/builtins/dev" },
          ],
        },
        {
          label: "API Reference",
          collapsed: true,
          autogenerate: { directory: "reference/api" },
        },
      ],
      plugins: [
        starlightLlmsTxt(),
        starlightTypeDoc({
          entryPoints: [
            "../src/index.ts",
            "../src/http/handler.ts",
            "../src/test/index.ts",
          ],
          tsconfig: "../tsconfig.json",
          output: "reference/api",
          sidebar: {
            label: "API Reference",
            collapsed: true,
          },
          typeDoc: {
            excludePrivate: true,
            excludeInternal: true,
            excludeExternals: true,
            disableSources: true,
            readme: "none",
          },
        }),
      ],
    }),
  ],
})
