import {categoryFor} from './domain.js';
let previous=null;
const colors={Tour:'#927ab9',Transportation:'#658eb7',ABB:'#cb899a',Food:'#d49b68',Otros:'#8196ae'};
export function mountTripMap(root,places,onSelect,key){
 const L=globalThis.L;if(!root||!L)return;
 const saved=previous?.key===key?{center:previous.map.getCenter(),zoom:previous.map.getZoom()}:null;previous?.map.remove();
 const map=L.map(root,{scrollWheelZoom:true,zoomControl:true});previous={map,key};
 if(navigator.onLine)L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
 const bounds=[];
 places.forEach((event,index)=>{const point=[event.gps.lat,event.gps.lng];bounds.push(point);const color=colors[categoryFor(event)]||colors.Otros;
  const marker=L.marker(point,{title:event.title,icon:L.divIcon({className:'trip-pin',html:`<span style="background:${color}"><b>${index+1}</b></span>`,iconSize:[32,38],iconAnchor:[16,36]})}).addTo(map);
  marker.on('click',()=>onSelect(event.id));
 });
 if(saved)map.setView(saved.center,saved.zoom);else if(bounds.length)map.fitBounds(bounds,{padding:[35,35],maxZoom:15});else map.setView([0,0],2);
 setTimeout(()=>map.invalidateSize(),0);
 return map;
}
export function closeTripMap(){previous?.map.remove();previous=null;}
