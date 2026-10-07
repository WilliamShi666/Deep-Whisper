import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('personal container publishes only host loopback, requires password access and preserves its data volume',()=>{
 const compose=readFileSync('compose.yaml','utf8');assert.match(compose,/127\.0\.0\.1:5000:5000/);assert.match(compose,/APP_ACCESS_MODE: password/);assert.match(compose,/APP_DATA_DIR: \/data/);assert.match(compose,/personal-data:\/data/);
 const image=readFileSync('Dockerfile','utf8');assert.match(image,/USER node/);assert.doesNotMatch(image,/COPY --from=build \/app \/app/);assert.doesNotMatch(image,/SUPABASE|postgres/);
});
