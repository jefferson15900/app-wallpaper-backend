const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDictionary } = require('./import-freedict.cts');

test('TEI import keeps senses, parts of speech, phrases and XML entities separate', () => {
    const xml = `<TEI><text><body>
      <entry><form><orth>bank</orth></form><gramGrp><pos>n</pos></gramGrp>
        <sense><cit type="trans" xml:lang="es"><quote>Ribéra</quote><quote>orilla</quote></cit><sense><def>River edge</def></sense></sense>
        <sense><cit type="trans" xml:lang="es"><quote>banco</quote></cit><sense><def>Financial institution</def></sense></sense>
      </entry>
      <entry><form><orth>rock &amp; roll</orth></form><sense><cit type="trans" xml:lang="es"><quote>Rock and roll</quote></cit></sense></entry>
      <entry><form><orth>moonlight</orth></form><sense><cit type="trans" xml:lang="es"><quote>claro de luna</quote></cit></sense></entry>
      <entry><form><orth>other</orth></form><sense><cit type="trans" xml:lang="fr"><quote>autre</quote></cit></sense></entry>
    </body></text></TEI>`;
    const first = parseDictionary(xml), second = parseDictionary(xml);
    assert.equal(first.headwords, 4);
    assert.equal(first.rows.length, 4);
    assert.deepEqual(first, second);
    const shore = first.rows.find(row => row.terms.includes('ribera'));
    assert.equal(shore.partOfSpeech, 'n');
    assert.equal(shore.definition, 'River edge');
    assert.ok(shore.terms.includes('bank'));
    assert.ok(!shore.terms.includes('banco'));
    assert.ok(first.rows.some(row => row.terms.includes('rock & roll')));
    assert.ok(first.rows.some(row => row.terms.includes('claro de luna')));
});
