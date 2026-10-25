import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { LoadingBlock } from './components';
import { I18nProvider } from './i18n';
import { Shell } from './shell/Shell';
import { SettingsProvider, SyncProvider, ToastProvider, useSettings } from './state';
import { Home } from './pages/Home';
import { SetsPage } from './pages/Sets';
import { NewSetPage } from './pages/NewSet';
import { SetDetail } from './pages/SetDetail';
import { NotFound } from './pages/NotFound';

// Seltener gebrauchte oder grosse Seiten erst bei Bedarf laden.
const EditorPage = lazy(() => import('./pages/Editor').then((m) => ({ default: m.EditorPage })));
const ImportPage = lazy(() => import('./pages/Import').then((m) => ({ default: m.ImportPage })));
const StudySetup = lazy(() => import('./pages/StudySetup').then((m) => ({ default: m.StudySetup })));
const SessionPage = lazy(() => import('./study/SessionPage').then((m) => ({ default: m.SessionPage })));
const ReviewPage = lazy(() => import('./pages/Review').then((m) => ({ default: m.ReviewPage })));
const StatsPage = lazy(() => import('./pages/Stats').then((m) => ({ default: m.StatsPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));
const HelpSrs = lazy(() => import('./pages/HelpSrs').then((m) => ({ default: m.HelpSrs })));

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingBlock />}>{children}</Suspense>;
}

function WithLanguage({ children }: { children: ReactNode }) {
  const { settings, loaded } = useSettings();
  if (!loaded) return null;
  return <I18nProvider lang={settings.uiLang}>{children}</I18nProvider>;
}

export function App() {
  return (
    <SettingsProvider>
      <WithLanguage>
        <ToastProvider>
          <SyncProvider>
            <BrowserRouter>
              <Routes>
                <Route
                  path="/session/:sessionId"
                  element={
                    <Lazy>
                      <SessionPage />
                    </Lazy>
                  }
                />
                <Route element={<Shell />}>
                  <Route index element={<Home />} />
                  <Route path="sets" element={<SetsPage />} />
                  <Route path="sets/new" element={<NewSetPage />} />
                  <Route path="sets/:setId" element={<SetDetail />} />
                  <Route path="sets/:setId/edit" element={<Lazy><EditorPage /></Lazy>} />
                  <Route path="import" element={<Lazy><ImportPage /></Lazy>} />
                  <Route path="study/:scope/:mode" element={<Lazy><StudySetup /></Lazy>} />
                  <Route path="review" element={<Lazy><ReviewPage /></Lazy>} />
                  <Route path="stats" element={<Lazy><StatsPage /></Lazy>} />
                  <Route path="settings" element={<Lazy><SettingsPage /></Lazy>} />
                  <Route path="help/srs" element={<Lazy><HelpSrs /></Lazy>} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </SyncProvider>
        </ToastProvider>
      </WithLanguage>
    </SettingsProvider>
  );
}
