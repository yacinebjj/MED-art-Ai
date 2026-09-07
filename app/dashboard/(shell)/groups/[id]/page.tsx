"use client";

import { useParams } from "next/navigation";
import { ChatRoom } from "@/components/groups/ChatRoom";

export default function GroupChatPage() {
  const params = useParams<{ id: string }>();
  const groupId = params.id;

  if (!groupId) {
    return <p className="p-6 text-sm text-destructive">Groupe invalide.</p>;
  }

  return (
    <div className="h-full rounded-3xl border border-border bg-card shadow-soft">
      <ChatRoom groupId={groupId} />
    </div>
  );
}
