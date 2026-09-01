# Brief produit

## Vision complète (long terme, pas toute pour le MVP)

- Les propriétaires mettent leur bien en location en payant un abonnement à la plateforme plutôt que de passer par une agence.
- Les locataires cherchent des biens comme sur SeLoger ou Leboncoin.
- Les locataires déposent un dossier numérique complet pour candidater aux biens correspondant à leurs critères et à leurs moyens.
- À terme, des visites autonomes de l'appartement via un boîtier à clé connecté et un code donné dans l'app, sécurisées par une pré-autorisation carte bancaire, une vérification d'identité et une signature électronique.
- Si le bien convient : rédaction du bail et signature en ligne, assistées par une IA.
- Le locataire paie des frais à la plateforme comme à une agence, mais moins chers.
- Une fois installé, le locataire a accès à un espace de services : copropriété, syndic, assistance via un réseau de partenaires (serrurier, plombier, etc.), sans avoir à démarcher qui que ce soit lui-même.

## Périmètre du MVP v0 (ce qu'il faut construire maintenant)

Le MVP v0 couvre le parcours complet, **sans** le boîtier connecté. La visite se fait accompagnée (agent physique) ou en visio en direct — au choix du locataire.

Modules à construire :
- Espace propriétaire (dépôt d'annonce, abonnement, suivi des candidatures)
- Espace locataire (recherche, filtres, dossier numérique)
- Prise de RDV de visite (accompagnée ou visio)
- Génération de bail à partir de modèles légaux + signature électronique
- Calcul et paiement des honoraires (barème réglementaire, encore à finaliser — voir `legal-context.md`)
- Back-office agence (registre des mandats, suivi des dossiers)

Hors périmètre v0, à ne pas construire maintenant :
- Boîtier connecté / visite 100% autonome (prévu v1)
- Services post-emménagement (syndic, assistance, réseau d'artisans) — viendra juste après le lancement commercial, pas nécessaire pour valider le MVP
- Bail mobilité (1-10 mois) — non retenu pour le MVP v0
- Intégration Visale (garantie loyers étudiants) — non retenue pour le MVP v0

## Pourquoi ce phasage

La visite autonome pose des questions de responsabilité (accident, dégradation, occupation frauduleuse pendant une visite sans témoin) et nécessite une infrastructure matérielle (boîtiers IoT) coûteuse à sécuriser correctement. Le choix a été fait de valider d'abord la demande, le parcours et le modèle économique avec des visites accompagnées/visio, avant d'investir dans le matériel connecté.
