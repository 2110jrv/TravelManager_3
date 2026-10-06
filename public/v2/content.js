const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',bull:'•'};
export function calendarText(value){
 let text=String(value||'');
 for(let pass=0;pass<2;pass++)text=text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(all,key)=>{if(key[0]==='#'){const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}return entities[key.toLowerCase()]??all;});
 return text.replace(/<(script|style|iframe|object|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<!--[^]*?-->/g,'').replace(/<br\b[^>]*>/gi,'\n').replace(/<li\b[^>]*>/gi,'\n• ').replace(/<\/?(?:p|div|ul|ol|h[1-6]|blockquote|tr)\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').replace(/[\t ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
export function visibleDescription(value){return calendarText(value).replace(/\[\s*AGENDA_VIAJERA\s*\][\s\S]*?(?:\[\s*\/\s*AGENDA_VIAJERA\s*\]|$)/gi,'').replace(/\[\s*\/\s*AGENDA_VIAJERA\s*\]/gi,'').replace(/!?\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/https?:\/\/[^\s]+/gi,'').replace(/\[cite:\s*[^\]]+\]/gi,'').replace(/^\s*#{1,6}\s+/gm,'').replace(/\*\*([^*]+)\*\*|__([^_]+)__/g,'$1$2').replace(/`([^`]+)`/g,'$1').replace(/^\s*[-*]\s+/gm,'• ').replace(/\n{3,}/g,'\n\n').trim();}
export const escapeContent=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function descriptionHtml(value){const text=visibleDescription(value);if(!text)return '<p class="muted">Sin información adicional.</p>';let list=false,paragraph=[];const out=[];
 const lineHtml=line=>{const label=/^([^:]{1,45}:)\s*(.*)$/.exec(line);return label?`<strong>${escapeContent(label[1])}</strong> ${escapeContent(label[2])}`:escapeContent(line);};
 const flush=()=>{if(paragraph.length){out.push(`<p>${paragraph.map(lineHtml).join('<br>')}</p>`);paragraph=[];}};
 for(const line of text.split('\n')){if(/^•\s/.test(line)){flush();if(!list){out.push('<ul>');list=true;}out.push(`<li>${lineHtml(line.replace(/^•\s*/,''))}</li>`);}else{if(list){out.push('</ul>');list=false;}if(line.trim())paragraph.push(line);else flush();}}flush();if(list)out.push('</ul>');return out.join('');}
