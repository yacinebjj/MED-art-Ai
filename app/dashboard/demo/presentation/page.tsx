import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { VisualPresentationEngine } from "@/components/visual-studio/VisualPresentationEngine";
import { APPENDICITIS_DECK } from "@/lib/appendicitis-deck-data";

export default function PresentationDemoPage() {
  return (
    <div className="relative">
      <Link
        href="/dashboard/demo"
        className="glass-panel absolute left-4 top-4 z-40 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-foreground shadow-glass transition-all duration-300 hover:-translate-x-0.5 dark:shadow-glass-dark"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Retour à la démo
      </Link>
      <VisualPresentationEngine deck={APPENDICITIS_DECK} />
    </div>
  );
}
