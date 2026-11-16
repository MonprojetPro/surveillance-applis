import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estEnVie, decider, verifier, notifier, SEUIL_ECHECS, BATTEMENT_MS } from './surveiller.mjs'

const APPLIS = [{ id: 'hub', nom: 'Hub', url: 'https://hub.exemple' }]
const T0 = Date.parse('2026-11-16T10:00:00Z')
const MIN = 60_000
const ok = { statut: 200, ms: 300 }
const lent = { statut: 200, ms: 14_000 }
const muet = { statut: 0, ms: 15_000, erreur: 'aucune réponse en 15 s' }
const e503 = { statut: 503, ms: 200 }

/** Rejoue une suite de resultats, 5 min d'ecart, et collecte les notifications. */
function rejouer(suite, etat = {}) {
  const notifs = []
  suite.forEach((r, i) => {
    const sortie = decider(APPLIS, { hub: r }, etat, T0 + i * 5 * MIN)
    etat = sortie.etat
    notifs.push(...sortie.notifications)
  })
  return { etat, notifs }
}

test('vivante : 2xx, 3xx (renvoi vers la connexion) et 4xx', () => {
  for (const statut of [200, 204, 301, 307, 401, 403, 404]) assert.equal(estEnVie({ statut, ms: 1 }), true, String(statut))
})

test('morte : 5xx, pas de reponse, erreur reseau', () => {
  for (const statut of [500, 502, 503, 504]) assert.equal(estEnVie({ statut, ms: 1 }), false, String(statut))
  assert.equal(estEnVie(muet), false)
  assert.equal(estEnVie(undefined), false)
})

test('une lenteur n\'alerte JAMAIS (regle T-091)', () => {
  const { notifs } = rejouer(Array(30).fill(lent))
  assert.equal(notifs.length, 0)
})

test('un seul echec isole n\'alerte pas', () => {
  const { notifs } = rejouer([ok, muet, ok, e503, ok])
  assert.equal(notifs.length, 0)
})

test(`${SEUIL_ECHECS} echecs d'affilee : UNE alerte, puis silence tant que ca dure`, () => {
  const { notifs, etat } = rejouer([ok, muet, muet, muet, e503, muet])
  assert.equal(notifs.length, 1)
  assert.equal(notifs[0].type, 'tombee')
  assert.match(notifs[0].message, /depuis 5 min/)
  assert.equal(etat.applis.hub.enPanne, true)
})

test('retour a la normale : message de retablissement avec la duree', () => {
  const { notifs, etat } = rejouer([muet, muet, muet, muet, ok])
  assert.deepEqual(notifs.map((n) => n.type), ['tombee', 'revenue'])
  assert.match(notifs[1].message, /20 min/)
  assert.deepEqual(etat.applis.hub, { echecs: 0, enPanne: false, premierEchec: null })
})

test('une panne qui revient apres retablissement realerte', () => {
  const { notifs } = rejouer([muet, muet, ok, muet, muet])
  assert.deepEqual(notifs.map((n) => n.type), ['tombee', 'revenue', 'tombee'])
})

test('pas de message de retablissement si on n\'avait pas alerte', () => {
  const { notifs } = rejouer([muet, ok])
  assert.equal(notifs.length, 0)
})

test('une nouvelle appli ajoutee a la liste demarre sans historique', () => {
  const etatAncien = { applis: { autre: { echecs: 5, enPanne: true, premierEchec: 'x' } } }
  const { etat, notifications } = decider(APPLIS, { hub: ok }, etatAncien, T0)
  assert.equal(notifications.length, 0)
  assert.deepEqual(Object.keys(etat.applis), ['hub'])
})

test('battement mensuel : evite que GitHub coupe la planification au bout de 60 jours', () => {
  const premier = decider(APPLIS, { hub: ok }, {}, T0).etat
  assert.equal(premier.battement, new Date(T0).toISOString())
  const peuApres = decider(APPLIS, { hub: ok }, premier, T0 + 10 * MIN).etat
  assert.deepEqual(peuApres, premier, 'etat inchange = aucun commit inutile')
  const unMoisApres = decider(APPLIS, { hub: ok }, premier, T0 + BATTEMENT_MS).etat
  assert.notEqual(unMoisApres.battement, premier.battement)
})

test('verifier : ne suit pas les renvois et ne leve jamais', async () => {
  let options
  const r = await verifier('https://x', async (_u, o) => { options = o; return { status: 307 } })
  assert.equal(r.statut, 307)
  assert.equal(options.redirect, 'manual')

  const timeout = await verifier('https://x', async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e })
  assert.equal(estEnVie(timeout), false)
  assert.match(timeout.erreur, /aucune réponse/)

  const dns = await verifier('https://x', async () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e })
  assert.match(dns.erreur, /ENOTFOUND/)
})

test('notifier : JSON vers ntfy, priorite max pour une panne, erreur si refus', async () => {
  let envoye
  await notifier('sujet-x', { type: 'tombee', titre: 'Hub ne répond plus', message: 'm' }, async (url, o) => { envoye = { url, corps: JSON.parse(o.body) }; return { ok: true } })
  assert.equal(envoye.url, 'https://ntfy.sh/')
  assert.equal(envoye.corps.topic, 'sujet-x')
  assert.equal(envoye.corps.priority, 5)
  assert.equal(envoye.corps.title, 'Hub ne répond plus')

  await assert.rejects(notifier('s', { type: 'revenue', titre: 't', message: 'm' }, async () => ({ ok: false, status: 429 })), /429/)
})
