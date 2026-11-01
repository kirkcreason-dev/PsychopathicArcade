/* Original DOM playing cards. Render only the private view supplied by the controller. */
const POKER_RENDERER=(()=>{
  const suits=['clubs','diamonds','hearts','spades'],symbols=['♣','♦','♥','♠'];
  const rank=n=>n===14?'A':n===13?'K':n===12?'Q':n===11?'J':String(n);
  function card(value,label=''){
    const el=document.createElement('div');el.className='pk-card';
    if(value===null||value===undefined){el.classList.add('pk-back');el.setAttribute('aria-label',label||'Hidden card');const mark=document.createElement('span');mark.className='pk-back-mark';mark.textContent='♠';el.append(mark);return el;}
    if(!Number.isInteger(value)||value<0||value>51){el.classList.add('pk-slot');el.setAttribute('aria-label','Undealt community card');return el;}
    const suit=Math.floor(value/13),r=value%13+2,text=rank(r);el.dataset.suit=suits[suit];el.dataset.rank=text;el.setAttribute('aria-label',label||`${({A:'Ace',K:'King',Q:'Queen',J:'Jack'})[text]||text} of ${suits[suit]}`);
    for(const corner of['top','bottom']){const index=document.createElement('span');index.className=`pk-card-index pk-card-${corner}`;const number=document.createElement('b'),symbol=document.createElement('i');number.textContent=text;symbol.textContent=symbols[suit];index.append(number,symbol);el.append(index);}
    const center=document.createElement('span');center.className='pk-card-center';center.textContent=symbols[suit];el.append(center);
    if(r>10&&r<14){el.classList.add('pk-court');const monogram=document.createElement('strong');monogram.className='pk-card-court';monogram.textContent=text;el.append(monogram);}
    return el;
  }
  function cards(element,values=[],options={}){
    if(!element)return;const list=Array.isArray(values)?values:[],count=Math.max(list.length,options.hiddenCount||0,options.slots||0),highlight=Array.isArray(options.highlight)?options.highlight:[],key=JSON.stringify([list,count,options.hiddenCount||0,highlight]);
    if(element.dataset.pkCards===key)return;element.dataset.pkCards=key;
    const nodes=[];for(let i=0;i<count;i++){const value=i<list.length?list[i]:i<(options.hiddenCount||0)?null:-1,node=card(value);if(Number.isInteger(value)&&value>=0&&highlight.includes(value)){node.classList.add('pk-winning');node.setAttribute('aria-label',node.getAttribute('aria-label')+', winning hand');}nodes.push(node);}element.replaceChildren(...nodes);
    if(options.label)element.setAttribute('aria-label',options.label);
  }
  return{card,cards};
})();
