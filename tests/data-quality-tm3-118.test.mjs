import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mapCoordinates,coordinateVerificationState} from '../public/src/app/render/renderMap.js';
test('TM3-118 final data quality report is safe and idempotent',()=>{
  const r=JSON.parse(fs.readFileSync('tmp/final-data-quality-report.json','utf8'));
  assert.equal(r.costs.unknownBefore,70);
  assert.equal(r.costs.notApplicable,32);
  assert.equal(r.costs.included,19);
  assert.equal(r.costs.unknownAfter,19);
  assert.deepEqual(r.budget,{USD:4977.84,EUR:520.2,CHF:104});
  assert.equal(r.coordinates.totalRecoveryCoords,65);
  assert.equal(r.coordinates.clearMismatch,19);
  assert.equal(r.idempotency.zeroDiff,true);
  assert.equal(r.core.tour,1);
  assert.equal(r.core.purchases,14);
  assert.equal(r.core.purchaseUsd,561.18);
  assert.equal(r.core.flights,4);
  assert.equal(r.core.lodging,6);
  assert.equal(r.core.rail,10);
  assert.equal(r.core.nightCoverage,'16/16 (15 lodging nights + confirmed overnight flight coverage)');
});
test('TM3-118 map excludes recovery coordinates marked for review',()=>{
  assert.deepEqual(mapCoordinates({latitude:45.4,longitude:12.3,coordinateVerification:'VERIFIED_RECOVERY'}),{lat:45.4,lng:12.3});
  assert.equal(mapCoordinates({latitude:45.4,longitude:12.3,coordinateVerification:'MAP_COORDS_NEEDS_REVIEW'}),null);
  assert.equal(coordinateVerificationState({coordinateVerification:'MAP_COORDS_NEEDS_REVIEW'}),'MAP_COORDS_NEEDS_REVIEW');
});
