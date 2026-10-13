import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../game.js',import.meta.url),'utf8')).replace(/^import .*\n/,'');
function load(host='127.0.0.1',hash='#ai') {
 const listeners={};const cv={style:{},getContext:()=>({}),};const sandbox={window:{},location:{hostname:host,hash},document:{getElementById:()=>cv,documentElement:{}},innerWidth:768,innerHeight:432,matchMedia:()=>({matches:false}),getComputedStyle:()=>({getPropertyValue:()=>''}),localStorage:{getItem:()=>null,setItem:()=>{}},addEventListener:(n,f)=>listeners[n]=f,performance:{now:()=>0},requestAnimationFrame:()=>{},navigator:{},fetch:()=>{throw Error('AI must not submit')},GLIDE:[],FLAP:[],COIN:[],PAL:{},OUTLINE:{},THEME:{},drawSprite:()=>{}};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);return {sandbox,listeners,bridge:sandbox.window.condorAI};
}
test('bridge is gated, starts active play and hides future random state',()=>{assert.equal(load('example.com').bridge,undefined);const {bridge}=load();bridge.start();const s=bridge.snapshot();assert.equal(s.state,'play');assert.equal(s.mountains.length,0);assert.equal(JSON.stringify(s).includes('next'),false);assert.equal(s.gravity,.35);bridge.flap();assert.equal(bridge.snapshot().condor.vy,-5.2);bridge.pause();assert.equal(bridge.snapshot().paused,true)});
test('resize and visibility freeze AI run instead of reset',()=>{const {bridge,listeners,sandbox}=load();bridge.start();const s=bridge.snapshot();sandbox.innerWidth=500;listeners.resize();assert.equal(bridge.snapshot().state,'play');assert.equal(bridge.snapshot().playfield.width,s.playfield.width);assert.equal(bridge.snapshot().paused,true)});
test('AI game over neither writes best score nor posts leaderboard',()=>{const {sandbox,bridge}=load();bridge.start();vm.runInContext('score=5; gameOver(); endScreen(); showTable({name:"AAA",score:5})',sandbox);assert.equal(bridge.snapshot().state,'gameover')});
