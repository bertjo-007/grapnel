// Hilfen für die Browser-Tests mit dem System-Edge (Muster aus Aurum).
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

export const BASE = process.env.GRAPNEL_URL ?? 'http://127.0.0.1:5175';
export const OUT = 'e2e/out';
mkdirSync(OUT, { recursive: true });

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

export async function launch() {
  return puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    userDataDir: mkdtempSync(join(tmpdir(), 'grapnel-e2e-')),
    args: ['--no-first-run', '--disable-features=Translate', '--lang=de-CH'],
  });
}

export function watch(page, errors) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
}

export async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
}

export async function fullShot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

export async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Klickt den ersten sichtbaren Knopf oder Link, dessen Text den Suchtext enthält. */
export async function clickText(page, text, selector = 'button, a') {
  const ok = await page.evaluate(
    (text, selector) => {
      const els = Array.from(document.querySelectorAll(selector));
      const el = els.find((e) => e.textContent?.includes(text) && e.offsetParent !== null && !e.disabled);
      if (!el) return false;
      el.click();
      return true;
    },
    text,
    selector,
  );
  if (!ok) throw new Error(`Nicht gefunden: ${text}`);
}

export async function textOf(page, selector) {
  return page.$eval(selector, (e) => e.textContent ?? '');
}
