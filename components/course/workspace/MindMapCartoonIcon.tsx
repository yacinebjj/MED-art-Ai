/**
 * Hand-authored cartoon-style medical glyphs for the Mind Map's leaves —
 * replaces both the v9 Lucide thin-line icons ("too dashboard") and the v10
 * Unicode emoji ("too amateur", explicit order to remove them entirely).
 * Each icon is a small multi-shape inline SVG (never a rasterized image, so
 * it always renders crisply and can be recolored per branch), built from
 * `color` (opaque, the branch's own color — guarantees harmony) plus
 * `fillOpacity` tints of that same color and white accent strokes for a
 * flat two-tone "cartoon" pop. Covers the exact 30-name kebab-case
 * vocabulary the Mind Map prompt is constrained to
 * (lib/ai/studio-prompts.ts's STUDIO_MIND_MAP_SYSTEM_PROMPT icon list) —
 * scoped to this component only, never imported by the locked
 * GastriteCasCliniqueStudio (which still uses lib/lucide-icon-lookup.ts).
 */
export function MindMapCartoonIcon({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  const props = { width: size, height: size, viewBox: "0 0 24 24", xmlns: "http://www.w3.org/2000/svg" };
  switch (name) {
    case "shield":
    case "shield-alert":
      return (
        <svg {...props}>
          <path d="M12 2l7 3v6c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V5l7-3z" fill={color} />
          {name === "shield-alert" ? (
            <>
              <rect x="11" y="8" width="2" height="6" rx="1" fill="#fff" />
              <circle cx="12" cy="16.5" r="1.2" fill="#fff" />
            </>
          ) : (
            <path d="M8.5 12l2.5 2.5L16 9" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
      );
    case "bug":
      return (
        <svg {...props}>
          <ellipse cx="12" cy="13" rx="5" ry="6" fill={color} />
          <circle cx="12" cy="13" r="5" fill={color} fillOpacity="0.35" />
          <line x1="8" y1="10" x2="4" y2="8" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
          <line x1="7" y1="14" x2="3" y2="14" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
          <line x1="8" y1="18" x2="4" y2="20" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
          <line x1="16" y1="10" x2="20" y2="8" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
          <line x1="17" y1="14" x2="21" y2="14" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
          <line x1="16" y1="18" x2="20" y2="20" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
          <line x1="10" y1="7" x2="9" y2="3" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
          <line x1="14" y1="7" x2="15" y2="3" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "pill":
      return (
        <svg {...props}>
          <rect x="3" y="9" width="18" height="6" rx="3" fill={color} />
          <path d="M12 9h6a3 3 0 010 6h-6z" fill={color} fillOpacity="0.4" />
          <line x1="12" y1="9" x2="12" y2="15" stroke="#fff" strokeWidth="1.4" />
        </svg>
      );
    case "flame":
      return (
        <svg {...props}>
          <path d="M12 2c-1.2 4-5 5.2-5 10a5 5 0 0010 0c0-2-1-3-1.8-4 .3 2-1 3-1.8 2 .4-2-.6-4.5-1.4-8z" fill={color} />
          <path d="M12 12c.3 1-.5 2-1.3 1.5.2 1.5 1 2.2 1.9 2.2a2 2 0 002-2c0-1.2-.7-1.7-1.2-2.4.1.7-.5 1.1-1.4.7z" fill="#fff" fillOpacity="0.55" />
        </svg>
      );
    case "stethoscope":
      return (
        <svg {...props}>
          <path d="M7 3v5a4 4 0 008 0V3" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="7" cy="3" r="1.4" fill={color} />
          <circle cx="15" cy="3" r="1.4" fill={color} />
          <path d="M15 10v2a4 4 0 004 4" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="19.5" cy="17" r="2.8" fill={color} />
          <circle cx="19.5" cy="17" r="1.1" fill="#fff" fillOpacity="0.7" />
        </svg>
      );
    case "activity":
      return (
        <svg {...props}>
          <path d="M2 13h4l2-7 4 15 3-11 2 3h5" stroke={color} strokeWidth="2.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "alert-triangle":
      return (
        <svg {...props}>
          <path d="M12 3L22 20H2L12 3z" fill={color} />
          <rect x="11" y="9" width="2" height="6" rx="1" fill="#fff" />
          <circle cx="12" cy="17" r="1.3" fill="#fff" />
        </svg>
      );
    case "bar-chart-3":
      return (
        <svg {...props}>
          <rect x="3" y="14" width="4" height="7" rx="1" fill={color} fillOpacity="0.6" />
          <rect x="10" y="9" width="4" height="12" rx="1" fill={color} />
          <rect x="17" y="4" width="4" height="17" rx="1" fill={color} fillOpacity="0.8" />
        </svg>
      );
    case "check-circle-2":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9.5" fill={color} />
          <path d="M7.5 12.5l3 3 6-6.5" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "wind":
      return (
        <svg {...props}>
          <path d="M2 8h11a2.5 2.5 0 10-2.5-2.5" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M2 13h15a2.5 2.5 0 11-2.5 2.5" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M2 18h9a2 2 0 10-2-2" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "zap":
      return (
        <svg {...props}>
          <path d="M13 2L4 14h6l-1.5 8L20 10h-6.5L13 2z" fill={color} />
        </svg>
      );
    case "heart-pulse":
    case "heart-crack":
      return (
        <svg {...props}>
          <path
            d="M12 21s-7.3-4.4-9.6-9.1C1 8.1 2.6 4 6.7 4c2.1 0 3.7 1.3 4.7 2.9C12.4 5.3 14 4 16.1 4c4.1 0 5.7 4.1 4.3 7.9C18.1 16.6 12 21 12 21z"
            fill={color}
          />
          {name === "heart-pulse" ? (
            <path d="M4 12h3.5l1.5-3 2 6 1.5-4 1 1h5.5" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M12 5l-2 6 2.5 2-2 5" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
      );
    case "brain":
      return (
        <svg {...props}>
          <path
            d="M9.5 3c-2.6 0-4.2 1.8-4.2 4 0 .8-.7 1.1-1 1.9-.3.9.3 1.7 1 2.2-.4 1-.2 2 .5 2.7-.3 2.3 1.7 4.2 4.2 4.2h4c2.5 0 4.5-1.9 4.2-4.2.7-.7.9-1.7.5-2.7.7-.5 1.3-1.3 1-2.2-.3-.8-1-1.1-1-1.9 0-2.2-1.7-4-4.2-4-1 0-1.8.3-2.5.8-.7-.5-1.5-.8-2.5-.8z"
            fill={color}
          />
          <path d="M12 4.2v13.6M9 8c1 .6 1 2 0 2.6M15.5 8c-1 .6-1 2 0 2.6" stroke="#fff" strokeWidth="1.3" fill="none" strokeLinecap="round" opacity="0.75" />
        </svg>
      );
    case "thermometer":
      return (
        <svg {...props}>
          <rect x="10" y="2" width="4" height="14" rx="2" fill={color} fillOpacity="0.4" />
          <rect x="11" y="8" width="2" height="8" fill={color} />
          <circle cx="12" cy="18" r="4" fill={color} />
          <circle cx="12" cy="18" r="1.6" fill="#fff" fillOpacity="0.7" />
        </svg>
      );
    case "syringe":
      return (
        <svg {...props} transform="rotate(45 12 12)">
          <rect x="5" y="10" width="4" height="4" fill={color} />
          <rect x="9" y="9" width="9" height="6" rx="1" fill={color} />
          <rect x="9" y="9" width="9" height="2.5" fill="#fff" fillOpacity="0.4" />
          <line x1="18" y1="12" x2="22" y2="12" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
          <line x1="11" y1="9" x2="11" y2="6" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
          <line x1="14" y1="9" x2="14" y2="6" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "microscope":
      return (
        <svg {...props}>
          <rect x="5" y="20" width="14" height="2" rx="1" fill={color} />
          <path d="M12 20v-4M9 20h6" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <path d="M10 16l1-8a3 3 0 016 0" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="17" cy="6" r="2.6" fill={color} />
          <circle cx="17" cy="6" r="1" fill="#fff" fillOpacity="0.7" />
          <line x1="8" y1="12" x2="13" y2="12" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "ear":
      return (
        <svg {...props}>
          <path
            d="M9 4a6.5 6.5 0 016.5 6.5c0 3-1.5 3.7-2 5.5a2.8 2.8 0 01-5.4-1v-1.3"
            stroke={color}
            strokeWidth="2.3"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="10.5" cy="10" r="1.4" fill={color} />
        </svg>
      );
    case "eye":
      return (
        <svg {...props}>
          <path d="M2 12s4-6.5 10-6.5S22 12 22 12s-4 6.5-10 6.5S2 12 2 12z" fill={color} fillOpacity="0.3" />
          <circle cx="12" cy="12" r="4.2" fill={color} />
          <circle cx="10.8" cy="10.8" r="1.2" fill="#fff" fillOpacity="0.8" />
        </svg>
      );
    case "droplet":
      return (
        <svg {...props}>
          <path d="M12 2c4.2 6 7 9.6 7 13.2a7 7 0 01-14 0C5 11.6 7.8 8 12 2z" fill={color} />
          <ellipse cx="9.8" cy="13" rx="1.4" ry="2.2" fill="#fff" fillOpacity="0.5" />
        </svg>
      );
    case "clock":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9.5" fill="none" stroke={color} strokeWidth="2.2" />
          <line x1="12" y1="12" x2="12" y2="7" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <line x1="12" y1="12" x2="15.5" y2="14" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="12" r="1.2" fill={color} />
        </svg>
      );
    case "skull":
      return (
        <svg {...props}>
          <path
            d="M12 3a7 7 0 00-7 7c0 2.2.9 3.3 1.6 4.2l-.4 2.8h11.6l-.4-2.8c.7-.9 1.6-2 1.6-4.2a7 7 0 00-7-7z"
            fill={color}
          />
          <circle cx="9.3" cy="10.5" r="1.6" fill="#fff" />
          <circle cx="14.7" cy="10.5" r="1.6" fill="#fff" />
          <path d="M11 13.5l1 2 1-2z" fill="#fff" fillOpacity="0.8" />
        </svg>
      );
    case "waves":
      return (
        <svg {...props}>
          <path d="M2 8c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M2 13c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.7" />
          <path d="M2 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.45" />
        </svg>
      );
    case "baby":
      return (
        <svg {...props}>
          <circle cx="12" cy="8" r="5" fill={color} />
          <path d="M5 22c0-5 3-8.5 7-8.5S19 17 19 22z" fill={color} fillOpacity="0.5" />
          <path d="M9 6.5c1 1 4 1 5 0" stroke="#fff" strokeWidth="1.3" fill="none" strokeLinecap="round" />
          <path d="M10.5 3.5c.5-1 2.5-1 3 0" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "bone":
      return (
        <svg {...props} transform="rotate(45 12 12)">
          <circle cx="5" cy="8" r="2.6" fill={color} />
          <circle cx="5" cy="16" r="2.6" fill={color} />
          <circle cx="19" cy="8" r="2.6" fill={color} />
          <circle cx="19" cy="16" r="2.6" fill={color} />
          <rect x="5" y="9.5" width="14" height="5" rx="2.5" fill={color} />
        </svg>
      );
    case "test-tube":
      return (
        <svg {...props}>
          <path d="M8 2v13a4 4 0 008 0V2" stroke={color} strokeWidth="2" fill="none" />
          <path d="M8 12h8v3a4 4 0 01-8 0z" fill={color} />
          <circle cx="10.5" cy="14.5" r="0.8" fill="#fff" fillOpacity="0.7" />
          <circle cx="13" cy="16" r="0.6" fill="#fff" fillOpacity="0.7" />
        </svg>
      );
    case "siren":
      return (
        <svg {...props}>
          <path d="M12 3a5.5 5.5 0 015.5 5.5V13h-11V8.5A5.5 5.5 0 0112 3z" fill={color} />
          <rect x="4.5" y="13" width="15" height="3" rx="1" fill={color} fillOpacity="0.6" />
          <rect x="7" y="18" width="10" height="2" rx="1" fill={color} />
          <line x1="12" y1="1" x2="12" y2="3" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
          <line x1="6" y1="4" x2="7.3" y2="5.3" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
          <line x1="18" y1="4" x2="16.7" y2="5.3" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "scan-line":
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke={color} strokeWidth="2" />
          <line x1="3" y1="12" x2="21" y2="12" stroke={color} strokeWidth="2" />
          <path d="M3 4h4M17 4h4M3 20h4M17 20h4" stroke={color} strokeWidth="2" opacity="0.5" />
        </svg>
      );
    case "hourglass":
      return (
        <svg {...props}>
          <path
            d="M6 3h12M6 21h12M7 3c0 5 4 6 5 8-1 2-5 3-5 8M17 3c0 5-4 6-5 8 1 2 5 3 5 8"
            stroke={color}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="17" r="1" fill={color} />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9.5" fill={color} fillOpacity="0.25" />
          <path d="M12 6v12M6 12h12" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );
  }
}
