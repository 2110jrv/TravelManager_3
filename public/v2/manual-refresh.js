const selector=(node,root)=>{
 if(node===root)return '#'+root.id;
 if(node.id)return '#'+CSS.escape(node.id);
 const parts=[];while(node&&node!==root){const siblings=[...node.parentElement.children].filter(n=>n.tagName===node.tagName);parts.unshift(node.tagName.toLowerCase()+':nth-of-type('+(siblings.indexOf(node)+1)+')');node=node.parentElement;}
 return '#'+root.id+' > '+parts.join(' > ');
};
export function captureScreenState(root){
 return {route:location.hash,x:scrollX,y:scrollY,
 scroll:[...root.querySelectorAll('*')].filter(n=>n.scrollLeft||n.scrollTop||n.matches('.day-strip')).map(n=>({selector:selector(n,root),x:n.scrollLeft,y:n.scrollTop})),
 details:[...root.querySelectorAll('details')].map(n=>({selector:selector(n,root),open:n.open})),
 fields:[...root.querySelectorAll('input:not([type="password"]),textarea,select')].map(n=>({selector:selector(n,root),value:n.value,checked:n.checked,files:n.type==='file'?[...n.files]:null})),
 focus:root.contains(document.activeElement)?selector(document.activeElement,root):null};
}
export function restoreScreenState(root,state){
 if(!state||location.hash!==state.route)return;
 for(const item of state.details){const n=document.querySelector(item.selector);if(root.contains(n))n.open=item.open;}
 for(const item of state.fields){const n=document.querySelector(item.selector);if(!root.contains(n))continue;if(item.files){const transfer=new DataTransfer();for(const file of item.files){if(file instanceof File)transfer.items.add(file);}n.files=transfer.files;}else n.value=item.value;if('checked' in n)n.checked=item.checked;}
 const focus=state.focus&&document.querySelector(state.focus);if(root.contains(focus))focus.focus({preventScroll:true});
 for(const item of state.scroll){const n=document.querySelector(item.selector);if(root.contains(n)){n.scrollLeft=item.x;n.scrollTop=item.y;}}
 window.scrollTo({left:state.x,top:state.y,behavior:'instant'});
}
export class ManualRefresh {
 constructor(update,finish){this.update=update;this.finish=finish;}
 run(){if(this.running)return this.running;this.running=(async()=>{await this.update();await this.finish();})().finally(()=>{this.running=null;});return this.running;}
}
