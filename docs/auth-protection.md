# Protection des connexions — 9 septembre 2026

Le point 7 de l'audit est corrigé par des quotas serveur sur les routes
d'authentification. Le contrôle précède la validation du formulaire et bcrypt.
Il couvre les locataires, propriétaires et agents internes, sans exception pour
les comptes de démonstration.

## Limites

Les limites se cumulent. Les fenêtres commencent à la première tentative ; elles
comptent les demandes réussies, échouées et invalides. Une demande rejetée ne
prolonge pas la fenêtre. Il n'y a pas de verrouillage permanent du compte.

| Périmètre | Maximum | Fenêtre |
| --- | ---: | --- |
| Ensemble des écritures d'authentification, par IP | 20 | 1 minute |
| Ensemble des écritures d'authentification, par IP | 100 | 15 minutes |
| Connexion, par IP | 50 | 15 minutes |
| Connexion, par adresse e-mail normalisée | 10 | 15 minutes |
| Inscription, par IP | 5 | 1 heure |
| Autres opérations, par catégorie et par IP | 20 | 15 minutes |
| Mot de passe oublié, par adresse e-mail | 3 | 15 minutes |
| Renvoi de confirmation, par utilisateur connecté | 3 | 15 minutes |
| Changement de mot de passe ou d'adresse e-mail, quota partagé par utilisateur | 5 | 15 minutes |

Les confirmations par jeton et la réinitialisation partagent la catégorie
`token`. La déconnexion et la lecture du profil ne consomment aucun quota.
La recherche et les annonces publiques ne passent pas par ce guard.

Le refus renvoie HTTP 429, `code: AUTH_RATE_LIMITED`, `retryAfterSeconds` et
l'en-tête `Retry-After`. Le message français contient le délai, que les
formulaires existants affichent déjà. Il ne faut pas automatiquement rejouer
une requête de connexion refusée. Les réponses d'authentification portent
`Cache-Control: no-store`.

## Stockage et concurrence

La migration additive `20260909030000_auth_rate_limits` crée une table dédiée,
sans toucher aux utilisateurs, mots de passe ni sessions existantes. La clé
est l'empreinte SHA-256 du périmètre et de l'adresse/utilisateur : aucune adresse
e-mail ou IP n'est enregistrée en clair dans cette table. Ces empreintes restent
des données pseudonymisées, pas anonymes.

Un UPSERT PostgreSQL réserve chaque tentative atomiquement avant l'appel au
service de connexion. Toutes les instances de l'API partagent les compteurs ;
un redémarrage ne les efface pas. Les quotas IP sont consommés en premier pour
borner la création de compteurs d'adresses e-mail inventées par une même origine.
Une panne du stockage renvoie 503 et n'autorise pas la connexion.

La purge horaire supprime au maximum 10 000 compteurs expirés depuis plus d'une
heure par exécution. Les traces de blocage ne portent ni mot de passe, ni jeton,
ni adresse ; elles sont limitées à une par minute et par politique/processus.
Un suivi HTTP des 429 reste utile pour mesurer le volume des attaques.

## Adresse du client et proxy

`TRUSTED_PROXY_CIDRS` est vide par défaut : un client joignant directement l'API
ne peut pas changer son quota en inventant `X-Forwarded-For`. Les IPv4 mappées
en IPv6 sont normalisées ; les adresses IPv6 sont regroupées par sous-réseau /64.

Avec Caddy, déclarer uniquement l'adresse ou le sous-réseau réel du proxy dans
`TRUSTED_PROXY_CIDRS`. Les exemples staging/production proposent la plage privée
Docker `172.16.0.0/12`, à réduire au sous-réseau réellement utilisé. L'API doit
rester inaccessible directement depuis Internet, comme dans le compose livré.
Caddy remplace `X-Forwarded-For` par l'adresse de son client direct. L'ajout d'un
CDN ou d'un autre proxy exige d'adapter cette chaîne explicitement.

En recette HTTP avec ports directs, conserver `TRUSTED_PROXY_CIDRS=`. Une
configuration vide derrière un proxy regroupe tous ses visiteurs dans le même
quota IP : la protection reste active mais peut bloquer des visiteurs légitimes.

Les écritures d'authentification provenant d'un navigateur doivent avoir une
origine présente dans `CORS_ORIGINS`. Une origine étrangère, `null`, ou un
`Sec-Fetch-Site: cross-site` sans origine sont refusés. Les appels serveur/CLI
sans ces en-têtes restent possibles. Ce contrôle porte sur l'authentification,
pas sur l'ensemble des écritures métier ni sur les webhooks.

## Vérifications et limites

`backend/test/auth-protection.int-spec.ts` vérifie les limites par compte/IP,
les requêtes concurrentes, la reprise après expiration, la persistance entre
instances, les en-têtes forgés, les comptes internes, la récupération, les
changements sensibles, la panne du stockage, la purge et la déconnexion.

Les quotas s'appliquent aussi aux adresses inconnues et la connexion renvoie
la même erreur pour un mot de passe incorrect ou un compte désactivé. Un cookie
JSON inattendu n'entraîne plus d'erreur serveur.

Cette protection ne constitue pas une protection DDoS réseau et n'ajoute pas de
double authentification. L'accès interne pourra être renforcé par une MFA avec
un parcours d'enrôlement et de récupération dédié. Les limites par compte
peuvent temporairement gêner un utilisateur ciblé ; elles expirent et la
récupération de mot de passe dispose d'un quota distinct.

Références : [OWASP — Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html),
[Express — Behind proxies](https://expressjs.com/en/guide/behind-proxies/).
