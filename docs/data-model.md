# Modèle de données — entités principales

Ces entités sont confirmées comme périmètre de base. Étendre si besoin technique, mais ne pas en retirer sans le signaler.

- **Utilisateur** — rôle : propriétaire / locataire / agent interne
- **Bien** — annonce, caractéristiques, statut (en ligne, en cours de visite, loué)
- **Dossier locataire** — documents (identité, revenus, garant), statut de vérification
- **Candidature** — lien entre un bien et un locataire, avec statut
- **Visite** — RDV, type (accompagnée / visio), statut
- **Bail** — document généré à partir d'un modèle légal, statut de signature
- **Paiement / honoraire** — montant, statut, méthode
- **Analyse de bulletin** — extension du 10 septembre 2026 : travail asynchrone lié à une pièce, source/version, résultat de lecture structuré, état et tentatives. Suppression en cascade avec la pièce. Aucune décision de validation ni modification du revenu déclaré dans cette entité ; voir [le fonctionnement](payslip-analysis.md).

## Points d'attention

- Le **bail** doit être généré à partir d'un template légal verrouillé (bail nu ou meublé selon le type de bien) — pas de génération libre. Le champ de statut de signature doit refléter le cycle DocuSign (envoyé, signé, refusé).
- Le **paiement/honoraire** doit pouvoir distinguer la part propriétaire et la part locataire dans le barème d'honoraires (encore non figé — voir `legal-context.md`), et le statut du circuit des fonds (la plateforme encaisse pour le compte du propriétaire, donc prévoir un état "reversé au propriétaire").
- Le **dossier locataire** doit prévoir un état de vérification par un prestataire KYC externe, actuellement mocké (voir `integrations.md`).

## Extensions d’exploitation — septembre 2026

L’étape 7 ajoute `Session.mfaVerifiedAt` et quatre tables :

- `MfaCredential` : facteur admin chiffré, dernière période TOTP utilisée,
  empreintes des secours, expiration de l’enrôlement ; relation unique au compte.
- `SecurityEvent` : action, date et identifiants techniques des acteurs, sans
  secret ni document ; conservation technique de 90 jours.
- `ErasureRequest` : demande unique par compte, état, motif, responsable de revue,
  date de fin et clés des fichiers restant à retirer. Les clés sont vidées à la fin.
- `OperationalIncident` : agrégation des erreurs serveur par gabarit de route et
  code HTTP, référence de requête, compteur et prise en charge.

Les identifiants du registre de suppression et du journal n’ont pas de clé
étrangère vers le compte : une trace minimale subsiste après l’effacement.
Les durées métier et celles des preuves de suppression doivent encore être
validées. Procédures et limites : [operations.md](operations.md).
