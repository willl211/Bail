# Contexte du projet — Plateforme de location longue durée (MVP v0, pilote Metz)

Ce fichier est le point d'entrée. Lis-le en premier, avant tout autre document du dossier `docs/`. Si tu perds le fil pendant le développement, reviens ici.

## Ce que le projet est

Une plateforme qui digitalise la location longue durée résidentielle, sur le modèle d'Airbnb mais pour des baux d'habitation classiques (pas de la courte durée). Deux profils d'utilisateurs :

- **Propriétaires** : mettent leur bien en location en payant un abonnement à la plateforme, plutôt que de passer par une agence traditionnelle.
- **Locataires** : cherchent un bien, déposent un dossier numérique (identité, revenus, garant), candidatent, visitent, signent le bail et paient des honoraires (moins chers qu'une agence classique).

Marché de lancement : **Metz**, centre-ville et quartiers proches.

## Ce que tu dois construire maintenant (MVP v0)

Un parcours complet mais avec des **visites accompagnées ou en visio** — pas de boîtier connecté ni de visite 100% autonome. Cette partie matérielle (IoT, boîtier à clé) est explicitement **hors périmètre**, prévue pour une version v1 ultérieure. Ne la développe pas, n'y consacre pas de temps, même si le brief produit d'origine en parle.

Voir `docs/product-brief.md` pour le détail du périmètre fonctionnel et `docs/build-order.md` pour l'ordre dans lequel construire les écrans.

## Documents à consulter

| Fichier | Contenu |
|---|---|
| `docs/product-brief.md` | Vision produit complète, ce qui est dans le MVP v0 vs repoussé à v1 |
| `docs/tech-stack.md` | Stack technique et outils validés |
| `docs/data-model.md` | Entités principales et leurs relations |
| `docs/build-order.md` | Ordre de construction des écrans, à respecter |
| `docs/integrations.md` | Prestataires tiers et comment les intégrer (souvent en mode sandbox) |
| `docs/design-system.md` | Direction visuelle et principes de design |
| `docs/market-context.md` | Contexte marché Metz (cibles, volumes, profils) |
| `docs/legal-context.md` | Ce qui est légalement contraint, et ce qui peut avancer sans attendre le juridique |
| `docs/team-and-status.md` | Qui fait quoi, état d'avancement au moment du transfert |

## Règles à ne jamais casser

1. **Pas de visite autonome par boîtier connecté dans le MVP v0.** C'est un point tranché, pas une option à réévaluer.
2. **Le bail est généré à partir d'un modèle légal verrouillé.** Pas de rédaction libre par l'IA — elle vérifie la cohérence des champs, elle n'invente pas de clauses. Voir `docs/legal-context.md`.
3. **Web responsive uniquement.** Pas d'app mobile native pour le MVP — décision réexaminée et confirmée en cours de route.
4. **Respecte le design importé depuis Claude Design** pour tous les écrans — couleurs, typographie, composants. Si un écran n'a pas encore de maquette, garde-toi cohérent avec les principes de `docs/design-system.md` plutôt que d'improviser un style générique.
5. **Les intégrations tierces réglementées (KYC, signature, paiement) tournent en mode sandbox/test pendant tout le développement.** Elles ne bloquent pas l'avancement — voir `docs/integrations.md`.

## Si tu es perdu

Relis `docs/product-brief.md` pour te resituer sur la vision globale, puis `docs/build-order.md` pour savoir où tu en es censé être. Ne réintroduis pas de fonctionnalités hors périmètre (visite autonome, app native, rédaction de bail libre) même si elles semblent logiques dans l'absolu — elles ont été délibérément écartées du MVP v0.
