/**
 * Bildschirmgrösse und sichere Ränder – die einzige Stelle, die das misst.
 *
 * Warum so umständlich: Als Home-Bildschirm-App auf dem iPhone (Statusleiste
 * "black-translucent") beginnt die Seite UNTER der Statusleiste, aber
 * window.innerHeight, 100vh/100dvh und damit auch "position: fixed; inset: 0"
 * sind um die Höhe der Statusleiste zu klein. Folge: oben abgeschnitten, unten
 * ein schwarzer Balken. Dort nehmen wir deshalb die echte Bildschirmgrösse
 * (screen.width/height) und lesen die Ränder (Statusleiste, Dynamic Island,
 * Home-Balken) als Zahlen aus env(safe-area-inset-*).
 */

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface AppViewport {
  width: number;
  height: number;
  insets: Insets;
}

/** iOS-Home-Bildschirm-App (nur Safari/iOS kennt navigator.standalone). */
export function isIosStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

let probe: HTMLElement | null = null;

/** Liest env(safe-area-inset-*) über das Padding eines unsichtbaren Elements. */
function readInsets(): Insets {
  if (!probe) {
    probe = document.createElement('div');
    probe.id = 'safe-area-probe';
    probe.setAttribute('aria-hidden', 'true');
    Object.assign(probe.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '0',
      height: '0',
      visibility: 'hidden',
      pointerEvents: 'none',
      paddingTop: 'env(safe-area-inset-top, 0px)',
      paddingRight: 'env(safe-area-inset-right, 0px)',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      paddingLeft: 'env(safe-area-inset-left, 0px)',
    });
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  const px = (v: string) => parseFloat(v) || 0;
  return { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
}

export function measureViewport(): AppViewport {
  let width = window.innerWidth;
  let height = window.innerHeight;
  if (isIosStandalone() && screen.width > 0 && screen.height > 0) {
    // Die App füllt den ganzen Bildschirm. screen.* ist auf iOS immer hochkant angegeben.
    const short = Math.min(screen.width, screen.height);
    const long = Math.max(screen.width, screen.height);
    const portrait = window.innerHeight >= window.innerWidth;
    width = portrait ? short : long;
    height = portrait ? long : short;
  }
  return { width, height, insets: readInsets() };
}

/** Freier Bereich ohne Statusleiste, Notch und Home-Balken. */
export function safeBox(v: AppViewport): { left: number; top: number; width: number; height: number } {
  const { insets: i } = v;
  return {
    left: i.left,
    top: i.top,
    width: Math.max(1, v.width - i.left - i.right),
    height: Math.max(1, v.height - i.top - i.bottom),
  };
}

type Listener = () => void;

/** Ruft `onChange` bei Grössenänderung/Drehung auf (iOS liefert die Ränder teils einen Frame später). */
export function subscribeViewport(onChange: Listener): () => void {
  let raf = 0;
  const handler = () => {
    onChange();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(onChange);
  };
  window.addEventListener('resize', handler);
  window.addEventListener('orientationchange', handler);
  window.visualViewport?.addEventListener('resize', handler);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', handler);
    window.removeEventListener('orientationchange', handler);
    window.visualViewport?.removeEventListener('resize', handler);
  };
}

/**
 * Setzt --app-w/--app-h (echte Bildschirmgrösse) und --safe-* auf <html>, damit
 * Vollbild-Flächen (Lernsitzung, Dialoge) per CSS genau den Schirm füllen.
 */
export function installViewportVars(): void {
  const apply = () => {
    const v = measureViewport();
    const s = document.documentElement.style;
    s.setProperty('--app-w', `${v.width}px`);
    s.setProperty('--app-h', `${v.height}px`);
    s.setProperty('--safe-top', `${v.insets.top}px`);
    s.setProperty('--safe-right', `${v.insets.right}px`);
    s.setProperty('--safe-bottom', `${v.insets.bottom}px`);
    s.setProperty('--safe-left', `${v.insets.left}px`);
  };
  apply();
  subscribeViewport(apply);
}
