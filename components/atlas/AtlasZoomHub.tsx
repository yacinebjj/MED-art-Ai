"use client";

import { Suspense, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { ArrowRight, ArrowUpRight, Layers, Microscope, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LocalErrorBoundary } from "@/components/ui/LocalErrorBoundary";
import { ATLAS_TOTALS, ATLASES, FEATURED_ATLAS, atlasMedallion, getAtlas, searchAtlases, type AtlasCategory, type AtlasEntry, type AtlasMatch } from "./atlas-catalog";
import { loadAtlasDocument, warmAtlas } from "./atlas-loader";
import { AtlasViewer } from "./AtlasViewer";
import { atlasHand } from "./atlas-fonts";
import { HandText } from "./HandText";
import styles from "./atlas-zoom.module.css";

/*
 * Atlas Zoom hub (/dashboard/atlas): the Tronc showcase, then the 11 organ medallions with
 * filters and instant search. An atlas opens in AtlasViewer, driven by the URL
 * (?organe=<slug>[&planche=<n>]) so Back closes it and a link reopens it. Next.js syncs
 * useSearchParams with history.pushState/replaceState, so opening costs no navigation.
 */

type Filter = "all" | AtlasCategory;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "thorax", label: "Thorax" },
  { id: "digestif", label: "Digestif" },
  { id: "genital", label: "Génital" },
];

const GRID_ATLASES = ATLASES.filter((atlas) => !atlas.featured);

const DIVE_PATH = [
  { name: "Peau & Histologie", meta: "Plans 1–2" },
  { name: "Muscles & Os", meta: "Plans 3–6" },
  { name: "Viscères", meta: "Plans 7–9" },
];

/** "1 205" — same output on the server and in every browser (no locale data involved). */
const formatCount = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");

/* ───────────── URL ⇄ viewer ───────────── */

type ViewerHistoryState = { azViewer?: boolean } | null;

function atlasUrl(slug: string | null, plate: number | null): string {
  const url = new URL(window.location.href);
  if (slug) url.searchParams.set("organe", slug);
  else url.searchParams.delete("organe");
  if (slug && plate != null) url.searchParams.set("planche", String(plate + 1));
  else url.searchParams.delete("planche");
  return `${url.pathname}${url.search}${url.hash}`;
}

function openAtlas(slug: string, plate: number | null) {
  window.history.pushState({ azViewer: true }, "", atlasUrl(slug, plate));
}

function switchAtlas(slug: string) {
  const state = window.history.state as ViewerHistoryState;
  window.history.replaceState({ azViewer: state?.azViewer === true }, "", atlasUrl(slug, null));
}

/** Back to the hub: undo our own history entry, or (link opened directly) just drop the parameters. */
function closeAtlas() {
  const state = window.history.state as ViewerHistoryState;
  if (state?.azViewer) window.history.back();
  else window.history.replaceState({}, "", atlasUrl(null, null));
}

function unknownAtlas(slug: string): AtlasEntry {
  return {
    slug,
    number: 0,
    name: "Atlas",
    short: "Atlas",
    tagline: "",
    category: "thorax",
    categories: [],
    stages: [],
    scale: "",
    pins: 0,
    firstPlate: "p1",
    plates: [],
    keywords: "",
    available: false,
  };
}

function isModifiedClick(event: MouseEvent) {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/** Reads ?organe= — behind its own Suspense so the hub itself still renders statically. */
function AtlasViewerHost() {
  const params = useSearchParams();
  const slug = params.get("organe");
  const lastFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (slug && !wasOpen.current) {
      wasOpen.current = true;
      lastFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    } else if (!slug && wasOpen.current) {
      wasOpen.current = false;
      const target = lastFocus.current;
      lastFocus.current = null;
      if (target?.isConnected) target.focus({ preventScroll: true });
    }
  }, [slug]);

  if (!slug) return null;
  const atlas = getAtlas(slug) ?? unknownAtlas(slug);
  const planche = Number.parseInt(params.get("planche") ?? "", 10);
  const plate = Number.isInteger(planche) && planche >= 1 && planche <= atlas.plates.length ? planche - 1 : null;

  return (
    <LocalErrorBoundary title="L’atlas n’a pas pu s’ouvrir." description="Rien n’est perdu : réessaie, ou choisis un autre organe." onReset={closeAtlas} resetKey={slug}>
      <AtlasViewer atlas={atlas} plate={plate} onClose={closeAtlas} onSwitch={switchAtlas} />
    </LocalErrorBoundary>
  );
}

/* ───────────── hub ───────────── */

export function AtlasZoomHub() {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const searchRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: GRID_ATLASES.length, thorax: 0, digestif: 0, genital: 0 };
    for (const atlas of GRID_ATLASES) for (const category of atlas.categories) result[category] += 1;
    return result;
  }, []);

  // No query: the 11 organs (the Tronc has the showcase). A query searches all 12.
  const matches = useMemo<AtlasMatch[]>(() => {
    const found = searchAtlases(deferredQuery ? ATLASES : GRID_ATLASES, deferredQuery);
    return filter === "all" ? found : found.filter((match) => match.atlas.categories.includes(filter));
  }, [deferredQuery, filter]);

  // The showcase is the likeliest first click: fetch its page once the hub is idle.
  useEffect(() => {
    const warm = () => loadAtlasDocument(FEATURED_ATLAS.slug).catch(() => undefined);
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(warm, 1500);
    return () => clearTimeout(id);
  }, []);

  // "/" jumps to the search field.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (document.documentElement.classList.contains("az-viewer-open")) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const open = (event: MouseEvent<HTMLAnchorElement>, atlas: AtlasEntry, plate: number | null) => {
    if (isModifiedClick(event)) return;
    event.preventDefault();
    warmAtlas(atlas);
    openAtlas(atlas.slug, plate);
  };

  const featuredHref = `/dashboard/atlas?organe=${FEATURED_ATLAS.slug}`;
  const warmFeatured = () => warmAtlas(FEATURED_ATLAS);

  return (
    <div className={cn(styles.hub, "pb-6")}>
      {/* ── header */}
      <header className={styles.head}>
        <div className={styles.headMain}>
          <span className={styles.headIcon} aria-hidden>
            <Microscope className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className={styles.kicker}>Anatomie interactive</p>
            <h1 className={styles.title}>Atlas Zoom</h1>
            <p className={styles.subtitle}>Plonge de l’organe à la molécule, avec les pièges d’EMD à chaque échelle.</p>
          </div>
        </div>
        <div className={styles.stats}>
          <span className={styles.stat}>
            <b>{ATLAS_TOTALS.atlases}</b> atlas
          </span>
          <span className={styles.stat}>
            <b>{ATLAS_TOTALS.plates}</b> planches
          </span>
          <span className={styles.stat}>
            <b>{formatCount(ATLAS_TOTALS.pins)}</b> repères
          </span>
        </div>
      </header>

      {/* ── showcase: Le Tronc */}
      <section className={styles.vitrine} aria-labelledby="atlas-featured-title">
        <div className={styles.stage}>
          <a
            href={featuredHref}
            className={styles.orbit}
            onClick={(event) => open(event, FEATURED_ATLAS, null)}
            onPointerEnter={warmFeatured}
            onTouchStart={warmFeatured}
            tabIndex={-1}
            aria-hidden
          >
            <svg className={styles.ringBase} viewBox="0 0 400 400" aria-hidden>
              <defs>
                <path id="az-ring-1" d="M 200 200 m -188 0 a 188 188 0 1 1 376 0 a 188 188 0 1 1 -376 0" />
                <path id="az-ring-2" d="M 200 200 m -172 0 a 172 172 0 1 1 344 0 a 172 172 0 1 1 -344 0" />
                <path id="az-ring-3" d="M 200 200 m -156 0 a 156 156 0 1 1 312 0 a 156 156 0 1 1 -312 0" />
              </defs>
              <circle cx="200" cy="200" r="196" fill="none" stroke="rgb(246 239 226 / 0.08)" strokeWidth="1" />
              <circle cx="200" cy="200" r="188" fill="none" stroke="rgb(246 239 226 / 0.12)" strokeWidth="1.5" />
              <circle cx="200" cy="200" r="172" fill="none" stroke="rgb(246 239 226 / 0.1)" strokeWidth="1.5" />
              <circle cx="200" cy="200" r="156" fill="none" stroke="rgb(246 239 226 / 0.09)" strokeWidth="1.5" />
              <text className={styles.ringLabel} dy={9}>
                <textPath href="#az-ring-1" startOffset="5%">
                  Peau & histologie
                </textPath>
              </text>
              <text className={styles.ringLabel} dy={9}>
                <textPath href="#az-ring-2" startOffset="6.5%">
                  Muscles & os
                </textPath>
              </text>
              <text className={styles.ringLabel} dy={9}>
                <textPath href="#az-ring-3" startOffset="9%">
                  Viscères
                </textPath>
              </text>
            </svg>
            <svg className={styles.ringSpin} viewBox="0 0 400 400" aria-hidden>
              <circle cx="200" cy="200" r="196" fill="none" stroke="rgb(251 113 133 / 0.5)" strokeWidth="1.5" strokeDasharray="1.5 9" strokeLinecap="round" />
            </svg>
            <svg className={cn(styles.arc, styles.arcA)} viewBox="0 0 400 400" aria-hidden>
              <circle cx="200" cy="200" r="188" fill="none" stroke="#fb7185" strokeWidth="3" strokeLinecap="round" strokeDasharray="236 945" />
            </svg>
            <svg className={cn(styles.arc, styles.arcB)} viewBox="0 0 400 400" aria-hidden>
              <circle cx="200" cy="200" r="172" fill="none" stroke="#fda4af" strokeWidth="3" strokeLinecap="round" strokeDasharray="216 865" />
            </svg>
            <svg className={cn(styles.arc, styles.arcC)} viewBox="0 0 400 400" aria-hidden>
              <circle cx="200" cy="200" r="156" fill="none" stroke="#fecdd3" strokeWidth="3" strokeLinecap="round" strokeDasharray="196 785" />
            </svg>
            <span className={styles.disc}>
              <Image src="/atlas-zoom/_hub/tronc-1.webp" alt="" fill priority sizes="(max-width: 860px) 70vw, 300px" className={cn(styles.layer, styles.layerA)} />
              <Image src="/atlas-zoom/_hub/tronc-2.webp" alt="" fill sizes="(max-width: 860px) 70vw, 300px" className={cn(styles.layer, styles.layerB)} />
              <Image src="/atlas-zoom/_hub/tronc-3.webp" alt="" fill sizes="(max-width: 860px) 70vw, 300px" className={cn(styles.layer, styles.layerC)} />
            </span>
            <span className={styles.orbHint}>
              <Layers className="h-3.5 w-3.5" /> Disséquer
            </span>
          </a>
        </div>

        <div className={styles.copy}>
          <p className={styles.eyebrow}>
            <i aria-hidden /> Atlas vedette · 01
          </p>
          <h2 id="atlas-featured-title" className={cn(atlasHand.className, styles.heroTitle)}>
            <HandText text={FEATURED_ATLAS.name} />
          </h2>
          <p className={styles.heroLead}>
            Une dissection couche par couche : de la peau et du derme aux muscles et au squelette, jusqu’aux viscères du thorax, de l’abdomen et du
            rétropéritoine.
          </p>
          <ol className={styles.path} aria-label="Parcours de dissection">
            {DIVE_PATH.map((step, index) => (
              <li key={step.name} className={styles.step}>
                <span className={styles.stepNum}>{index + 1}</span>
                <span className={styles.stepName}>{step.name}</span>
                <span className={styles.stepMeta}>{step.meta}</span>
              </li>
            ))}
          </ol>
          <div className={styles.ctaRow}>
            <a href={featuredHref} className={styles.cta} onClick={(event) => open(event, FEATURED_ATLAS, null)} onPointerEnter={warmFeatured} onFocus={warmFeatured} onTouchStart={warmFeatured}>
              Lancer la dissection <ArrowRight className="h-5 w-5" aria-hidden />
            </a>
            <span className={styles.ctaMeta}>
              {FEATURED_ATLAS.plates.length} plans · {FEATURED_ATLAS.pins} repères
            </span>
          </div>
        </div>
      </section>

      {/* ── filters + search */}
      <div className={styles.toolbar}>
        <div className={styles.pills} role="group" aria-label="Filtrer par appareil">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(styles.pill, styles.tone)}
              data-cat={item.id}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.id !== "all" && <span className={styles.pillDot} aria-hidden />}
              {item.label}
              {item.id !== "all" && <span className={styles.pillCount}>{counts[item.id]}</span>}
            </button>
          ))}
        </div>
        <div className={styles.search} role="search">
          <Search className={styles.searchIcon} aria-hidden />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              }
            }}
            placeholder="Organe, structure, cellule… (ex. Langerhans)"
            aria-label="Rechercher dans les atlas"
            className={styles.searchInput}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
          />
          {query && (
            <button type="button" className={styles.searchClear} onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }} aria-label="Effacer la recherche">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {deferredQuery && matches.length > 0 && (
        <p className={styles.resultNote} aria-live="polite">
          {matches.length} atlas pour « {deferredQuery} »
          {matches.some((match) => match.plate != null) ? " — ouverture directe sur la planche indiquée." : "."}
        </p>
      )}

      {/* ── medallions */}
      {matches.length > 0 ? (
        <ul className={styles.grid}>
          {matches.map((match, index) => (
            <Medallion key={match.atlas.slug} match={match} index={index} onOpen={open} />
          ))}
        </ul>
      ) : (
        <div className={styles.empty} role="status">
          <p>Aucun atlas ne correspond{deferredQuery ? ` à « ${deferredQuery} »` : ""}.</p>
          <span>Essaie un organe, une structure ou une cellule : « villosité », « Purkinje », « hépatocyte »…</span>
          <button
            type="button"
            className={styles.emptyReset}
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            Tout afficher
          </button>
        </div>
      )}

      <div className={styles.tips} aria-label="Raccourcis">
        <span>
          <kbd>Molette</kbd> / pincer : zoomer
        </span>
        <span>
          <kbd>Double-clic</kbd> plonger
        </span>
        <span>
          <kbd>←</kbd>
          <kbd>→</kbd> planche précédente / suivante
        </span>
        <span>
          <kbd>F</kbd> plein écran
        </span>
      </div>

      <Suspense fallback={null}>
        <AtlasViewerHost />
      </Suspense>
    </div>
  );
}

function Medallion({
  match,
  index,
  onOpen,
}: {
  match: AtlasMatch;
  index: number;
  onOpen: (event: MouseEvent<HTMLAnchorElement>, atlas: AtlasEntry, plate: number | null) => void;
}) {
  const { atlas, plate } = match;
  const style = { "--i": index } as CSSProperties;
  const body = (
    <>
      <span className={styles.orb}>
        <span className={styles.orbGlow} aria-hidden />
        <span className={styles.orbRing} aria-hidden />
        <span className={styles.orbDisc}>
          <Image src={atlasMedallion(atlas.slug)} alt="" fill sizes="(max-width: 560px) 42vw, 168px" className={styles.orbImg} />
        </span>
        <span className={styles.num} aria-hidden>
          {String(atlas.number).padStart(2, "0")}
        </span>
        {!atlas.available && <span className={styles.soonTag}>Bientôt disponible</span>}
      </span>
      <h3 className={cn(atlasHand.className, styles.cardTitle)}>
        <HandText text={atlas.name} />
      </h3>
      <span className={styles.tagline}>{atlas.tagline}</span>
      {plate != null && (
        <span className={styles.hit}>
          ↳ Planche {plate + 1} · {atlas.plates[plate]?.[0]}
        </span>
      )}
      <span className={styles.stages}>
        {atlas.stages.map((stage) => (
          <span key={stage} className={styles.stageChip}>
            {stage}
          </span>
        ))}
      </span>
      <span className={styles.meta}>
        <span>
          {atlas.plates.length} {atlas.featured ? "plans" : "planches"} · {atlas.pins} repères
        </span>
        <span className={styles.go} aria-hidden>
          <ArrowUpRight className="h-4 w-4" />
        </span>
      </span>
    </>
  );

  if (!atlas.available) {
    return (
      <li>
        <div className={cn(styles.card, styles.tone, styles.soon)} data-cat={atlas.category} style={style} aria-disabled="true">
          {body}
        </div>
      </li>
    );
  }

  const warm = () => warmAtlas(atlas);
  const href = `/dashboard/atlas?organe=${atlas.slug}${plate != null ? `&planche=${plate + 1}` : ""}`;
  return (
    <li>
      <a
        href={href}
        className={cn(styles.card, styles.tone)}
        data-cat={atlas.category}
        style={style}
        onClick={(event) => onOpen(event, atlas, plate)}
        onPointerEnter={warm}
        onFocus={warm}
        onTouchStart={warm}
      >
        {body}
      </a>
    </li>
  );
}
