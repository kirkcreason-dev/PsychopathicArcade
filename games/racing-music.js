// One lazy music element. Gameplay owns the allowed/gesture policy; this module
// owns playback races and autoplay rejection without leaking embedded sources.
const RACING_MUSIC = (() => {
  'use strict';
  function create(data=RACING_MUSIC_DATA) {
    let track='theme',audio=null,loadedTrack=null,allowed=false,playing=false,blocked=false;
    let pending=false,generation=0,needsAttempt=true;
    const positions={theme:0,'fight-club':0};
    const valid=id=>id==='off'||(id==='theme'||id==='fight-club')&&typeof data?.[id]?.src==='string';
    function savePosition() {
      if(!audio||!loadedTrack)return;
      try{if(Number.isFinite(audio.currentTime)&&audio.currentTime>=0)positions[loadedTrack]=audio.currentTime;}catch(_e){}
    }
    function pause() {
      savePosition();playing=false;
      if(audio)try{audio.pause();}catch(_e){}
    }
    function cancel() {generation++;pending=false;pause();}
    function currentTime() {
      if(track==='off')return 0;
      if(audio&&loadedTrack===track)try{if(Number.isFinite(audio.currentTime))return Math.max(0,audio.currentTime);}catch(_e){}
      return positions[track]||0;
    }
    function snapshot() {return{track,playing,blocked,loaded:!!audio&&loadedTrack===track,currentTime:currentTime()};}
    function ensureAudio() {
      if(audio)return;
      audio=new Audio();audio.loop=true;audio.volume=.22;audio.preload='none';
      // A late browser playback event after pause/leave must stay silent even
      // before its old play() promise settles.
      const guard=()=>{if(!allowed||blocked||track==='off'||loadedTrack!==track)pause();};
      audio.addEventListener('play',guard);audio.addEventListener('playing',guard);
      audio.addEventListener('pause',()=>{playing=false;});
      audio.addEventListener('loadedmetadata',()=>{
        const position=positions[loadedTrack]||0;
        if(position>0)try{audio.currentTime=position;}catch(_e){}
      });
      audio.addEventListener('error',()=>{
        if(loadedTrack===track){generation++;pending=false;playing=false;blocked=true;pause();}
      });
    }
    function setTrack(id) {
      if(!valid(id))return false;
      if(id===track)return true;
      cancel();track=id;blocked=false;needsAttempt=true;
      return true;
    }
    function sync(nextAllowed,gesture=false) {
      const next=nextAllowed===true&&track!=='off',opening=next&&!allowed;
      allowed=next;
      if(!allowed){if(pending||playing||audio&&!audio.paused)cancel();return snapshot();}
      if(blocked&&!gesture||pending||!opening&&!needsAttempt&&!gesture)return snapshot();
      if(playing&&!audio?.paused)return snapshot();
      const attempt=++generation;pending=true;needsAttempt=false;blocked=false;
      try{
        ensureAudio();
        if(loadedTrack!==track){
          savePosition();loadedTrack=track;audio.src=data[track].src;
          try{audio.currentTime=positions[track]||0;}catch(_e){}
        }
        // Call play synchronously in the supplied gesture, not in a queued
        // promise callback, so mobile browser gesture activation remains valid.
        const playback=audio.play();
        Promise.resolve(playback).then(()=>{
          if(attempt!==generation){if(!allowed||track==='off'||loadedTrack!==track)pause();return;}
          pending=false;
          if(!allowed||track==='off'||loadedTrack!==track){pause();return;}
          blocked=false;playing=!audio.paused;
        },()=>{
          if(attempt!==generation)return;
          pending=false;playing=false;blocked=true;pause();
        });
      }catch(_e){if(attempt===generation){pending=false;playing=false;blocked=true;pause();}}
      return snapshot();
    }
    return Object.freeze({setTrack,sync,get state(){return snapshot();}});
  }
  return Object.freeze({create});
})();
