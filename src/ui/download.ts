/**
 * Datei an den Benutzer übergeben. Auf dem iPhone ist das Teilen-Menü der verlässliche
 * Weg (dort lässt sich «In Dateien sichern» wählen); sonst ein normaler Download.
 */
export async function saveFile(content: string | ArrayBuffer, fileName: string, mime: string): Promise<void> {
  const blob = new Blob([content], { type: mime });
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIos && typeof navigator.share === 'function') {
    const file = new File([blob], fileName, { type: mime });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: fileName });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
