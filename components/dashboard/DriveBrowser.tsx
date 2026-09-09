"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Cloud, File, FileText, Folder, Loader2, Presentation, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import {
  DriveAuthExpiredError,
  DriveListItem,
  DriveSection,
  listDriveFiles,
  preloadGoogleDriveScripts,
  requestAccessToken,
} from "@/lib/google-drive-picker";

// Statically inlined at build time by Next.js (NEXT_PUBLIC_ vars) — reading
// it here just lets the "Se connecter" screen show an honest "not
// configured" state instead of only failing once the student actually
// clicks the button. No API key needed anymore (see google-drive-picker.ts's
// own header comment): a Bearer-token REST call to the Drive API doesn't
// need one, only the Picker widget this replaced did.
const GOOGLE_DRIVE_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);

interface DriveBrowserProps {
  /**
   * Owned by the parent (not local state) so the connection survives this
   * component unmounting — e.g. the student switches to another import tab
   * and back. Only the access token is lifted; section/folder navigation/
   * search reset on remount, which is the expected "reopening a file
   * browser" feel.
   */
  accessToken: string | null;
  onAccessTokenChange: (token: string | null) => void;
  /** Fires once the student taps a real (non-folder) file — the parent owns what happens next (POST to /api/drive/import, etc). */
  onFileSelected: (file: DriveListItem, accessToken: string) => void;
  /** True while the parent is submitting a previously-selected file — disables further picking without unmounting the browser (keeps section/scroll position intact). */
  disabled?: boolean;
}

const SECTION_TABS: { id: DriveSection; label: string }[] = [
  { id: "recent", label: "Récents" },
  { id: "mydrive", label: "Mon Drive" },
  { id: "shared", label: "Partagés avec moi" },
];

interface FolderCrumb {
  id: string;
  name: string;
}

function iconForItem(item: DriveListItem) {
  if (item.isFolder) return Folder;
  if (item.mimeType.includes("presentation")) return Presentation;
  if (item.mimeType.includes("document") || item.mimeType === "text/plain") return FileText;
  return File;
}

function formatModified(iso?: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
  } catch {
    return "";
  }
}

/**
 * NotebookLM-style Drive file browser — Récents / Mon Drive / Partagés avec
 * moi sections, folder navigation, search — talking to the Drive REST API
 * directly (see lib/google-drive-picker.ts's own header comment for why
 * this replaced Google's hosted Picker widget: no iframe, so no third-party-
 * cookie-blocked "sign in" dead end, and every pixel here is our own
 * responsive Tailwind, so mobile gets real tap targets instead of the
 * Picker's fixed desktop layout).
 */
export function DriveBrowser({ accessToken, onAccessTokenChange, onFileSelected, disabled }: DriveBrowserProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [section, setSection] = useState<DriveSection>("recent");
  const [folderStack, setFolderStack] = useState<FolderCrumb[]>([]); // "Mon Drive" navigation only
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState(""); // debounced

  const [items, setItems] = useState<DriveListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Separate from loadError: a failed "Charger plus" must not replace the
  // already-visible list with the full error screen — the student already
  // has real, useful results on screen, they just couldn't get the NEXT
  // page. Shown inline near the load-more button instead.
  const [appendError, setAppendError] = useState<string | null>(null);
  const [isAuthExpired, setIsAuthExpired] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Guards against a slow, superseded request (e.g. the student switches
  // section right after typing a search) overwriting the result of a newer
  // one that resolves first — without this, `items` could briefly show
  // stale results from a request that's no longer relevant.
  const requestIdRef = useRef(0);

  useEffect(() => {
    preloadGoogleDriveScripts();
  }, []);

  // Debounce free-text search — avoids firing a Drive API call on every
  // keystroke.
  useEffect(() => {
    const id = setTimeout(() => setSearchQuery(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  const currentFolderId = folderStack.length ? folderStack[folderStack.length - 1].id : undefined;

  const load = useCallback(
    async (opts: { pageToken?: string; append?: boolean } = {}) => {
      if (!accessToken) return;
      const requestId = ++requestIdRef.current;
      if (opts.append) {
        setIsLoadingMore(true);
        setAppendError(null);
      } else {
        setIsLoading(true);
        setItems([]);
        setLoadError(null);
        setAppendError(null);
      }
      setIsAuthExpired(false);

      try {
        const result = await listDriveFiles(accessToken, {
          section,
          folderId: currentFolderId,
          searchQuery: searchQuery || undefined,
          pageToken: opts.pageToken,
        });
        if (requestIdRef.current !== requestId) return;
        setItems((prev) => (opts.append ? [...prev, ...result.files] : result.files));
        setNextPageToken(result.nextPageToken);
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        if (err instanceof DriveAuthExpiredError) {
          setIsAuthExpired(true);
        }
        const message = err instanceof Error ? err.message : "Impossible de charger tes fichiers Google Drive.";
        if (opts.append) setAppendError(message);
        else setLoadError(message);
      } finally {
        if (requestIdRef.current !== requestId) return;
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [accessToken, section, currentFolderId, searchQuery]
  );

  useEffect(() => {
    if (accessToken) void load();
    // load() is intentionally omitted — it's recreated every render its own
    // deps change, and those deps (accessToken/section/currentFolderId/
    // searchQuery) are already listed below; adding `load` itself would just
    // re-run this identically.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, section, currentFolderId, searchQuery]);

  async function handleConnect() {
    setIsConnecting(true);
    setConnectError(null);
    try {
      const token = await requestAccessToken();
      onAccessTokenChange(token);
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "La connexion à Google Drive a échoué.");
    } finally {
      setIsConnecting(false);
    }
  }

  function handleReconnect() {
    onAccessTokenChange(null);
    setItems([]);
    setLoadError(null);
    setAppendError(null);
    setIsAuthExpired(false);
  }

  function handleItemClick(item: DriveListItem) {
    if (disabled) return;
    if (item.isFolder) {
      // A folder can appear in search results (buildDriveQuery includes
      // folders in its search branch) — but that branch ignores folderId
      // entirely, so pushing onto folderStack while a search is still
      // active was previously a silent no-op (the list didn't change, no
      // breadcrumb appeared), and clearing the search afterward would
      // then jump into that folder with zero warning. Treating this click
      // as "go to Mon Drive > this folder" — clearing the search and
      // switching section — makes it do what it visibly looks like it does.
      setSection("mydrive");
      setSearchInput("");
      setSearchQuery("");
      setFolderStack((prev) => [...prev, { id: item.id, name: item.name }]);
      return;
    }
    if (!accessToken) return;
    onFileSelected(item, accessToken);
  }

  function handleBreadcrumbClick(index: number) {
    // index -1 means "Mon Drive" root
    setFolderStack((prev) => prev.slice(0, index + 1));
  }

  function handleSectionChange(next: DriveSection) {
    setSection(next);
    setFolderStack([]);
    // A section switch while a search is active would otherwise leave the
    // tabs looking inactive (search overrides section in buildDriveQuery) —
    // clearing it here keeps "which section am I browsing" unambiguous.
    setSearchInput("");
    setSearchQuery("");
  }

  if (!GOOGLE_DRIVE_CONFIGURED) {
    return (
      <div className="flex min-h-[13rem] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border px-6 py-10 text-center">
        <Cloud className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Google Drive n&apos;est pas configuré</p>
        <p className="text-xs text-muted-foreground">
          Les identifiants Google (NEXT_PUBLIC_GOOGLE_CLIENT_ID) sont manquants côté serveur.
        </p>
      </div>
    );
  }

  if (!accessToken) {
    return (
      <div className="flex min-h-[13rem] w-full flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-border bg-gradient-to-br from-muted/50 via-muted/30 to-transparent px-6 py-10 text-center">
        <Cloud className="h-10 w-10 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-base font-semibold text-foreground">Connecte ton Google Drive</p>
          <p className="text-xs text-muted-foreground">Parcours tes fichiers et importe-en un directement.</p>
        </div>
        {connectError && <p className="max-w-sm text-sm text-destructive">{connectError}</p>}
        <Button type="button" onClick={handleConnect} isLoading={isConnecting} disabled={isConnecting}>
          {!isConnecting && <Cloud className="h-4 w-4" />}
          Se connecter à Google Drive
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {SECTION_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleSectionChange(tab.id)}
              disabled={disabled}
              className={cn(
                // min-h-[2.75rem] (44px) — Apple/Material's minimum touch
                // target size; px-3/text-xs alone rendered ~28px tall, too
                // small to reliably tap on a real phone.
                "inline-flex min-h-[2.75rem] items-center justify-center rounded-full px-3.5 text-xs font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60",
                section === tab.id && !searchQuery
                  ? "bg-primary/10 text-primary shadow-glow"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Rechercher dans Drive…"
            disabled={disabled}
            aria-label="Rechercher un fichier Google Drive"
            // text-base (16px) below `sm`, dropping to text-sm at ≥640px —
            // same pattern as components/ui/Input.tsx. Below 16px, iOS
            // Safari auto-zooms the whole page on focus; this is the exact
            // field a student searches a long Drive list from on a phone.
            className="w-full rounded-full border border-input bg-card py-2 pl-8 pr-3 text-base text-foreground shadow-soft transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring sm:w-56 sm:py-1.5 sm:text-sm"
          />
        </div>
      </div>

      {section === "mydrive" && !searchQuery && (
        <div className="flex flex-wrap items-center gap-0.5 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => handleBreadcrumbClick(-1)}
            className="inline-flex min-h-[2.75rem] items-center rounded px-2 hover:bg-accent hover:text-foreground"
          >
            Mon Drive
          </button>
          {folderStack.map((crumb, i) => (
            <span key={crumb.id} className="flex items-center gap-0.5">
              <ChevronRight className="h-3 w-3 shrink-0" />
              <button
                type="button"
                onClick={() => handleBreadcrumbClick(i)}
                // max-w + truncate — unlike file-row names (which already
                // truncate), a Drive folder name with no space/hyphen break
                // opportunity could otherwise overflow past the dialog's
                // right edge instead of wrapping.
                className="inline-flex min-h-[2.75rem] max-w-[10rem] items-center truncate rounded px-2 hover:bg-accent hover:text-foreground"
                title={crumb.name}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="min-h-[10rem] max-h-[13rem] overflow-y-auto rounded-2xl border border-border bg-card/50 sm:min-h-[13rem] sm:max-h-[22rem]">
        {isLoading ? (
          <div className="flex h-[10rem] items-center justify-center sm:h-[13rem]">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : loadError ? (
          <div className="flex h-[10rem] flex-col items-center justify-center gap-3 px-6 text-center sm:h-[13rem]">
            <p className="text-sm text-destructive">{loadError}</p>
            {isAuthExpired ? (
              <Button type="button" variant="outline" size="sm" onClick={handleReconnect}>
                <Cloud className="h-3.5 w-3.5" />
                Se reconnecter
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                <RefreshCw className="h-3.5 w-3.5" />
                Réessayer
              </Button>
            )}
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-[10rem] flex-col items-center justify-center gap-1 text-center sm:h-[13rem]">
            <p className="text-sm font-medium text-foreground">Aucun fichier trouvé</p>
            <p className="text-xs text-muted-foreground">
              {searchQuery ? "Essaie un autre terme de recherche." : "Ce dossier ne contient aucun fichier compatible."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => {
              const Icon = iconForItem(item);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleItemClick(item)}
                    disabled={disabled}
                    className="flex min-h-[3rem] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {item.iconLink ? (
                      // Drive-hosted static icon, tiny (16-24px) and per-filetype —
                      // not worth routing through next/image's remote-pattern config
                      // for this; matches this project's existing tolerated <img> spots.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.iconLink} alt="" className="h-5 w-5 shrink-0" />
                    ) : (
                      <Icon className={cn("h-5 w-5 shrink-0", item.isFolder ? "text-primary" : "text-muted-foreground")} />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.name}</span>
                    {item.modifiedTime && (
                      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                        {formatModified(item.modifiedTime)}
                      </span>
                    )}
                    {item.isFolder && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {nextPageToken && !isLoading && !loadError && (
        <div className="flex flex-col items-center gap-2">
          {appendError && <p className="text-center text-xs text-destructive">{appendError}</p>}
          {isAuthExpired && appendError ? (
            <Button type="button" variant="outline" size="sm" onClick={handleReconnect}>
              <Cloud className="h-3.5 w-3.5" />
              Se reconnecter
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              isLoading={isLoadingMore}
              disabled={isLoadingMore || disabled}
              onClick={() => void load({ pageToken: nextPageToken, append: true })}
            >
              Charger plus
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
