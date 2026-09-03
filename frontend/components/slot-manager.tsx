'use client';

import { useState } from 'react';
import type { OwnerSlotView, VisitStatus, VisitType } from '@/lib/api';
import * as fmt from '@/lib/format';
import { closeSlot, openSlots, type VisitFailure } from '@/lib/visits-client';

const VISIT_STATUS: Record<VisitStatus, string> = {
  REQUESTED: 'demandé',
  PENDING_CHECKS: 'à confirmer',
  CONFIRMED: 'confirmé',
  IN_PROGRESS: 'en cours',
  COMPLETED: 'effectué',
  CANCELLED: 'annulé',
  NO_SHOW: 'non honoré',
};

/** Horaires proposés en un clic — ceux où l'on visite réellement un logement. */
const COMMON_HOURS = ['12:30', '17:00', '18:00', '18:30', '19:00'];

/** Rendu `YYYY-MM-DD` d'une date locale, sans passer par UTC. */
function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Ouverture des créneaux de visite par le propriétaire.
 *
 * Une date, des heures, un type : c'est tout ce qu'il faut pour ouvrir une
 * plage. Un vrai calendrier ferait plus joli mais demanderait bien plus de
 * clics pour le geste courant — « mardi et jeudi, en fin de journée ».
 */
export function SlotManager({
  reference,
  initial,
}: {
  reference: string;
  initial: OwnerSlotView[];
}) {
  const [slots, setSlots] = useState(initial);
  const [date, setDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return isoDate(tomorrow);
  });
  const [hours, setHours] = useState<string[]>(['18:00']);
  const [types, setTypes] = useState<VisitType[]>(['ACCOMPANIED', 'VIDEO']);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<VisitFailure | null>(null);

  const toggleHour = (hour: string) =>
    setHours((current) =>
      current.includes(hour) ? current.filter((h) => h !== hour) : [...current, hour],
    );

  const toggleType = (type: VisitType) =>
    setTypes((current) =>
      current.includes(type)
        ? current.filter((t) => t !== type)
        : [...current, type],
    );

  const submit = async () => {
    if (hours.length === 0 || types.length === 0) return;
    setPending(true);
    setError(null);
    try {
      // Construits en heure locale : le propriétaire pense « 18 h chez moi »,
      // pas en UTC. `toISOString` fait la conversion pour l'API.
      const startsAt = hours.map((hour) => {
        const [h, m] = hour.split(':').map(Number);
        const value = new Date(`${date}T00:00:00`);
        value.setHours(h, m, 0, 0);
        return value.toISOString();
      });
      setSlots(await openSlots(reference, startsAt, types));
    } catch (failure) {
      setError(failure as VisitFailure);
    } finally {
      setPending(false);
    }
  };

  const remove = async (slotId: string) => {
    setPending(true);
    setError(null);
    try {
      setSlots(await closeSlot(reference, slotId));
    } catch (failure) {
      setError(failure as VisitFailure);
    } finally {
      setPending(false);
    }
  };

  const upcoming = slots.filter((slot) => !slot.past);

  return (
    <>
      <div className="panel pad">
        <div className="form form--2">
          <label className="field">
            <span className="label label--ink">Jour</span>
            <input
              className="field__box"
              type="date"
              value={date}
              min={isoDate(new Date())}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>

          <div className="field">
            <span className="label label--ink">Type de visite accepté</span>
            <div className="flex gap-10 wrap mt-8">
              {(
                [
                  ['ACCOMPANIED', 'Accompagnée'],
                  ['VIDEO', 'Visio'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="slot"
                  style={{ width: 'auto' }}
                  aria-pressed={types.includes(value)}
                  onClick={() => toggleType(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="field form__full">
            <span className="label label--ink">Horaires</span>
            <div className="flex gap-10 wrap mt-8">
              {COMMON_HOURS.map((hour) => (
                <button
                  key={hour}
                  type="button"
                  className="slot"
                  style={{ width: 'auto' }}
                  aria-pressed={hours.includes(hour)}
                  onClick={() => toggleHour(hour)}
                >
                  {hour}
                </button>
              ))}
            </div>
            <span className="field__hint">
              Une visite accompagnée dure 30 minutes, une visio 20. Deux créneaux
              qui se chevauchent ne peuvent pas être ouverts ensemble.
            </span>
          </div>

          {error ? (
            <p className="form__full auth__error" role="alert">
              {error.message}
            </p>
          ) : null}

          <div className="form__full flex gap-12 wrap ai-c">
            <button
              type="button"
              className="btn btn-sm"
              onClick={submit}
              disabled={pending || hours.length === 0 || types.length === 0}
            >
              {pending ? 'Ouverture…' : 'Ouvrir ces créneaux'}
            </button>
            <span className="label">
              {hours.length} horaire{hours.length > 1 ? 's' : ''} sélectionné
              {hours.length > 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      <h2 className="h mt-32 mb-12">Créneaux ouverts</h2>
      {upcoming.length === 0 ? (
        <div className="panel pad">
          <p className="p-sm">
            Aucun créneau à venir. Les candidats retenus ne peuvent pas prendre
            rendez-vous tant que vous n’en ouvrez pas.
          </p>
        </div>
      ) : (
        <div className="panel panel--strong">
          {upcoming.map((slot) => (
            <div key={slot.id} className="doc">
              <div className="doc__head">
                <div>
                  <div className="doc__n">
                    {fmt.appointment(slot.startsAt)}
                  </div>
                  <div className="doc__m">
                    {slot.durationMinutes} min ·{' '}
                    {slot.allowedTypes
                      .map((type) => (type === 'VIDEO' ? 'visio' : 'accompagnée'))
                      .join(' ou ')}
                  </div>
                </div>

                <div className="doc__c">
                  {slot.booked
                    ? `${slot.bookedBy} · ${slot.visitStatus ? VISIT_STATUS[slot.visitStatus] : ''}`
                    : '—'}
                </div>

                <div className="doc__a">
                  <span className={slot.booked ? 'badge badge--ok' : 'badge badge--mute'}>
                    {slot.booked ? 'Réservé' : 'Libre'}
                  </span>
                  {slot.booked ? null : (
                    <button
                      type="button"
                      className="link"
                      onClick={() => remove(slot.id)}
                      disabled={pending}
                    >
                      Retirer
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
