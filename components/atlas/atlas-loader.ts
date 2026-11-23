import { atlasDocument, atlasFirstPlate, type AtlasEntry } from "./atlas-catalog";

/** The atlas file is not deployed (yet): the viewer shows "Bientôt disponible", never a 404. */
export class AtlasMissingError extends Error {
  constructor(slug: string) {
    super(`Atlas "${slug}" introuvable`);
    this.name = "AtlasMissingError";
  }
}

// One request per atlas per visit: a medallion hovered a second ago opens instantly.
// A failed load is forgotten so "Réessayer" really retries.
const documents = new Map<string, Promise<string>>();
const warmedPlates = new Set<string>();

export function loadAtlasDocument(slug: string): Promise<string> {
  let pending = documents.get(slug);
  if (!pending) {
    pending = fetch(atlasDocument(slug), { credentials: "same-origin" }).then(async (response) => {
      if (response.status === 404) throw new AtlasMissingError(slug);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      // A missing file can also come back as an HTML error page with a 200 (e.g. a proxy):
      // the real atlas always carries its engine hook.
      if (!html.includes("__atlas")) throw new AtlasMissingError(slug);
      return html;
    });
    documents.set(slug, pending);
    pending.catch(() => documents.delete(slug));
  }
  return pending;
}

/** Hover / focus / touch on a medallion: fetch the atlas page and its first plate ahead of the click. */
export function warmAtlas(atlas: AtlasEntry): void {
  if (!atlas.available) return;
  loadAtlasDocument(atlas.slug).catch(() => undefined);
  const plate = atlasFirstPlate(atlas);
  if (warmedPlates.has(plate)) return;
  warmedPlates.add(plate);
  const image = new Image();
  image.decoding = "async";
  image.src = plate;
}
