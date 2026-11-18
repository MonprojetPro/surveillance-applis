// Message du passage de maintenance (T-109) vers le telephone de MiKL.
// Declenche par le workflow « Prevenir MiKL » (workflow_dispatch), lance par le passage du mardi.
//
// Ce depot est PUBLIC et les entrees d'un workflow s'y lisent par tous : le message ne doit
// JAMAIS nommer une bibliotheque ni une faille. On impose donc un texte court et generique.
import { fileURLToPath } from 'node:url'
import { notifier } from './surveiller.mjs'

export const LONGUEUR_MAX = 160

/** Nettoie le message : une ligne, longueur bornee. Renvoie null s'il est vide. */
export function preparerMessage(brut) {
  const texte = String(brut ?? '').replace(/\s+/g, ' ').trim()
  if (!texte) return null
  return texte.length > LONGUEUR_MAX ? texte.slice(0, LONGUEUR_MAX - 1) + '…' : texte
}

async function principal() {
  const sujet = process.env.NTFY_TOPIC
  if (!sujet) {
    console.error('NTFY_TOPIC absent : impossible de prévenir.')
    process.exit(1)
  }
  const message = preparerMessage(process.env.MESSAGE)
  if (!message) {
    console.error('Message vide : rien envoyé.')
    process.exit(1)
  }
  await notifier(sujet, { type: 'maintenance', titre: 'Maintenance des applis', message })
  console.log('Notification envoyée.')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal().catch((e) => { console.error(e); process.exit(1) })
}
