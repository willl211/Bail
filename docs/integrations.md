# Intégrations tierces

Ces prestataires peuvent être branchés en mode test/sandbox pendant tout le développement — ils ne doivent jamais bloquer l'avancement du MVP.

| Besoin | Prestataire | Statut |
|---|---|---|
| KYC / vérification d'identité (avant visite et pour le dossier locataire) | Non choisi | À mocker pour l'instant — prévoir une interface qui simule une réponse "vérifié" / "rejeté" |
| Signature électronique du bail | DocuSign | Confirmé — utiliser leur environnement sandbox pendant le dev |
| Paiement (abonnements propriétaires, honoraires) | Stripe | Confirmé — mode test |
| Visio pour les visites à distance | Non choisi formellement | Recommandation : Daily.co (le plus simple à intégrer et le moins cher pour démarrer, comparé à Twilio) |

## Protocole de visite (v0)

Éléments de sécurité à prévoir dans le flux de prise de RDV, même en mode mock :
- Vérification d'identité (KYC) du visiteur avant le RDV
- Pré-autorisation carte bancaire
- Caméra activée obligatoire pendant la visite (confirmé — pas d'option pour la désactiver)
- Enregistrement vidéo conservé **15 jours**, purgé automatiquement ensuite

Type de visite proposé au locataire : accompagnée physique **ou** visio en direct, au choix.
