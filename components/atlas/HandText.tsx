import styles from "./atlas-zoom.module.css";

/** Kalam draws œ / Œ very wide ("Cœ ur"): tighten them, as the atlases themselves do. */
export function HandText({ text }: { text: string }) {
  const parts = text.split(/(œ|Œ)/);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) =>
        part === "œ" || part === "Œ" ? (
          <span key={index} className={styles.lig}>
            {part}
          </span>
        ) : (
          part
        )
      )}
    </>
  );
}
