import {optionalPlace} from './poi.js';
let previous=null;

export function mountTripMap(root,places,onSelect,key,userLocation=null,selectedId=null){
 const L=globalThis.L;if(!root||!L)return;
 const saved=previous?.key===key?{center:previous.map.getCenter(),zoom:previous.map.getZoom(),positionKey:previous.positionKey}:null;previous?.map.remove();
 const map=L.map(root,{scrollWheelZoom:true,zoomControl:true});previous={map,key,markers:new Map()};
 if(navigator.onLine)L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
 const bounds=[];
 places.forEach((event,index)=>{const point=[event.gps.lat,event.gps.lng];bounds.push(point);
  const marker=L.marker(point,{title:event.title,icon:L.divIcon({className:`trip-pin ${optionalPlace(event)?'optional':'confirmed'}`,html:`<span><b>${index+1}</b></span>`,iconSize:[32,38],iconAnchor:[16,36]})}).addTo(map);
  marker.on('click',()=>onSelect(event.id));
  previous.markers.set(event.id,marker);
 });
 if(userLocation){L.circleMarker([userLocation.lat,userLocation.lng],{radius:8,color:'#fff',weight:3,fillColor:'#397dea',fillOpacity:1}).addTo(map).bindTooltip('Tú estás aquí');if(saved?.positionKey!==`${userLocation.lat},${userLocation.lng}`)map.setView([userLocation.lat,userLocation.lng],14);else if(saved)map.setView(saved.center,saved.zoom);previous.positionKey=`${userLocation.lat},${userLocation.lng}`;}else if(saved)map.setView(saved.center,saved.zoom);else if(bounds.length)map.fitBounds(bounds,{padding:[35,35],maxZoom:15});else map.setView([0,0],2);
 selectTripPin(selectedId);setTimeout(()=>map.invalidateSize(),0);
 return map;
}
export function closeTripMap(){previous?.map.remove();previous=null;}
export function focusTripPin(id){
 selectTripPin(id);const marker=previous?.markers.get(id);if(!marker)return false;
 const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 previous.map.setView(marker.getLatLng(),Math.max(15,Math.min(17,previous.map.getZoom())),{animate:!reduced});

 return true;
}

function selectTripPin(id){for(const [key,marker]of previous?.markers||[]){marker.setZIndexOffset(key===id?1000:0);marker.getElement()?.classList.toggle('selected',key===id);}}
