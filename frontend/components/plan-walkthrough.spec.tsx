import { act, fireEvent, render, screen } from '@testing-library/react';
import { PlanWalkthrough } from './plan-walkthrough';

class ObserverDouble {
  static instances: ObserverDouble[] = [];
  targets: Element[] = [];
  disconnect = jest.fn();
  observe = jest.fn((target: Element) => { this.targets.push(target); });
  unobserve = jest.fn();
  takeRecords = () => [];

  constructor(private callback: IntersectionObserverCallback) {
    ObserverDouble.instances.push(this);
  }

  notify() {
    this.callback([], this as unknown as IntersectionObserver);
  }
}

class ResizeDouble {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}

type QueryDouble = {
  matches: boolean;
  media: string;
  listeners: Set<() => void>;
  addEventListener: (_event: string, listener: () => void) => void;
  removeEventListener: (_event: string, listener: () => void) => void;
};

let queries: Map<string, QueryDouble>;
let supports: jest.Mock;

function changeQuery(query: string, matches: boolean) {
  const entry = queries.get(query)!;
  act(() => {
    entry.matches = matches;
    entry.listeners.forEach((listener) => listener());
  });
}

beforeEach(() => {
  queries = new Map();
  supports = jest.fn(() => true);
  ObserverDouble.instances = [];
  Object.defineProperty(window, 'CSS', { configurable: true, value: { supports } });
  Object.defineProperty(window, 'IntersectionObserver', {
    configurable: true, value: ObserverDouble,
  });
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true, value: ResizeDouble,
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn((media: string) => {
      if (!queries.has(media)) {
        const listeners = new Set<() => void>();
        queries.set(media, {
          matches: false,
          media,
          listeners,
          addEventListener: (_event, listener) => { listeners.add(listener); },
          removeEventListener: (_event, listener) => { listeners.delete(listener); },
        });
      }
      return queries.get(media);
    }),
  });
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: jest.fn() });
  jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('house-walkthrough__runway')) return 3000;
    if (this.classList.contains('house-walkthrough__stage')) return 700;
    return 0;
  });
});

afterEach(() => { jest.restoreAllMocks(); });

describe('PlanWalkthrough', () => {
  it('rend tout le parcours sans animation lorsque le navigateur ne la supporte pas', () => {
    supports.mockReturnValue(false);
    render(<PlanWalkthrough />);

    expect(screen.getAllByRole('article')).toHaveLength(6);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('link', { name: /découvrir les logements/i })).toHaveAttribute('href', '/recherche');
    expect(screen.getAllByRole('link', { name: /accéder à mon dossier/i })).toHaveLength(5);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it.each([
    '(max-width: 760px)',
    '(max-height: 650px)',
    '(prefers-reduced-motion: reduce)',
  ])('suit la préférence %s sans rechargement et nettoie ses écouteurs', (query) => {
    const { unmount } = render(<PlanWalkthrough />);
    expect(screen.getAllByRole('button')).toHaveLength(6);

    changeQuery(query, true);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getAllByRole('article')).toHaveLength(6);

    changeQuery(query, false);
    expect(screen.getAllByRole('button')).toHaveLength(6);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    unmount();
    expect([...queries.values()].every((entry) => entry.listeners.size === 0)).toBe(true);
  });

  it('change uniquement la fiche active au passage des étapes sans laisser de liens invisibles', () => {
    const { container } = render(<PlanWalkthrough />);
    const runway = container.querySelector('.house-walkthrough__runway')!;
    jest.spyOn(runway, 'getBoundingClientRect').mockReturnValue({ top: -1380 } as DOMRect);
    const observer = ObserverDouble.instances.find((entry) =>
      entry.targets.some((target) => target.classList.contains('house-walkthrough__marker')),
    )!;

    act(() => observer.notify());

    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Projetez-vous dans les lieux.' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Trouvez votre prochain chez-vous.' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /04 visite/i })).toHaveAttribute('aria-current', 'step');
    expect(screen.getAllByRole('link', { name: /accéder à mon dossier/i })).toHaveLength(1);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('défile vers une étape seulement lorsque son bouton est actionné', () => {
    const { container } = render(<PlanWalkthrough />);
    const runway = container.querySelector('.house-walkthrough__runway')!;
    const stage = container.querySelector<HTMLElement>('.house-walkthrough__stage')!;
    stage.style.top = '78px';
    jest.spyOn(runway, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);

    fireEvent.click(screen.getByRole('button', { name: /04 visite/i }));

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 1402, behavior: 'smooth' });
  });

  it('conserve la description et tous les accès si le visuel ne charge pas', () => {
    render(<PlanWalkthrough />);
    fireEvent.error(screen.getByRole('img', { name: /maison contemporaine fictive/i }));

    expect(screen.getByRole('img', { name: /maison contemporaine fictive/i })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(6);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getAllByRole('link', { name: /accéder à mon dossier/i })).toHaveLength(5);
  });
});
