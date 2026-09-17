# Plan de finalisation — référence du 15 septembre 2026

Ce plan fourni par le porteur du projet définit la numérotation des étapes de
finalisation. Il remplace, pour ce suivi, la numérotation historique des écrans.

| Étape | Travail | État et conditions restantes |
|---|---|---|
| 1. Sécuriser les fichiers déposés | Formats réels, fichiers corrompus, motifs de refus, remplacement | Développé et testé localement ; voir `file-upload-validation.md`. |
| 2. Compléter la publication des biens | Énergie, diagnostics requis, expiration et retrait | Développé et testé localement ; voir `property-publication.md`. |
| 3. Terminer les paiements | Honoraires, abonnements, préautorisations, annulations, remboursements, fonds propriétaires | Honoraires/abonnements développés. **Branchements Stripe à rappeler** : clés, webhook, portail, recette sandbox. Préautorisations complètes, remboursements et circuit des fonds restent à finaliser ; voir `payments.md`. |
| 4. Brancher la signature électronique | DocuSign, modèles approuvés, signatures/refus/expiration, conservation | Connecteur développé et testé localement. Branchement/recette sandbox, modèles juridiques, archivage durable et opérations admin restent nécessaires ; voir `signatures.md`. |
| 5. Évaluer et activer l’IA documentaire | Bulletins fictifs, mesures d’erreurs et coûts, amélioration, cadrage des autres pièces | Banc d’essai et corpus de 14 pièces développés ; 37 tests ciblés passent. **Clé, campagne OpenAI réelle et activation reportées à la demande du porteur du projet le 16 septembre**. L’admin conserve la décision finale ; l’IA ne certifie pas l’authenticité. Voir `document-ai-evaluation.md`. |
| 6. Finaliser les visites | Concurrence, annulation, agent, notifications, visio et purge | Parcours accompagné consolidé : réservations concurrentes, annulations, affectations, notifications, rappels et reprise des purges. **Visio indisponible tant que non branchée ; choix de lancement à confirmer. Préautorisations Stripe encore à finaliser avec l’étape 3.** Aucun boîtier connecté. Voir `visits.md`. |
| 7. Administration et exploitation | MFA admin, conservation, suppression, incidents, sauvegardes | Socle développé : MFA, suppression des comptes sans engagement, revue des autres demandes, incidents et purge technique. Restauration fictive locale réussie. **Restent les durées métier et effacements sélectifs, la récupération MFA assistée, les alertes et sauvegardes hébergées avec recette en préproduction.** Voir `operations.md`. |
| 8. Finitions du site | Typographie, cohérence, textes, formulaires, états vides | **Développement des finitions appliqué** : polices locales, menu mobile, panneaux, filtres, formulaires, tableaux, galerie, erreurs et états vides. Promesses publiques et statistiques non mesurées corrigées. 205 tests frontend réussis ; compilation validée. **Recette visuelle PC/mobile encore non effectuée : aucun navigateur connecté.** Voir `frontend-finishing.md` ; étape non clôturée avant cette recette. |
| 9. Recette en préproduction | Annonce → dossier → candidature → visite → bail → signature → paiement | À rejouer avec plusieurs rôles, refus, corrections, pannes, annulations et e-mails. |
| 10. Déploiement et pilote limité | Migrations, configuration, retour arrière, suivi humain | Après validation de la préproduction, ouverture progressive. |

Un test avec fournisseur simulé ne valide pas le branchement externe. Les étapes 3
et 4 restent donc partielles malgré la réussite de leurs tests locaux. Les rappels
Stripe et recette visuelle du mobile restent à inclure dans les prochains bilans.

Report confirmé le 16 septembre après l’étape 6 : **terminer les empreintes
bancaires Stripe ; décider si la visio est proposée au lancement puis brancher
et tester son prestataire si elle est retenue**. Ces points restent à rappeler,
avec la clé OpenAI et les autres branchements externes.

Demande du 17 septembre — **recette et finitions mobiles dédiées**, à rappeler dans
les prochains bilans : reprendre les espaces visiteur, locataire, propriétaire et
admin sur petits écrans. Vérifier les largeurs 320, 375, 390 et 430 px, les retours
à la ligne avec les nouvelles polices, les marges, les menus, les filtres, les
panneaux latéraux, les tableaux, les formulaires avec clavier ouvert, les zones
tactiles, les états vides/erreurs et l’absence de débordement horizontal. Prévoir
une vérification sur téléphone réel, notamment Safari iOS et Chrome Android.
Les adaptations ont été développées dans la seconde passe du 17 septembre.
La vérification visuelle de ces largeurs reste à effectuer ; les tests jsdom et
HTTP ne la remplacent pas. Voir `frontend-finishing.md`.
