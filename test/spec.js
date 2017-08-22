const asciidoctor = require('asciidoctor.js')();
require('../build/asciidoctor-template.js')(); // Asciidoctor Template
const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Rendering', function () {

  const readFixtureSync = function (fileName) {
    return fs.readFileSync(path.join('test', 'fixtures', fileName), 'utf-8');
  };

  it('should produce a simple Reveal.js presententation when backend=revealjs', function () {
    const options = {safe: 'safe', backend: 'revealjs'};
    const file = 'simple_presentation';
    const content = readFixtureSync('simple_presentation.adoc');
    const html = asciidoctor.convert(content, options);
    assert.equal(html, readFixtureSync('simple_presentation.html'));
  });
});
