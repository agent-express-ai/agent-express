import { defineRouteMiddleware } from "@astrojs/starlight/route-data"

export const onRequest = defineRouteMiddleware((context) => {
  const id = context.locals.starlightRoute.id || "index"
  const ogImageUrl = new URL(`/og/${id}.png`, context.site)

  context.locals.starlightRoute.head.push(
    { tag: "meta", attrs: { property: "og:image", content: ogImageUrl.href } },
    {
      tag: "meta",
      attrs: { property: "og:image:width", content: "1200" },
    },
    {
      tag: "meta",
      attrs: { property: "og:image:height", content: "630" },
    },
    {
      tag: "meta",
      attrs: { name: "twitter:image", content: ogImageUrl.href },
    },
  )
})
