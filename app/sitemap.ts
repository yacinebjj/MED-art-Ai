import type { MetadataRoute } from "next";

/** /sitemap.xml (it answered 404): the public pages, on the canonical host. */
export default function sitemap(): MetadataRoute.Sitemap {
  const site = "https://www.medartai.com";
  return [
    { url: `${site}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${site}/pricing`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${site}/register`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${site}/login`, changeFrequency: "monthly", priority: 0.4 },
  ];
}
