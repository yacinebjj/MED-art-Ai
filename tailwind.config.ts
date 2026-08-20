import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./hooks/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        // Med Art AI "Clinical SaaS" design system — this is Tailwind's real
        // teal palette (not a custom-tuned scale) so `primary-600` is
        // exactly the spec'd #0d9488, `primary-50` #f0fdfa, etc.
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          50: "#f0fdfa",
          100: "#ccfbf1",
          200: "#99f6e4",
          300: "#5eead4",
          400: "#2dd4bf",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
          900: "#134e4a",
          950: "#042f2e",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#172554",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 2px 10px -2px rgb(0 0 0 / 0.08)",
        card: "0 4px 24px -4px rgb(0 0 0 / 0.08)",
        glow: "0 0 0 1px hsl(var(--primary) / 0.15), 0 8px 30px -8px hsl(var(--primary) / 0.35)",
        // "Futuristic Medical Elegance" glass chrome — a soft ambient shadow
        // plus a hairline inset highlight (the light catching the top edge
        // of a frosted pane), on top of Tailwind's own arbitrary
        // shadow-[...] utilities already used for one-off card glows.
        glass: "0 8px 32px -8px rgb(0 0 0 / 0.12), inset 0 1px 0 0 rgb(255 255 255 / 0.4)",
        "glass-dark": "0 8px 32px -8px rgb(0 0 0 / 0.5), inset 0 1px 0 0 rgb(255 255 255 / 0.06)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "dash-flow": {
          to: { strokeDashoffset: "-20" },
        },
        "aurora-breathe": {
          "0%, 100%": { opacity: "0.6", transform: "scale(1) translate(0, 0)" },
          "50%": { opacity: "1", transform: "scale(1.15) translate(2%, -2%)" },
        },
        "sidebar-wave": {
          "0%, 100%": { transform: "translate(0%, 0%) scale(1)" },
          "33%": { transform: "translate(4%, -6%) scale(1.08)" },
          "66%": { transform: "translate(-3%, 5%) scale(0.96)" },
        },
        "mesh-pulse": {
          "0%, 100%": { opacity: "0.06" },
          "50%": { opacity: "0.1" },
        },
        // Gentle vertical bob for the animated brand mark / empty-state
        // icons — distinct from aurora-breathe (which scales/fades a large
        // background blob), this is for a small foreground glyph.
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        // Outward-expanding ring pulse (the "neural node" halo around the
        // animated logo) — opacity fades to 0 as it scales up, looped.
        "ring-pulse": {
          "0%": { transform: "scale(0.9)", opacity: "0.6" },
          "80%, 100%": { transform: "scale(1.6)", opacity: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
        "dash-flow": "dash-flow 1s linear infinite",
        "aurora-breathe": "aurora-breathe 12s ease-in-out infinite",
        "sidebar-wave": "sidebar-wave 20s ease-in-out infinite",
        "mesh-pulse": "mesh-pulse 20s ease-in-out infinite",
        float: "float 4s ease-in-out infinite",
        "ring-pulse": "ring-pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        shimmer: "shimmer 2.5s linear infinite",
      },
    },
  },
  plugins: [require("@tailwindcss/typography"), require("tailwindcss-animate")],
};

export default config;
