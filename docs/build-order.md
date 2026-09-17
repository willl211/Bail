# Ordre de développement des écrans

**Suivi actuel : voir le [plan de finalisation en dix étapes](development-plan.md),
fourni le 15 septembre. L’étape 5 est l’IA documentaire ; les visites sont l’étape 6.**
La liste ci-dessous conserve uniquement l’ordre historique de construction des écrans.

Construis et teste dans cet ordre. Un écran doit être fonctionnel avant de passer au suivant — ne pas paralléliser tous les écrans dès le départ, ça complique le débogage et la revue.

1. **Recherche et fiche annonce** (locataire) — consultable sans compte
2. **Création de compte + espace propriétaire** (dépôt d'annonce, abonnement)
3. **Création de compte + dossier locataire** (upload de documents)
4. **Candidature à un bien**
5. **Prise de RDV de visite** (accompagnée ou visio)
6. **Génération de bail + signature électronique** (peut tourner en mode test/mock tant que DocuSign n'est pas branché en production)
7. **Paiement des honoraires** (peut tourner en mode test/mock au départ avec Stripe sandbox)

Si tu te reprends en main après une interruption : regarde quel écran de cette liste est le dernier fonctionnel et complet, et reprends à partir du suivant plutôt que de repartir de zéro ou de sauter des étapes.

## Ajustements à prévoir

- [ ] **Étape 7 — administration et exploitation** — MFA admin, demandes de suppression, suivi des incidents et purge technique développés ; restauration fictive locale réussie. Restent la validation des durées métier, les effacements sélectifs, les alertes et sauvegardes hébergées, ainsi que la récupération MFA assistée. Voir [les procédures et limites](operations.md).

- [ ] **Étape 6 — visites** — parcours accompagné consolidé le 16 septembre : réservations et fermetures concurrentes, conflits d’agenda, annulations idempotentes, notifications par rôle, rappels et purge avec reprise des erreurs. **Restent les empreintes Stripe et, si retenue au lancement, l’intégration visio.** Le simulateur visio ne permet plus de réserver. Voir [le fonctionnement et la recette](visits.md).

- [ ] **Étape 5 — IA documentaire** — banc d’essai développé le 16 septembre : 14 documents fictifs, mesures des erreurs/citations/coûts, limites d’appels et cadre des autres justificatifs. **Campagne OpenAI réelle et activation encore à valider après configuration de la clé** ; 37 tests ciblés passent, sans démontrer la qualité du modèle. Voir [l’évaluation et les conditions d’activation](document-ai-evaluation.md).

- [x] **Contrôler les fichiers avant stockage** — étape du 13 septembre 2026 : vérification des formats réels, PDF et images illisibles refusés, conservation des diagnostics en cas de remplacement invalide. Voir [les contrôles et leurs limites](file-upload-validation.md).
- [x] **Compléter les règles de publication** — validé en local le 14 septembre : calendrier énergétique, diagnostics conditionnels, dates de validité, retrait automatique et reprise de facturation. Migration appliquée ; 245 tests d'intégration et 178 tests frontend réussis. Formulaire, liste Mes biens et contrôle admin vérifiés à 1440, 390 et 320 px ; débordements des motifs corrigés. Voir [le détail et les limites](property-publication.md).
- [ ] **Étape 3 — paiements** — Checkout honoraires/abonnement, carte sans débit à zéro bien, portail Stripe, reprise de résiliation et confirmations idempotentes implémentés le 14 septembre. Migration appliquée en local. **Reste la recette Stripe sandbox après ajout des clés**, puis la validation du barème réel. Voir [la configuration, les scénarios et les limites](payments.md).
- [ ] **Branchements Stripe à rappeler dans les prochains bilans** — demande du 15 septembre : créer/configurer la sandbox et son produit, renseigner les clés et le secret webhook, configurer le portail et les relances, puis effectuer la recette de bout en bout. Le développement local est testé ; les branchements externes restent à faire.
- [ ] **Étape 4 — signature des baux** — intégration DocuSign sandbox développée le 15 septembre : PDF et diagnostics annexés, tentative persistée et reprise sans reconstruction du document, confirmations HMAC avec relecture des signataires, téléchargement réservé aux parties et aux agents. **Reste le branchement et la recette DocuSign sandbox**, puis l'archivage durable, les outils de rapprochement/annulation et les modèles validés juridiquement. Voir [le fonctionnement et les limites](signatures.md). Les modèles de démonstration restent verrouillés.

- [x] **Changer la police du site** — Newsreader intégrée pour les grands titres, DM Sans pour les textes et formulaires, IBM Plex Mono conservée pour les données. Fichiers WOFF2 et licences inclus ; titres et interlignes adaptés. La recette visuelle PC/mobile reste à effectuer, aucun navigateur pilotable n’étant disponible pendant cette passe.
- [x] **Développer les finitions de l’étape 8** — passe du 17 septembre : textes publics rectifiés, statistiques non mesurées retirées, erreurs récupérables, photos de fiche branchées, nouvelle navigation et adaptations mobiles. 205 tests frontend réussis et compilation validée. Voir [le détail](frontend-finishing.md).
- [ ] **Valider visuellement les finitions PC/mobile** — adaptations développées pour navigation, filtres, panneaux, formulaires, cartes et tableaux de tous les rôles. Recette à 320/375/390/430 px et sur ordinateur, clavier ouvert, états vides/erreurs, zones tactiles et débordements ; puis téléphone réel. Aucun navigateur pilotable disponible pendant cette passe : cette validation reste nécessaire pour clôturer l’étape 8.
