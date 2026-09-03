(function(){
  "use strict";
  const nav=document.getElementById('nav'), hero=document.getElementById('hero'), heroStage=document.getElementById('heroStage'), heroUI=document.getElementById('heroUI'), progress=document.getElementById('progress');
  const canvas=document.getElementById('heroCanvas'), ctx=canvas ? canvas.getContext('2d', {alpha:false}) : null;
  const fallbackVideo=document.getElementById('heroFallbackVideo');
  const bagBtn=document.getElementById('bag');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Fallback video: shows while canvas images load (Netlify). Scrubbed by scroll until canvas is ready
  let fallbackReady=false;
  if(fallbackVideo){
    fallbackVideo.muted=true; fallbackVideo.playsInline=true; fallbackVideo.preload="auto";
    fallbackVideo.pause();
    fallbackVideo.addEventListener('loadedmetadata',()=>{ fallbackReady=true; });
    if(fallbackVideo.readyState>=1) fallbackReady=true;
  }

  // --- Hero image sequence: 600 images (60fps x 10s) in 4K ---
  const FRAME_COUNT = 600;
  const FRAME_DIR = "images/hero";
  const images = new Array(FRAME_COUNT);
  let loadedCount=0, firstDrawn=false;
  let currentFrame=0, targetFrame=0;

  function frameSrc(i){
    return FRAME_DIR + "/frame_" + String(i+1).padStart(4,'0') + ".jpg";
  }

  function drawFrame(idx){
    const img = images[idx];
    if(!img || !img.complete || img.naturalWidth===0 || !ctx) return;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    currentFrame = idx;
    // Once first frame is drawn, reveal canvas and hide fallback video (Netlify fix)
    if(!firstDrawn){
      firstDrawn=true;
      canvas.classList.add('ready');
      if(fallbackVideo){ fallbackVideo.classList.add('hidden'); fallbackVideo.pause(); }
    } else if(fallbackVideo && !fallbackVideo.classList.contains('hidden')){
      // Ensure fallback stays hidden after first draw
      fallbackVideo.classList.add('hidden'); fallbackVideo.pause();
    }
  }

  // Preload with limited concurrency to avoid thrashing
  let nextToLoad=0;
  const CONCURRENCY = 6;
  let activeLoads=0;

  function loadNext(){
    if(nextToLoad>=FRAME_COUNT) return;
    if(activeLoads>=CONCURRENCY) return;
    const idx=nextToLoad++;
    activeLoads++;
    const img=new Image();
    img.decoding="async";
    // Important for CORS local file:// — no crossOrigin
    img.onload=()=>{
      loadedCount++;
      activeLoads--;
      if(!firstDrawn && idx===0){
        drawFrame(0);
      }
      // If this is the currently targeted frame, draw it immediately for responsiveness
      if(idx===targetFrame) drawFrame(idx);
      loadNext(); loadNext();
    };
    img.onerror=()=>{
      console.warn("Frame load failed", idx, frameSrc(idx));
      activeLoads--;
      loadNext();
    };
    img.src=frameSrc(idx);
    images[idx]=img;
    // queue more
    if(nextToLoad<FRAME_COUNT) loadNext();
  }

  // Kick off initial batch
  for(let k=0;k<CONCURRENCY;k++) loadNext();

  // --- Scroll scrub: map scroll progress to frame index ---
  function clamp(v,a,b){ return Math.min(b,Math.max(a,v)); }
  function computeProgress(){
    const r=hero.getBoundingClientRect();
    const max=Math.max(1, hero.offsetHeight - innerHeight);
    return clamp(-r.top/max, 0, 1);
  }

  function renderFrameImmediate(p){
    const idx=Math.min(FRAME_COUNT-1, Math.max(0, Math.floor(p*(FRAME_COUNT-1))));
    targetFrame=idx;
    // If canvas is ready, use it; else scrub fallback video (Netlify first paint)
    if(firstDrawn){
      const img=images[idx];
      if(img && img.complete && img.naturalWidth){
        drawFrame(idx);
      } else {
        let fb=idx;
        while(fb>0 && (!images[fb] || !images[fb].complete || images[fb].naturalWidth===0)) fb--;
        if(fb>=0 && images[fb]) drawFrame(fb);
      }
    } else if(fallbackVideo && fallbackReady && fallbackVideo.duration){
      // Fallback: scrub video by scroll (no canvas yet)
      const t=p*fallbackVideo.duration;
      if(Math.abs(fallbackVideo.currentTime - t) > 0.05){
        try{
          if(fallbackVideo.fastSeek) fallbackVideo.fastSeek(t);
          else fallbackVideo.currentTime=t;
        }catch(e){}
      }
    }
    progress.style.width=(p*100)+'%';
    hero.classList.toggle('is-scrolled', p>0.5);
    if(!reduceMotion && heroStage){
      const zoom=1.06 - p*0.06;
      const ty=p*42;
      const tz=-p*110;
      heroStage.style.setProperty('--zoom', zoom.toFixed(3));
      heroStage.style.setProperty('--depth-y', ty.toFixed(1)+'px');
      heroStage.style.setProperty('--depth-z', tz.toFixed(1)+'px');
      if(heroUI) heroUI.style.opacity=String(clamp(1 - p*1.2, 0, 1));
    }
  }

  // Use rAF + lerp for buttery feel — interpolate progress then snap to frame
  let rafId=null;
  let curP=0, tgtP=0;
  function lerpLoop(){
    curP += (tgtP - curP) * 0.16;
    if(Math.abs(tgtP - curP) < 0.0005) curP=tgtP;
    renderFrameImmediate(curP);
    if(Math.abs(tgtP - curP) > 0.0005) rafId=requestAnimationFrame(lerpLoop);
    else rafId=null;
  }
  function scrubHero(){
    const p=computeProgress();
    tgtP=p;
    if(!rafId) rafId=requestAnimationFrame(lerpLoop);
  }

  let ticking=false;
  window.addEventListener('scroll',()=>{
    if(!ticking){ requestAnimationFrame(()=>{ scrubHero(); ticking=false; }); ticking=true; }
  },{passive:true});
  window.addEventListener('load',()=>{ curP=computeProgress(); tgtP=curP; renderFrameImmediate(curP); });
  window.addEventListener('resize',()=>{ renderFrameImmediate(computeProgress()); });
  window.addEventListener('scroll',()=> nav.classList.toggle('scrolled', scrollY>50),{passive:true});

  // Initial draw after short delay for first image
  setTimeout(()=>{ if(!firstDrawn && images[0] && images[0].complete) { drawFrame(0); firstDrawn=true; } renderFrameImmediate(computeProgress()); }, 300);

  // --- Mouse-move 3D tilt ---
  if(!reduceMotion && heroStage && window.matchMedia('(hover:hover)').matches){
    let tiltX=0, tiltY=0, tx=0, ty=0;
    function applyTilt(){
      tiltX += (tx - tiltX)*0.08;
      tiltY += (ty - tiltY)*0.08;
      heroStage.style.setProperty('--tilt-x', tiltX.toFixed(2)+'deg');
      heroStage.style.setProperty('--tilt-y', tiltY.toFixed(2)+'deg');
      requestAnimationFrame(applyTilt);
    }
    hero.addEventListener('mousemove', e=>{
      const r=hero.getBoundingClientRect();
      const px=(e.clientX - r.left)/r.width - .5;
      const py=(e.clientY - r.top)/r.height - .5;
      tx=px*7; ty=-py*5;
    });
    hero.addEventListener('mouseleave', ()=>{ tx=0; ty=0; });
    applyTilt();
  }

  // --- Rooms: reveal on scroll, play only on hover (cursor touch) ---
  const rooms=[...document.querySelectorAll('.room')];
  const roomObserver=new IntersectionObserver(entries=>{
    entries.forEach(e=>{
      const room=e.target;
      if(e.isIntersecting) room.classList.add('active');
      else room.classList.remove('active');
    });
  },{threshold:.42});
  rooms.forEach(r=>roomObserver.observe(r));
  // Hover behavior: play on cursor enter, reset to first frame on leave
  rooms.forEach(room=>{
    const media=room.querySelector('.room-media');
    const v=room.querySelector('video');
    if(!v || !media) return;
    v.muted=true; v.playsInline=true; v.preload="metadata";
    v.pause();
    const playOnHover=()=>{
      v.playbackRate=1;
      const p=v.play();
      if(p && p.catch) p.catch(()=>{});
    };
    const resetOnLeave=()=>{
      v.pause();
      try{ v.currentTime=0; }catch(e){}
    };
    media.addEventListener('mouseenter', playOnHover);
    media.addEventListener('mouseleave', resetOnLeave);
    media.addEventListener('focusin', playOnHover);
    media.addEventListener('focusout', resetOnLeave);
    media.addEventListener('touchstart', playOnHover, {passive:true});
    media.addEventListener('touchend', resetOnLeave, {passive:true});
  });

  // --- Modal exploded view + bag ---
  const modal=document.getElementById('modal'), title=document.getElementById('modalTitle'), eyebrow=document.getElementById('modalEyebrow'), row=document.getElementById('productRow');
  const catalog={
    Formal:['Black Label Tuxedo','Midnight Wool Suit','Italian Oxford Shirt'],
    Casual:['Signature Overshirt','Heavyweight Polo','Relaxed Chino'],
    Active:['Motion Track Jacket','Technical Jogger','Performance Tee'],
    Traditional:['Heritage Kurta','Bandhgala Jacket','Silk Blend Trouser'],
    Shoes:['House Derby','Monogram Loafer','Court Runner']
  };
  let bagCount=0;
  function updateBag(){
    const b=bagBtn.querySelector('b');
    if(b) b.textContent=bagCount;
    bagBtn.classList.toggle('has-items', bagCount>0);
  }
  rooms.forEach((room,i)=>{
    const btn=room.querySelector('.explore');
    if(!btn) return;
    btn.addEventListener('click',()=>{
      const cat=room.dataset.category;
      eyebrow.textContent=String(i+1).padStart(2,'0')+' / EXPLODED VIEW';
      title.textContent=cat;
      row.innerHTML='';
      (catalog[cat]||[]).forEach((name)=>{
        const el=document.createElement('div'); el.className='product';
        el.innerHTML=`<small>${cat} / Shopify</small><strong>${name}</strong><button>View product — Add to bag</button>`;
        el.querySelector('button').addEventListener('click',()=>{
          bagCount++; updateBag();
          el.querySelector('button').textContent='Added ✓';
          setTimeout(()=>{ el.querySelector('button').textContent='View product — Add to bag'; }, 1200);
        });
        row.appendChild(el);
      });
      modal.classList.add('open');modal.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';
    });
  });
  function closeModal(){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');document.body.style.overflow=''}
  const closeBtn=document.getElementById('close');
  if(closeBtn) closeBtn.onclick=closeModal;
  const bg=document.querySelector('.modal-bg');
  if(bg) bg.onclick=closeModal;
  document.addEventListener('keydown',e=>e.key==='Escape'&&closeModal());
  document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',()=>{ if(modal.classList.contains('open')) closeModal(); }));
  bagBtn.addEventListener('click',()=>{
    if(bagCount===0) alert('Your bag is empty. Explore the rooms and add pieces.');
    else alert('Checkout demo — '+bagCount+' item(s) in bag. Hero frames: images/hero/ (600 × 4K, 60fps). Rooms: original 720p video.');
  });
  updateBag();
})();
