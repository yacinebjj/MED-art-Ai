"use client";

import type { ReactNode } from "react";
import { useSecurityGuard } from "@/hooks/useSecurityGuard";

/** Mounted once at the root layout — see useSecurityGuard's own header comment for exactly what this does and doesn't protect against. */
export function SecurityGuard({ children }: { children: ReactNode }) {
  const { isBlurred } = useSecurityGuard();

  return (
    <>
      {children}
      {isBlurred && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[9998] transition-opacity duration-150"
          style={{ backdropFilter: "blur(15px)", WebkitBackdropFilter: "blur(15px)" }}
        />
      )}
    </>
  );
}
