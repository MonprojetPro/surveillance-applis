// Surveillant de disponibilite des applis MonprojetPro (T-092, etage 1).
// Tourne toutes les 5 min dans GitHub Actions, hors de nos serveurs : si le Hub
// tombe, ce surveillant, lui, continue de tourner et de prevenir.
//
// Regle (la meme que le health-check du Hub depuis T-091) : une lenteur n'est
// JAMAIS une panne. Seuls comptent : pas de reponse, abandon au delai, ou une
// erreur serveur (5xx). Une redirection (3xx) ou un « acces refuse » (4xx)
// prouvent que l'appli est vivante.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** Nombre de verifications ratees D'AFFILEE avant d'alerter (~10 min). */
export const SEUIL_ECHECS = 2
/** Delai au-dela duquel une appli qui ne repond pas est consideree muette. */
export const DELAI_MS = 15_000
/** GitHub coupe les taches planifiees d'un depot public sans activite depuis 60 jours. */
export const BATTEMENT_MS = 30 * 24 * 60 * 60 * 1000

/** Verdict d'une verification : l'appli est-elle en vie ? */
export function estEnVie(resultat) {
  if (!resultat || resultat.erreur) return false
  return resultat.statut > 0 && resultat.statut < 500
}

function duree(depuisIso, maintenantMs) {
  const min = Math.max(1, Math.round((maintenantMs - new Date(depuisIso).getTime()) / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return `${h} h ${String(min % 60).padStart(2, '0')}`
}

/**
 * Compare les resultats a l'etat precedent.
 * Renvoie le nouvel etat et les notifications a envoyer.
 * Fonction pure : aucune requete, aucune ecriture.
 */
export function decider(applis, resultats, etatPrecedent = {}, maintenantMs = Date.now()) {
  const etat = { ...etatPrecedent, applis: {} }
  const notifications = []
  const maintenant = new Date(maintenantMs).toISOString()

  for (const appli of applis) {
    const avant = etatPrecedent.applis?.[appli.id] ?? { echecs: 0, enPanne: false, premierEchec: null }
    const resultat = resultats[appli.id]

    if (estEnVie(resultat)) {
      if (avant.enPanne) {
        notifications.push({
          appliId: appli.id,
          type: 'revenue',
          titre: `${appli.nom} est revenue`,
          message: `${appli.nom} répond de nouveau (code ${resultat.statut}). Coupure d'environ ${duree(avant.premierEchec, maintenantMs)}.`,
        })
      }
      etat.applis[appli.id] = { echecs: 0, enPanne: false, premierEchec: null }
      continue
    }

    const echecs = avant.echecs + 1
    const premierEchec = avant.premierEchec ?? maintenant
    let enPanne = avant.enPanne
    if (!enPanne && echecs >= SEUIL_ECHECS) {
      enPanne = true
      const cause = resultat?.erreur ? resultat.erreur : `erreur serveur ${resultat?.statut}`
      notifications.push({
        appliId: appli.id,
        type: 'tombee',
        titre: `${appli.nom} ne répond plus`,
        message: `${appli.nom} est en panne depuis ${duree(premierEchec, maintenantMs)} (${cause}). Adresse : ${appli.url}`,
      })
    }
    etat.applis[appli.id] = { echecs, enPanne, premierEchec }
  }

  if (!etat.battement || maintenantMs - new Date(etat.battement).getTime() >= BATTEMENT_MS) {
    etat.battement = maintenant
  }
  return { etat, notifications }
}

/** Verifie une appli. Ne leve jamais : une panne est un resultat, pas une exception. */
export async function verifier(url, fetchFn = fetch, delaiMs = DELAI_MS) {
  const debut = Date.now()
  try {
    const reponse = await fetchFn(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(delaiMs),
      headers: { 'user-agent': 'surveillance-applis/1.0 (+github actions)' },
    })
    return { statut: reponse.status, ms: Date.now() - debut }
  } catch (e) {
    const erreur = e?.name === 'TimeoutError'
      ? `aucune réponse en ${delaiMs / 1000} s`
      : `injoignable (${e?.cause?.code ?? e?.message ?? 'erreur réseau'})`
    return { statut: 0, ms: Date.now() - debut, erreur }
  }
}

/** Envoie une notification sur le telephone via ntfy (format JSON : accents OK). */
export async function notifier(sujet, notif, fetchFn = fetch) {
  const icone = { tombee: 'rotating_light', revenue: 'white_check_mark' }[notif.type] ?? 'test_tube'
  const reponse = await fetchFn('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      topic: sujet,
      title: notif.titre,
      message: notif.message,
      priority: notif.type === 'tombee' ? 5 : 3,
      tags: [icone],
    }),
    signal: AbortSignal.timeout(DELAI_MS),
  })
  if (!reponse.ok) throw new Error(`ntfy a refusé la notification (HTTP ${reponse.status})`)
}

async function principal() {
  const ici = dirname(fileURLToPath(import.meta.url))
  const sujet = process.env.NTFY_TOPIC
  if (!sujet) {
    // Echec visible : GitHub envoie un mail quand le workflow echoue.
    console.error('NTFY_TOPIC absent : impossible de prévenir. Ajouter le secret dans le dépôt.')
    process.exit(1)
  }

  if (process.argv.includes('--test')) {
    await notifier(sujet, {
      type: 'test',
      titre: 'Test de la surveillance',
      message: 'Si tu lis ceci, les alertes arrivent bien sur ton téléphone.',
    })
    console.log('Notification de test envoyée.')
    return
  }

  const fichierApplis = process.env.APPLIS_FICHIER ?? join(ici, 'applis.json')
  const fichierEtat = process.env.ETAT_FICHIER ?? join(ici, 'etat', 'etat.json')
  const { applis } = JSON.parse(await readFile(fichierApplis, 'utf8'))
  const etatPrecedent = await readFile(fichierEtat, 'utf8').then(JSON.parse).catch(() => ({}))

  const resultats = {}
  await Promise.all(applis.map(async (a) => { resultats[a.id] = await verifier(a.url) }))
  for (const a of applis) {
    const r = resultats[a.id]
    const verdict = estEnVie(r) ? 'OK   ' : 'PANNE'
    console.log(`${verdict} ${a.id.padEnd(12)} ${String(r.statut).padEnd(4)} ${r.ms} ms${r.erreur ? ' - ' + r.erreur : ''}`)
  }

  const { etat, notifications } = decider(applis, resultats, etatPrecedent)

  for (const n of notifications) {
    try {
      await notifier(sujet, n)
      console.log(`Notification envoyée : ${n.titre}`)
    } catch (e) {
      console.error(`ECHEC d'envoi : ${n.titre} - ${e.message}`)
      // Alerte « tombee » non partie : on ne la marque pas envoyee, elle repartira au prochain passage.
      if (n.type === 'tombee') etat.applis[n.appliId].enPanne = false
      process.exitCode = 1
    }
  }

  const nouveau = JSON.stringify(etat, null, 2) + '\n'
  const ancien = JSON.stringify(etatPrecedent, null, 2) + '\n'
  if (nouveau !== ancien) {
    await mkdir(dirname(fichierEtat), { recursive: true })
    await writeFile(fichierEtat, nouveau)
    console.log('État mis à jour.')
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal().catch((e) => { console.error(e); process.exit(1) })
}
