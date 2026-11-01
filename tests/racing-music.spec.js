import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const source=fs.readFileSync(new URL('../games/racing-music.js',import.meta.url),'utf8');
const fixture={theme:{src:'data:audio/mpeg;base64,AA=='},'fight-club':{src:'data:audio/mpeg;base64,AQ=='}};
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
function setup(){
  const instances=[];
  class FakeAudio {
    constructor(){this.paused=true;this._currentTime=0;this._src='';this.metadata=true;this.handlers={};this.calls=[];this.pauseCalls=0;instances.push(this);}
    addEventListener(type,fn){(this.handlers[type]??=[]).push(fn);}
    emit(type){for(const fn of this.handlers[type]||[])fn();}
    get src(){return this._src;}
    set src(value){this._src=value;this._currentTime=0;this.metadata=false;}
    get currentTime(){return this._currentTime;}
    set currentTime(value){if(value>0&&!this.metadata)throw new Error('Metadata not available');this._currentTime=value;}
    ready(){this.metadata=true;this.emit('loadedmetadata');}
    pause(){this.pauseCalls++;this.paused=true;this.emit('pause');}
    play(){
      if(this.throwOnPlay)throw new Error('Playback unavailable');
      this.paused=false;this.emit('play');
      let resolve,reject;
      const promise=new Promise((a,b)=>{resolve=a;reject=b;});
      this.calls.push({resolve:()=>{this.paused=false;this.emit('playing');resolve();},reject:()=>reject(new Error('Autoplay blocked'))});
      return promise;
    }
  }
  const M=vm.runInNewContext(source+';RACING_MUSIC',{Audio:FakeAudio,RACING_MUSIC_DATA:fixture,Promise,Number,Object});
  return {player:M.create(),instances,FakeAudio};
}

test('embedded music is exactly the two supplied MP3 originals with recorded provenance',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../assets/racing/music/manifest.json',import.meta.url),'utf8'));
  const embedded=vm.runInNewContext(fs.readFileSync(new URL('../games/racing-music-data.js',import.meta.url),'utf8')+';RACING_MUSIC_DATA');
  expect(manifest.sourceProject).toBe('Lunacy Unlocked');expect(manifest.tracks).toHaveLength(2);
  for(const track of manifest.tracks){
    const original=fs.readFileSync(new URL('../assets/racing/music/'+track.file,import.meta.url));
    const payload=embedded[track.id];expect(payload.src.startsWith('data:audio/mpeg;base64,')).toBe(true);
    const decoded=Buffer.from(payload.src.split(',')[1],'base64');
    expect(decoded.equals(original)).toBe(true);expect(decoded.length).toBe(track.bytes);
    expect(crypto.createHash('sha256').update(decoded).digest('hex')).toBe(track.sha256);
  }
});

test('music and source attachment stay lazy, off stays silent, and state never exposes data',()=>{
  const {player,instances}=setup();expect(player.state).toEqual({track:'theme',playing:false,blocked:false,loaded:false,currentTime:0});
  player.setTrack('fight-club');player.sync(false,true);expect(instances).toHaveLength(0);
  expect(player.setTrack('unknown')).toBe(false);expect(player.state.track).toBe('fight-club');
  player.setTrack('off');player.sync(true,true);expect(instances).toHaveLength(0);
  expect(JSON.stringify(player.state)).not.toContain('data:');expect(Object.keys(player.state).sort()).toEqual(['blocked','currentTime','loaded','playing','track']);
});

test('one looping audio instance handles repeated frames and track selection without duplicate play calls',async()=>{
  const {player,instances}=setup();player.sync(true,true);const audio=instances[0];
  expect(instances).toHaveLength(1);expect(audio.loop).toBe(true);expect(audio.volume).toBe(.22);expect(audio.preload).toBe('none');
  expect(audio.src).toBe(fixture.theme.src);for(let i=0;i<100;i++)player.sync(true);expect(audio.calls).toHaveLength(1);
  audio.ready();audio.calls[0].resolve();await flush();expect(player.state.playing).toBe(true);
  for(let i=0;i<100;i++)player.sync(true);expect(audio.calls).toHaveLength(1);
  player.setTrack('fight-club');expect(audio.paused).toBe(true);expect(audio.src).toBe(fixture.theme.src);expect(player.state.loaded).toBe(false);
  player.sync(true,true);expect(instances).toHaveLength(1);expect(audio.src).toBe(fixture['fight-club'].src);expect(audio.calls).toHaveLength(2);
  audio.calls[1].resolve();await flush();expect(player.state.playing).toBe(true);
});

test('pause, mute and navigation stop immediately and preserve position for resume',async()=>{
  const {player,instances}=setup();player.sync(true,true);const audio=instances[0];audio.ready();audio.calls[0].resolve();await flush();audio.currentTime=37.5;
  player.sync(false);expect(audio.paused).toBe(true);expect(player.state.playing).toBe(false);expect(player.state.currentTime).toBe(37.5);
  for(let i=0;i<100;i++)player.sync(false);expect(audio.calls).toHaveLength(1);
  player.sync(true,true);expect(audio.currentTime).toBe(37.5);audio.calls[1].resolve();await flush();expect(player.state.playing).toBe(true);
  player.setTrack('off');expect(audio.paused).toBe(true);expect(player.state.currentTime).toBe(0);
  player.setTrack('theme');player.sync(true,true);expect(audio.currentTime).toBe(37.5);
});

test('autoplay rejection never retries from frames or a policy toggle without a user gesture',async()=>{
  const {player,instances}=setup();player.sync(true);const audio=instances[0];audio.calls[0].reject();await flush();
  expect(player.state.blocked).toBe(true);expect(audio.paused).toBe(true);
  for(let i=0;i<100;i++)player.sync(true);player.sync(false);player.sync(true);
  expect(audio.calls).toHaveLength(1);
  player.sync(true,true);expect(audio.calls).toHaveLength(2);audio.calls[1].resolve();await flush();
  expect(player.state.blocked).toBe(false);expect(player.state.playing).toBe(true);
});

test('a pending play promise cannot restart music after pause or leave',async()=>{
  const {player,instances}=setup();player.sync(true,true);const audio=instances[0];player.sync(false);
  expect(audio.paused).toBe(true);audio.calls[0].resolve();await flush();
  expect(audio.paused).toBe(true);expect(player.state.playing).toBe(false);expect(player.state.blocked).toBe(false);
});

test('old play completions and rejections cannot pause or block a newer authorized playback',async()=>{
  for(const settle of ['resolve','reject']){
    const {player,instances}=setup();player.sync(true,true);const audio=instances[0];player.sync(false);player.sync(true,true);
    audio.calls[1].resolve();await flush();audio.calls[0][settle]();await flush();
    expect(player.state.playing).toBe(true);expect(player.state.blocked).toBe(false);expect(audio.paused).toBe(false);
  }
});

test('switching track while play is pending silences old completion and defers the new source',async()=>{
  const {player,instances}=setup();player.sync(true,true);const audio=instances[0];player.setTrack('fight-club');
  audio.calls[0].resolve();await flush();expect(audio.paused).toBe(true);expect(player.state.playing).toBe(false);
  expect(audio.src).toBe(fixture.theme.src);player.sync(true,true);audio.calls[1].resolve();await flush();
  expect(audio.src).toBe(fixture['fight-club'].src);expect(player.state.playing).toBe(true);
});

test('switching away and back restores each track position after metadata is available',async()=>{
  const {player,instances}=setup();player.sync(true,true);const audio=instances[0];audio.ready();audio.calls[0].resolve();await flush();audio.currentTime=33;
  player.setTrack('fight-club');player.sync(true,true);audio.ready();audio.calls[1].resolve();await flush();audio.currentTime=12;
  player.setTrack('theme');player.sync(true,true);audio.emit('pause');audio.ready();audio.calls[2].resolve();await flush();
  expect(player.state.currentTime).toBe(33);expect(player.state.playing).toBe(true);
  player.setTrack('fight-club');player.sync(true,true);audio.ready();expect(player.state.currentTime).toBe(12);expect(instances).toHaveLength(1);
});

test('external audio interruption does not start an automatic frame-by-frame replay loop',async()=>{
  const {player,instances}=setup();player.sync(true,true);const audio=instances[0];audio.calls[0].resolve();await flush();audio.pause();
  for(let i=0;i<100;i++)player.sync(true);expect(audio.calls).toHaveLength(1);expect(player.state.playing).toBe(false);
  player.sync(true,true);expect(audio.calls).toHaveLength(2);
});

test('synchronous playback failures are contained and can be retried from a later gesture',async()=>{
  const {player,instances,FakeAudio}=setup();FakeAudio.prototype.throwOnPlay=true;
  expect(()=>player.sync(true,true)).not.toThrow();const audio=instances[0];expect(player.state.blocked).toBe(true);
  audio.throwOnPlay=false;player.sync(true);expect(audio.calls).toHaveLength(0);
  player.sync(true,true);audio.calls[0].resolve();await flush();expect(player.state.playing).toBe(true);expect(player.state.blocked).toBe(false);
});

test('a late playing event after an audio error stays silent until an authorized gesture retries',async()=>{
  const {player,instances}=setup();player.sync(true,true);const audio=instances[0];audio.emit('error');
  expect(player.state.blocked).toBe(true);audio.calls[0].resolve();await flush();
  expect(audio.paused).toBe(true);expect(player.state.playing).toBe(false);expect(player.state.blocked).toBe(true);
  player.sync(true);expect(audio.calls).toHaveLength(1);
  player.sync(true,true);expect(player.state.blocked).toBe(false);audio.calls[1].resolve();await flush();
  expect(player.state.playing).toBe(true);expect(audio.paused).toBe(false);
});
