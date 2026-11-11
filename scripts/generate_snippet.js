const fs = require('fs');

const html = fs.readFileSync('superselectos_sample.html', 'utf8');
const chunks = html.split('item-producto').slice(1, 4);
const snippet = chunks.map(c => '<div class="col item-producto"' + c.split('</div></div></div></div>')[0] + '</div></div></div></div>').join('\n\n');

fs.writeFileSync('public/superselectos_sample_snippet.html', snippet);
console.log('Sample snippet generated successfully.');

