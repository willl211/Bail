# Aide IA à la lecture des bulletins — 10 septembre 2026

La première version lit uniquement les nouveaux documents `PAYSLIP`. L’agent retrouve
l’aide dans le back-office, dans le contrôle de la pièce sélectionnée. Le résultat
présente salarié, employeur, période, net avant impôt, net payé et net imposable mensuel,
avec une page et un court passage justificatif pour chaque valeur lue. Les valeurs
incertaines restent absentes. L’agent doit comparer ces propositions à l’original.

Les comparaisons avec l’identité, l’employeur et le revenu déclarés sont déterministes
et recalculées sur le dossier courant. La comparaison de revenu utilise seulement le
net avant impôt pour un mois civil complet ; elle ne remplace pas une analyse de revenus
sur plusieurs mois. Une période ancienne, future ou présente sur un autre bulletin est
signalée. Un écart n’est ni une preuve de fraude ni un motif automatique de refus.

## Comportement et activation

Par défaut `DOCUMENT_ANALYSIS_DRIVER=disabled` : aucun appel externe, aucune fausse
lecture. Les nouveaux bulletins restent `PENDING` jusqu’au contrôle humain. Les autres
types de pièces gardent leur circuit KYC existant, encore simulé. Les anciens bulletins
ne sont pas retraités automatiquement et leurs décisions existantes restent inchangées.
Un agent peut demander leur analyse depuis le panneau si un fichier est présent.

Le connecteur réel est écrit mais n’a pas été éprouvé avec un compte OpenAI ni des
bulletins réels. Les tests utilisent des PDF fictifs et un fournisseur simulé.

Pour un essai contrôlé sur des pièces fictives, dans l’environnement **backend** :

```dotenv
DOCUMENT_ANALYSIS_DRIVER=openai
DOCUMENT_ANALYSIS_MODEL=<identifiant du modèle choisi>
DOCUMENT_ANALYSIS_WORKER_ENABLED=true
OPENAI_API_KEY=<clé serveur du projet de test>
```

Choisir un modèle compatible avec les fichiers PDF/images et les sorties structurées
de l’API Responses. La clé n’est jamais une variable `NEXT_PUBLIC_*`. Le serveur refuse
de démarrer avec un driver inconnu ou avec `openai` sans clé/modèle. Appliquer les
migrations (`npm.cmd run prisma:deploy --workspace backend`), générer le client Prisma
si nécessaire, puis redémarrer l’API après configuration. Ne pas réinitialiser la base.
Le worker démarre toutes les 15 secondes et prend un travail à la fois par instance.
`DOCUMENT_ANALYSIS_WORKER_ENABLED=false` suspend les nouveaux traitements automatiques,
sans annuler un appel déjà parti. Revenir à `disabled` coupe les nouveaux appels ; les
résultats déjà obtenus restent consultables par les agents.

## Fiabilité du traitement

- Le dépôt et la mise en file PostgreSQL sont dans la même transaction ; le dépôt
  n’attend pas le modèle. La file survit à un redémarrage.
- Un verrou temporaire de trois minutes, une génération et un jeton d’exécution
  empêchent un ancien worker de remplacer le résultat du worker qui a repris son travail.
- Taille maximale de 8 Mio, PDF lisible de 1 à 10 pages ou image PNG/JPEG/WebP ; les PDF
  invalides/chiffrés sont refusés avant transmission. Les signatures de format image
  sont contrôlées, leur lisibilité est déterminée par le fournisseur.
- Appel fournisseur limité à 60 secondes ; au maximum trois tentatives pour les pannes
  transitoires, avec délai croissant. Sortie invalide ou refus : reprise manuelle.
- Plafonds persistants : 10 tentatives fournisseur par locataire et 50 pour la plateforme
  sur une fenêtre de 24 h. Ce sont des limites d’appels, pas un plafond financier garanti.
  Les fenêtres commencent à la première tentative. Une limite atteinte reporte le travail.
- Relance admin : délai minimal de 60 secondes et 30 demandes par agent par heure.
  Les demandes simultanées d’une même analyse en cours ne créent pas de doublon.
- Le résultat appartient à la pièce et sa source immutable, avec empreinte SHA-256,
  modèle, version du prompt et dates. Le retrait supprime l’analyse en cascade ; un
  retour tardif est ignoré. Le remplacement ne récupère jamais l’analyse de l’ancien fichier.
- Aucune écriture du worker sur les statuts du document/dossier, ni sur les revenus.
  La décision admin reste possible pendant l’analyse et ne peut pas être écrasée.

## Accès et données

`GET /api/v1/admin/documents/:id/analysis?revision=N` et
`POST /api/v1/admin/documents/:id/analysis` (`expectedRevision`) exigent une session
`AGENT` et la révision courante d’un dossier transmis. Réponses `private, no-store`.
Ni locataire ni propriétaire ne peuvent lire ces extractions par cette API.

Le fournisseur reçoit le fichier privé en base64, un nom générique et les instructions
de lecture. Il ne reçoit pas en plus le profil déclaré, une URL signée ou des outils
permettant d’agir. Les instructions éventuellement présentes dans le document sont
traitées comme non fiables. La réponse suit un JSON Schema strict puis une validation
locale des clés, types, dates, montants et références de page. Cela limite les sorties
inexploitables, mais ne garantit pas l’exactitude des valeurs ou des citations produites.
Les textes sont affichés comme du texte, sans exécuter de HTML provenant du modèle.

Les extraits et valeurs sont conservés dans la base privée, avec la pièce, et supprimés
avec elle ; ils ne sont pas inclus dans les journaux applicatifs. Le prompt demande
de ne pas extraire numéro de sécurité sociale, IBAN ou adresse, mais **le fichier complet
est transmis au fournisseur**. `store:false` désactive le stockage de la réponse comme
état applicatif OpenAI ; cela ne garantit pas une rétention nulle, notamment pour les
journaux de surveillance des abus. Avant utilisation avec des pièces réelles, définir
les conditions de traitement, l’information des utilisateurs et les durées de conservation.

Références officielles : [fichiers PDF](https://developers.openai.com/api/docs/guides/file-inputs),
[sorties structurées](https://developers.openai.com/api/docs/guides/structured-outputs),
[gestion des données](https://developers.openai.com/api/docs/guides/your-data).

## Validation et prochaine étape

Tests unitaires : contrat HTTP OpenAI simulé, refus/pannes, PDF invalides/trop longs,
sorties structurées invalides et calcul des écarts. Tests d’intégration : dépôt,
droits, concurrence, retrait/remplacement, décision humaine pendant analyse, reprise,
quotas et retour obsolète. Tests frontend : état désactivé, résultats lisibles, preuve
citée, relance explicite et annulation d’une lecture devenue obsolète.

Contrôle visuel local effectué sur le panneau désactivé et sur un résultat fictif,
en largeurs 1440, 1000, 390 et 320 pixels : aucun débordement horizontal ni erreur
JavaScript observés. L’aperçu fictif est limité à la session de test du navigateur ;
il n’a enregistré aucun résultat d’analyse dans les dossiers de démonstration.

La précision réelle reste à mesurer sur un jeu de bulletins fictifs représentatifs
(formats variés, scans flous, primes, absences, montants manquants et instructions
parasites). L’extension aux autres justificatifs et toute automatisation des décisions
ne font pas partie de cette première version.
