"use client";

import { useRef, useState } from "react";
import { useTheme } from "next-themes";
import { FileText, PanelLeftClose, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { WorkspaceTopbar } from "@/components/course/workspace/WorkspaceTopbar";
import { ChatDocumentPanel, type ChatDocumentPanelHandle } from "@/components/course/workspace/ChatDocumentPanel";
import { StudioPanel, type SectionStatus } from "@/components/course/workspace/StudioPanel";
import { DEMO_SECTIONS, type DemoSectionId } from "@/lib/demo-content";
import type { ChatMessage } from "@/lib/types";

/**
 * Same NotebookLM-style 3-column shell as the real course workspace
 * (app/dashboard/demo/[slug]/page.tsx) — reusing WorkspaceTopbar,
 * ChatDocumentPanel and StudioPanel verbatim so this looks identical, not
 * "inspired by". The only thing this page doesn't have is real per-module
 * data: no course row, no uploaded source, nothing generated yet. So unlike
 * the real page, every Studio tile stays "needs_generation" forever and
 * opening one shows an honest "bientôt disponible pour ce module" message
 * instead of fabricating content — the same pattern already used there for
 * Mind Map on non-Pleurésie courses. Sources also skips the shared
 * SourcesPanel (which unconditionally renders one hardcoded file row) in
 * favor of a local empty-state, since inventing a source file that was never
 * uploaded would misrepresent real data to the student.
 */

const MODULE_TITLE = "Anatomie — 1ère Année";

function AnatomieSourcesPanel() {
  const { toast } = useToast();

  function notYetAvailable() {
    toast({
      variant: "info",
      title: "Bientôt disponible",
      description: "L'ajout de sources pour ce module arrive dans une prochaine mise à jour.",
    });
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sources</h2>
        <button
          type="button"
          aria-label="Fermer le panneau"
          className="rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-gray-100"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col space-y-4 overflow-y-auto p-4">
        <Button variant="outline" size="sm" className="w-full rounded-xl" onClick={notYetAvailable}>
          <Plus className="h-4 w-4" />
          Add sources
        </Button>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <Input
            placeholder="Search the web..."
            disabled
            className="border-none bg-gray-100 pl-9 shadow-none dark:bg-neutral-800 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-200 p-8 text-center dark:border-neutral-800">
          <FileText className="h-6 w-6 text-gray-300 dark:text-neutral-700" />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Aucune source pour l'instant</p>
          <p className="text-xs text-gray-400 dark:text-neutral-600">
            Ajoute un cours pour commencer à discuter avec l'IA.
          </p>
        </div>
      </div>
    </>
  );
}

export default function AnatomieModulePage() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { toast } = useToast();

  const chatPanelRef = useRef<ChatDocumentPanelHandle>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isSplitScreen, setIsSplitScreen] = useState(false);

  const [openedSection, setOpenedSection] = useState<DemoSectionId | null>(null);
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [noteContent, setNoteContent] = useState("");

  const today = new Date().toLocaleDateString("fr-FR");
  const openedSectionLabel = DEMO_SECTIONS.find((s) => s.id === openedSection)?.label ?? "";

  function notYetAvailable(feature: string) {
    toast({ variant: "info", title: "Bientôt disponible", description: `${feature} arrive dans une prochaine mise à jour.` });
  }

  function handleSend() {
    const text = chatInput.trim();
    if (!text || isTyping) return;

    setChatMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: text }]);
    setChatInput("");
    setIsTyping(true);

    setTimeout(() => {
      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "Le Chat IA pour le module Anatomie arrive bientôt — dès qu'un cours sera ajouté ici, je pourrai répondre à tes questions dessus.",
        },
      ]);
      setIsTyping(false);
    }, 700);
  }

  const chatPanel = (
    <ChatDocumentPanel
      ref={chatPanelRef}
      title={MODULE_TITLE}
      dateLabel={today}
      sourceCount={0}
      messages={chatMessages}
      isTyping={isTyping}
      input={chatInput}
      onInputChange={setChatInput}
      onSend={handleSend}
      onClearHistory={() => setChatMessages([])}
      onAskSelection={() => notYetAvailable("La réponse sur un extrait sélectionné")}
      onTranslateSelection={() => notYetAvailable("La traduction d'un extrait sélectionné")}
      pendingThinkingLabel={null}
      isSplitScreen={isSplitScreen}
      onToggleSplitScreen={() => setIsSplitScreen((v) => !v)}
      dark={isDark}
    />
  );

  const studioPanel = (
    <StudioPanel
      sections={DEMO_SECTIONS}
      openedSection={openedSection}
      openedLabel={openedSectionLabel}
      onItemClick={(id) => setOpenedSection(id)}
      onCloseSection={() => setOpenedSection(null)}
      getSectionStatus={(): SectionStatus => "needs_generation"}
      generatingSection={null}
      sourceCount={0}
      isNoteOpen={isNoteOpen}
      onOpenNote={() => setIsNoteOpen(true)}
      onBackFromNote={() => setIsNoteOpen(false)}
      onDeleteNote={() => {
        setIsNoteOpen(false);
        setNoteContent("");
      }}
      noteContent={noteContent}
      onNoteContentChange={setNoteContent}
      onAskSelection={() => notYetAvailable("La réponse sur un extrait sélectionné")}
      onTranslateSelection={() => notYetAvailable("La traduction d'un extrait sélectionné")}
    >
      {openedSection && (
        <div className="flex h-full flex-col items-center justify-center gap-2 py-20 text-center">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {openedSectionLabel} — bientôt disponible pour ce module
          </p>
          <p className="max-w-sm text-xs text-gray-500 dark:text-gray-400">
            Cette fonctionnalité arrivera pour Anatomie une fois un cours ajouté et généré par l'IA.
          </p>
        </div>
      )}
    </StudioPanel>
  );

  const panelShellClasses =
    "flex flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm transition-all duration-300 dark:border-neutral-800 dark:bg-neutral-900";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-100 dark:bg-neutral-950">
      <WorkspaceTopbar title={MODULE_TITLE} />

      <div className="flex flex-1 gap-4 overflow-hidden p-4">
        {!isSplitScreen && (
          <aside className={cn(panelShellClasses, "w-72 shrink-0")}>
            <AnatomieSourcesPanel />
          </aside>
        )}

        <div
          className={cn(
            "grid flex-1 gap-4 overflow-hidden transition-all duration-300",
            isSplitScreen ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
          )}
        >
          <main className={panelShellClasses}>{chatPanel}</main>
          {isSplitScreen && <aside className={panelShellClasses}>{studioPanel}</aside>}
        </div>

        {!isSplitScreen && <aside className={cn(panelShellClasses, "w-96 shrink-0")}>{studioPanel}</aside>}
      </div>
    </div>
  );
}
