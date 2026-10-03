"use client";

import { useState, type FormEvent } from "react";
import { BarChart3, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { MAX_POLL_OPTION_CHARS, MAX_POLL_OPTIONS, MAX_POLL_QUESTION_CHARS } from "@/lib/group-chat-envelope";

/** "Créer un sondage" — question + 2..8 choices, single or multiple choice. */
export function PollComposer({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (poll: { question: string; options: string[]; multi: boolean }) => void;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multi, setMulti] = useState(false);

  const cleaned = options.map((o) => o.trim()).filter(Boolean);
  const valid = question.trim().length > 0 && new Set(cleaned).size >= 2;

  function reset() {
    setQuestion("");
    setOptions(["", ""]);
    setMulti(false);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    onSubmit({ question: question.trim(), options: Array.from(new Set(cleaned)), multi });
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-md">
              <BarChart3 className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle>Nouveau sondage</DialogTitle>
              <DialogDescription>Ex. : « Quel module on révise ce soir ? »</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={MAX_POLL_QUESTION_CHARS}
            placeholder="Ta question"
            className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-semibold outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
            autoFocus
          />
          <div className="space-y-2">
            {options.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  value={option}
                  onChange={(e) => setOptions((prev) => prev.map((o, i) => (i === index ? e.target.value : o)))}
                  maxLength={MAX_POLL_OPTION_CHARS}
                  placeholder={`Choix ${index + 1}`}
                  className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setOptions((prev) => prev.filter((_, i) => i !== index))}
                    aria-label="Retirer ce choix"
                    className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {options.length < MAX_POLL_OPTIONS && (
            <button type="button" onClick={() => setOptions((prev) => [...prev, ""])} className="flex items-center gap-1.5 text-sm font-semibold text-cyan-600 hover:underline dark:text-cyan-400">
              <Plus className="h-4 w-4" />
              Ajouter un choix
            </button>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} className="h-4 w-4 accent-cyan-600" />
            Autoriser plusieurs choix
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={!valid}>
              Publier le sondage
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
