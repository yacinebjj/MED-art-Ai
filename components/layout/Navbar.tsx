import Link from "next/link";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { Button } from "@/components/ui/Button";

const NAV_LINKS = [
  { href: "#features", label: "Fonctionnalités" },
  { href: "#how-it-works", label: "Comment ça marche" },
  { href: "#tarifs", label: "Tarifs" },
];

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      {/* h-16 -> h-20 to comfortably fit the bigger size="lg" (80px) mark. */}
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/">
          <Logo size="lg" />
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="group relative text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
              <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-primary transition-transform duration-200 group-hover:scale-x-100" />
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Connexion</Link>
          </Button>
          <Button asChild variant="primary" size="sm" className="hidden sm:inline-flex">
            <Link href="/register">Créer un compte</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
