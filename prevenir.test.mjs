import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { preparerMessage, LONGUEUR_MAX } from './prevenir.mjs'

test('message : une seule ligne, espaces resserres', () => {
  assert.equal(preparerMessage('  2 décisions\n à prendre  '), '2 décisions à prendre')
})

test('message vide ou absent : rien a envoyer', () => {
  assert.equal(preparerMessage(''), null)
  assert.equal(preparerMessage('   '), null)
  assert.equal(preparerMessage(undefined), null)
})

test('message trop long : coupe a la longueur maximale', () => {
  const m = preparerMessage('a'.repeat(500))
  assert.equal(m.length, LONGUEUR_MAX)
  assert.ok(m.endsWith('…'))
})

test('registre : chaque appli a un bloc maintenance complet', () => {
  const { applis } = JSON.parse(readFileSync(new URL('./applis.json', import.meta.url), 'utf8'))
  assert.ok(applis.length >= 4)
  for (const a of applis) {
    const m = a.maintenance
    assert.ok(m, `${a.id} : bloc maintenance absent`)
    assert.match(m.depot, /^[\w.-]+\/[\w.-]+$/, `${a.id} : depot`)
    for (const champ of ['dossier', 'branche', 'projetVercel']) assert.ok(m[champ], `${a.id} : ${champ}`)
    assert.ok(['git', 'cli'].includes(m.miseEnLigne), `${a.id} : miseEnLigne`)
    if (m.routeServeur) assert.ok(m.routeServeur.startsWith('/'), `${a.id} : routeServeur`)
  }
})
