# Contexte juridique

Ce document existe pour que le développement n'ignore pas ces contraintes, mais **rien ici ne bloque le développement technique** — le juridique avance en parallèle. Il conditionne le lancement commercial réel (premier bail signé pour de vrai, premiers honoraires facturés), pas la construction du produit.

## Statut

- **Carte professionnelle T** (et probablement G) : portée par un associé ou salarié déjà titulaire (décision prise).
- **Carte T seule ou T+G** : pas encore tranché — dépend du circuit des fonds (voir ci-dessous). À trancher avec un avocat, pas encore identifié.
- **Garantie financière et assurance RC Pro** : organisme pas encore identifié.
- **Avocat en droit immobilier** : pas encore trouvé, à faire avant de figer le mandat de location et le modèle de bail définitif.

## Circuit des fonds (impacte le modèle de données)

La plateforme **encaisse les loyers/dépôts pour le compte du propriétaire** (plutôt que des paiements directs entre parties). Cette décision implique le besoin d'une carte G en plus de la carte T. Le module paiement doit donc prévoir un état "fonds reçus, à reverser au propriétaire", pas seulement un paiement direct.

## Barème d'honoraires et abonnement

Non figés — dépendent du marché, à définir. Le module de facturation doit être **paramétrable** (montants modifiables sans redéploiement) plutôt que codé en dur, puisque ces chiffres vont probablement changer plusieurs fois avant le lancement commercial.

## Transmission du dossier locataire au propriétaire (tranché le 3 septembre 2026)

Quand un locataire candidate, la **synthèse vérifiée** de son dossier est
transmise au propriétaire : identité, revenus nets, situation professionnelle,
taux d'effort, état du garant. Ses **documents** (pièce d'identité, bulletins de
salaire, avis d'imposition) ne le sont jamais — ils restent chez Bail.

Le fondement de ce traitement est l'**exécution du contrat**, pas le
consentement. Candidater *est* la demande de transmettre : sans cette
transmission, le service n'existe pas. La maquette prévoyait une case à cocher
pré-remplie ; elle a été retirée. Une case cochée par défaut donne l'apparence
d'un consentement sans en avoir la valeur — le RGPD exige un acte positif — et
laisserait croire à un choix qui n'en est pas un.

À la place, l'écran de candidature **informe** avant l'envoi : la synthèse est
affichée en entier, telle qu'elle partira, avec la mention que les documents ne
suivent pas. C'est l'obligation de transparence, elle est remplie par l'écran.

À faire valider par l'avocat en même temps que le mandat : la formulation de la
mention, et la durée de conservation d'une candidature refusée.

## Contrainte fixe à respecter dès maintenant

Le bail généré par l'app doit être **verrouillé sur un modèle légal type** — la génération assistée par IA vérifie la cohérence des champs (noms, adresse, loyer, durée), elle n'invente pas de clauses ni ne rédige librement. C'est une contrainte de conception à respecter dès la construction du module bail, indépendamment de l'avancement du reste du juridique.
