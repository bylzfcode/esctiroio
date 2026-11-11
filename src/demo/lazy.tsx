// Pontos de entrada da interface EXCLUSIVA da demonstração.
// `__DEMO_BUILD__` é constante de build: fora do modo demo, estes `lazy(import(...))` desaparecem do pacote
// (nem o código nem os textos da demonstração são enviados ao navegador em produção).
import { lazy, type ComponentType } from 'react';

const none = (): null => null;

export const DemoBanner: ComponentType<{ onSwitchProfile: () => void }> = __DEMO_BUILD__
  ? lazy(() => import('./DemoBanner').then((m) => ({ default: m.DemoBanner })))
  : none;

export const DemoProfileModal: ComponentType<{
  open: boolean;
  currentId: string | null;
  onSelect: (personId: string) => void;
  onClose: () => void;
}> = __DEMO_BUILD__ ? lazy(() => import('./DemoProfileModal').then((m) => ({ default: m.DemoProfileModal }))) : none;

export const DemoEntryPage: ComponentType = __DEMO_BUILD__ ? lazy(() => import('./DemoEntryPage')) : none;

export const DemoTools: ComponentType = __DEMO_BUILD__ ? lazy(() => import('./DemoTools').then((m) => ({ default: m.DemoTools }))) : none;
