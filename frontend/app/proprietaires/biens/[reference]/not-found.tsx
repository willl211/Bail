import Link from 'next/link';

/**
 * Bien introuvable dans le portefeuille.
 *
 * Le message générique du site parle d'une annonce « retirée par son
 * propriétaire » — hors sujet quand c'est justement le propriétaire qui
 * regarde. L'API renvoie le même 404 pour un bien inexistant et pour celui d'un
 * autre compte, et ce texte reste juste dans les deux cas sans confirmer
 * laquelle des deux situations s'applique.
 */
export default function OwnerPropertyNotFound() {
  return (
    <main className="page">
      <div className="notice">
        <span className="label">Bien introuvable</span>
        <h1 className="notice__title">Ce bien n’est pas dans votre portefeuille</h1>
        <p className="notice__text">
          La référence n’existe pas, ou elle appartient à un autre compte. Vérifiez
          l’adresse, ou repartez de la liste de vos biens.
        </p>
        <p className="notice__text mt-16">
          <Link href="/proprietaires/biens">← Revenir à mes biens</Link>
        </p>
      </div>
    </main>
  );
}
