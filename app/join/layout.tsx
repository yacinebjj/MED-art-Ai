import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Invitation — Med Art AI",
  description: "Rejoins ton groupe et débloquez MedArt AI ensemble, à prix réduit. Remboursement déclenché automatiquement si l'objectif n'est pas atteint.",
};

export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
