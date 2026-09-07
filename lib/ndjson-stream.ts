/**
 * Reads a newline-delimited-JSON HTTP response line by line, invoking
 * `onLine` as soon as each line arrives — not after the whole body is
 * buffered. This is what lets the "Cas Clinique" and "QCM" Live components
 * render each sub-unit the moment its own generation finishes, while
 * siblings are still pending. See app/api/courses/[id]/generate-stream/route.ts
 * for the producer side.
 */
export async function readNdjsonStream(response: Response, onLine: (line: unknown) => void): Promise<void> {
  if (!response.body) {
    throw new Error("La réponse ne contient pas de flux exploitable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.trim()) onLine(JSON.parse(line));
    }
  }

  if (buffer.trim()) onLine(JSON.parse(buffer));
}
