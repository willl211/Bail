export interface AccountIntent {
  candidature?: string;
  bien?: string;
}

/** Les destinations sont construites ici, jamais acceptées comme URL libre. */
export function accountDestination(role: string, intent: AccountIntent = {}) {
  if (role === 'OWNER') return '/proprietaires/biens';
  if (role === 'AGENT') return '/back-office';
  if (intent.candidature) return `/biens/${encodeURIComponent(intent.candidature)}/candidater`;
  if (intent.bien) return `/biens/${encodeURIComponent(intent.bien)}?sauvegarder=1`;
  return '/dossier';
}

export function accountEntry(path: '/connexion' | '/dossier', intent: AccountIntent = {}) {
  const params = new URLSearchParams();
  if (typeof intent.candidature === 'string' && intent.candidature)
    params.set('candidature', intent.candidature);
  else if (typeof intent.bien === 'string' && intent.bien) params.set('bien', intent.bien);
  return `${path}${params.size ? `?${params}` : ''}`;
}
