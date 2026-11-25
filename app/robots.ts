import type { MetadataRoute } from "next";

/**
 * /robots.txt (it answered 404). Crawlers are kept out of the signed-in app
 * and the API — /dashboard and /study only redirect them to /login — and
 * pointed at the sitemap. Invite pages (/join/…) stay crawlable so that
 * link previews of a shared invitation keep working.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard", "/study", "/auth/"] },
    sitemap: "https://www.medartai.com/sitemap.xml",
  };
}
