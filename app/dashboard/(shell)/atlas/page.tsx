import type { Metadata } from "next";
import { AtlasZoomHub } from "@/components/atlas/AtlasZoomHub";

export const metadata: Metadata = {
  title: "Atlas Zoom — Med Art AI",
  description: "Anatomie interactive : 12 atlas zoomables, de l’organe à la molécule.",
};

export default function AtlasZoomPage() {
  return <AtlasZoomHub />;
}
