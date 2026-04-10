import { getCollection } from "astro:content"
import { OGImageRoute } from "astro-og-canvas"

const entries = await getCollection("docs")
const pages = Object.fromEntries(
  entries.map(({ data, id }) => [id, { data }]),
)

export const { getStaticPaths, GET } = await OGImageRoute({
  pages,
  param: "slug",
  getImageOptions: (_id, page: (typeof pages)[string]) => ({
    title: page.data.title,
    description: page.data.description,
    bgGradient: [[17, 24, 39]],
    border: { color: [124, 58, 237], width: 20, side: "inline-start" },
    padding: 120,
    font: {
      title: {
        color: [248, 250, 252],
        size: 72,
        lineHeight: 1.2,
      },
      description: {
        color: [226, 232, 240],
        size: 36,
      },
    },
  }),
})
