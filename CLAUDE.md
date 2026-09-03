# Contexte du projet — Bail, plateforme de location longue durée (MVP v0, pilote Metz)

Ce fichier est le point d'entrée. Lis-le en premier, avant tout autre document du dossier `docs/`. Si tu perds le fil pendant le développement, reviens ici.

## Ce que le projet est

**Bail** est une plateforme qui digitalise la location longue durée résidentielle, sur le modèle d'Airbnb mais pour des baux d'habitation classiques (pas de la courte durée). Trois profils d'utilisateurs :

- **Propriétaires** : mettent leur bien en location en payant un abonnement à la plateforme, plutôt que de passer par une agence traditionnelle.
- **Locataires** : cherchent un bien, déposent un dossier numérique (identité, revenus, garant), candidatent, visitent, signent le bail et paient des honoraires (moins chers qu'une agence classique).
- **Admin (agent interne)** : vérifie les dossiers, contrôle les biens mis en location, et suit tout ce qui se passe sur la plateforme depuis le back-office.

Marché de lancement : **Metz**, centre-ville et quartiers proches.

## Ce que tu dois construire maintenant (MVP v0)

Un parcours complet mais avec des **visites accompagnées ou en visio** — pas de boîtier connecté ni de visite 100% autonome. Cette partie matérielle (IoT, boîtier à clé) est explicitement **hors périmètre**, prévue pour une version v1 ultérieure. Ne la développe pas, n'y consacre pas de temps, même si le brief produit d'origine en parle.

Voir `docs/product-brief.md` pour le détail du périmètre fonctionnel et `docs/build-order.md` pour l'ordre dans lequel construire les écrans.

## Documents à consulter

| Fichier | Contenu |
|---|---|
| `maquette_interface/bail/bail.html` | **Maquette de référence, source de vérité visuelle.** Voir règle 4 ci-dessous. |
| `maquette_interface/bail/README.md` | Comment lire la maquette : écrans, profils, direction visuelle, animations |
| `docs/product-brief.md` | Vision produit complète, ce qui est dans le MVP v0 vs repoussé à v1 |
| `docs/tech-stack.md` | Stack technique et outils validés |
| `docs/data-model.md` | Entités principales et leurs relations |
| `docs/build-order.md` | Ordre de construction des écrans, à respecter |
| `docs/integrations.md` | Prestataires tiers et comment les intégrer (souvent en mode sandbox) |
| `docs/design-system.md` | Principes de design justifiant la maquette — utile si un écran n'y figure pas encore |
| `docs/market-context.md` | Contexte marché Metz (cibles, volumes, profils) |
| `docs/legal-context.md` | Ce qui est légalement contraint, et ce qui peut avancer sans attendre le juridique |
| `docs/team-and-status.md` | Qui fait quoi, état d'avancement au moment du transfert |

> `maquette_interface/project/` contient une maquette antérieure (nom « Seuil », accent bordeaux). Elle est **remplacée** par `maquette_interface/bail/` et ne fait plus foi — ne pas s'en inspirer en cas de divergence.

## Règles à ne jamais casser

1. **Pas de visite autonome par boîtier connecté dans le MVP v0.** C'est un point tranché, pas une option à réévaluer.
2. **Le bail est généré à partir d'un modèle légal verrouillé.** Pas de rédaction libre par l'IA — elle vérifie la cohérence des champs, elle n'invente pas de clauses. Voir `docs/legal-context.md`.
3. **Web responsive uniquement.** Pas d'app mobile native pour le MVP — décision réexaminée et confirmée en cours de route.
4. **`maquette_interface/bail/bail.html` est la référence visuelle et fonctionnelle du projet.** Elle couvre les 15 écrans du parcours (recherche, fiche annonce, espace propriétaire, dossier locataire, candidature, visite, bail, honoraires, back-office) pour les 3 profils. Reproduis-la fidèlement — couleurs, typographie, composants, textes, comportements — plutôt que de réinterpréter ou d'improviser un style générique. Le nom du produit est **Bail**, l'accent est le **vert forêt** défini dans la maquette (pas le bordeaux d'une ancienne exploration). Si un écran ou un état n'y figure pas, reste cohérent avec les principes de `docs/design-system.md` et avec les composants déjà posés dans la maquette plutôt que d'inventer un style nouveau.
5. **Les intégrations tierces réglementées (KYC, signature, paiement) tournent en mode sandbox/test pendant tout le développement.** Elles ne bloquent pas l'avancement — voir `docs/integrations.md`.

## Si tu es perdu

Relis `docs/product-brief.md` pour te resituer sur la vision globale, puis `docs/build-order.md` pour savoir où tu en es censé être. Ne réintroduis pas de fonctionnalités hors périmètre (visite autonome, app native, rédaction de bail libre) même si elles semblent logiques dans l'absolu — elles ont été délibérément écartées du MVP v0.
