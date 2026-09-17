import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SiteNavigation } from './site-navigation';

it('ouvre la navigation et la referme avec Échap en restaurant le focus', async () => {
  const user = userEvent.setup();
  render(<SiteNavigation><a href="/dossier">Mon dossier</a></SiteNavigation>);
  const toggle = screen.getByRole('button', { name: 'Menu' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await user.tab();
  expect(screen.getByRole('link')).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(toggle).toHaveFocus();
});

it('ferme le menu à la sélection d’un lien et à la sortie au clavier', async () => {
  const user = userEvent.setup();
  render(<><SiteNavigation><a href="#dossier">Mon dossier</a></SiteNavigation><button>Suite</button></>);
  const toggle = screen.getByRole('button', { name: 'Menu' });
  await user.click(toggle);
  fireEvent.click(screen.getByRole('link'));
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await user.click(toggle);
  await user.tab();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Suite' })).toHaveFocus();
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
